"use strict";
// Orchestration only: all exported records pass deep-report's closed schema.
const fs = require("node:fs"),
  path = require("node:path");
const readline = require("node:readline");
const { performance } = require("node:perf_hooks");
const { readJson, ownedDirectory } = require("../../lib/sharing/lab-evidence");
const env = require("./environment.cjs");
const { Android } = require("./adb.cjs");
const deep = require("./deep-report.cjs");
const { hashDirectory } = require("./fixtures.cjs");
function read(root, name) {
  try {
    return readJson(path.join(root, name), 32 * 1024 * 1024);
  } catch {
    return {};
  }
}
// Timeout/EOF cancels readline's pending callback as well as the Promise, so a
// late answer cannot be attributed to the next question.
function ask(io, prompt, { timeout = 120000, signal } = {}) {
  if (!io || io.closed || signal?.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    const abort = new AbortController();
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      io.off("close", closed);
      signal?.removeEventListener("abort", closed);
      abort.abort();
      resolve(value);
    };
    const closed = () => finish(null);
    const timer = setTimeout(closed, timeout);
    io.once("close", closed);
    signal?.addEventListener("abort", closed, { once: true });
    io.question(prompt, { signal: abort.signal }, (value) => finish(value));
  });
}
async function diagnose(options, lab) {
  const root = path.resolve(
    options.workspace || path.join(env.ROOT, ".cache/quickshare-deep-lab"),
  );
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  ownedDirectory(root);

  if (options.case && options.case !== "lab-small.txt")
    throw Error(
      "Deep diagnostics use lab-small.txt; use --collect for other fixture cases",
    );
  const duration = options.duration ? Number(options.duration) : 180;
  if (!Number.isInteger(duration) || duration < 10 || duration > 600)
    throw Error("Diagnostic duration must be 10–600 seconds");
  const lock = path.join(root, "diagnose.lock");
  const lockFd = fs.openSync(lock, "wx", 0o600);
  fs.closeSync(lockFd);
  const opts = { ...options, workspace: root, "ble-native": true };
  const input = {
    direction: options.direction || "linux-to-samsung",
    network: options.network,
    appleSharing: options["apple-sharing"],
    events: [],
    outcome: "blocked",
  };
  let captureTimer,
    phase = "preflight";
  let owned = false,
    android,
    io,
    interrupted = false,
    pf,
    active = {};
  const origin = performance.now();
  input.startedMs = Date.now();
  const add = (e) => {
    if (input.events.length >= 2000) {
      input.truncated = true;
      return;
    }
    input.events.push({
      ...e,
      hostAt: new Date().toISOString(),
      elapsedMs: Math.round(performance.now() - origin),
    });
  };
  const mark = (phase, manual = false) => {
    add({ type: "marker", phase, manual });
    console.log(
      "Marker: " + phase + " (an action marker does not assert success)",
    );
  };
  const ownerAbort = new AbortController();
  const question = (prompt) => ask(io, prompt, { signal: ownerAbort.signal });
  const onSignal = () => {
    interrupted = true;
    ownerAbort.abort();
    io?.close();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    if (process.stdin.isTTY && !options["non-interactive"]) {
      io = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      io.on("SIGINT", onSignal);
    }
    pf = await env.preflight();
    input.preflight = pf;
    if (options.adb) {
      phase = "usb-preflight";
      let consent = options["authorize-adb"] === true;
      if (!consent)
        consent =
          (
            (await question(
              "Read-only USB diagnostics discard raw logs and export fixed categories. Keep Wi-Fi on. Type AUTHORIZE USB DIAGNOSTICS to consent: ",
            )) || ""
          ).trim() === "AUTHORIZE USB DIAGNOSTICS";
      if (!consent) {
        input.android = { requested: true, status: "consent-missing" };
        console.log("USB diagnostic consent missing; capture blocked.");
        return;
      }
      android = new Android({ onEvent: (e) => add({ type: "android", ...e }) });
      input.android = await android.preflight();
      input.android.consent = options["authorize-adb"]
        ? "explicit-flag"
        : "interactive-phrase";
      if (input.android.status !== "authorized") {
        console.log(
          "ADB preflight: " +
            input.android.status +
            ". Resolve USB authorization/selection and rerun.",
        );
        return;
      }
    }
    let attached = false;
    try {
      await lab.control(root, "status");
      attached = true;
    } catch {}
    let marker = read(root, "lab.json");
    const matches = () =>
      marker.prepared &&
      marker.bleNativeRequested &&
      marker.commit === pf.source.commit &&
      marker.fingerprint === pf.source.fingerprint &&
      marker.helperSha256 === pf.helper.sha256 &&
      pf.helper.hashMatches;
    if (attached && !matches())
      throw Error(
        "Active workspace is stale or not BLE-native; stop that lab explicitly and prepare again",
      );
    if (!attached) {
      if (!matches()) {
        phase = "prepare";
        await lab.prepare(opts);
        pf = await env.preflight();
        input.preflight = pf;
        marker = read(root, "lab.json");
      }
      phase = "start";
      const previousRun = marker.run;
      try {
        await lab.start(opts);
        owned = true;
      } catch (e) {
        const partial = read(root, "lab.json");
        if (partial.run && partial.run !== previousRun) {
          owned = true;
          input.marker = partial;
        }
        throw e;
      }
      marker = read(root, "lab.json");
    }
    input.marker = marker;
    console.log(
      "Build and helper hash validated. " +
        (owned
          ? "Started isolated BLE-native lab."
          : "Attached to existing lab; it will remain running."),
    );
    input.baseline = read(root, "desktop-state.json");
    mark("BASELINE");
    console.log(
      "Baseline: close the phone Quick Share view for 10 seconds; keep Wi-Fi and Bluetooth unchanged.",
    );
    if (io) await question("Press Enter for the closed-view baseline: ");
    if (android) android.start();
    for (let i = 0; i < 20 && !interrupted; i++)
      await new Promise((resolve) => setTimeout(resolve, 500));
    if (android) await android.stop();
    // No raw capture runs during an unbounded owner prompt.
    if (input.direction === "linux-to-samsung")
      console.log(
        "On Samsung, open native Quick Share Receive and keep its screen visible. In Linux Transfer, choose fixtures/lab-small.txt. If a native recipient becomes available, select it and Send; compare codes, then accept.",
      );
    else
      console.log(
        "Keep Linux native receiving visible. On Samsung choose the generated lab-small.txt (copied to the phone separately), Share → native Quick Share. Select the Linux lab if shown; compare codes and accept in Linux.",
      );
    const ready = await question(
      "Press Enter after opening the native phone view (empty Enter records an action only): ",
    );
    if (io && ready !== null) {
      mark(
        input.direction === "linux-to-samsung"
          ? "ANDROID_RECEIVE_OPEN"
          : "ANDROID_SEND_OPEN",
        true,
      );
    }
    if (android) {
      await android.sample();
      android.start();
    }
    phase = "capture";
    captureTimer = setTimeout(() => {
      void android?.stop();
    }, duration * 1000);
    mark("LINUX_DISCOVERY_RUNNING");
    console.log(
      `Observation window: ${duration}s. Optional markers: selected, connect, auth, accepted, completed, end. Markers do not confirm outcomes. No phone attribution is inferred from FEF3 counts.`,
    );
    const commands = {
      selected: "RECIPIENT_SELECTED",
      connect: "CONNECTION_ATTEMPTED",
      auth: "AUTHENTICATION",
      accepted: "FILE_ACCEPTED",
      completed: "TRANSFER_COMPLETED",
      end: "TEST_ENDED",
    };
    let androidPoll = null;
    let ended = false;
    const onLine = (line) => {
      const command = line.trim();
      if (commands[command]) mark(commands[command], true);
      if (command === "end") ended = true;
    };
    io?.on("line", onLine);
    const begin = performance.now();
    let nextAndroid = begin + 15000,
      lastRecipients = 0,
      seenReady = false;
    while (
      !interrupted &&
      !ended &&
      performance.now() - begin < duration * 1000
    ) {
      const desktop = read(root, "desktop-state.json");
      if (desktop.run === marker.run) {
        active = desktop;
        input.active = desktop;
        const recipients = desktop.maxRecipients || 0;
        if (recipients > lastRecipients) {
          console.log(
            "Native recipient event observed; use the Linux selector and compare verification codes. Phone identity still requires owner confirmation.",
          );
          lastRecipients = recipients;
        }
        if (desktop.helper?.status === "ready") seenReady = true;
        if (
          seenReady &&
          ["error", "stopped"].includes(desktop.helper?.status)
        ) {
          input.outcome = desktop.shutdownRequested ? "interrupted" : "failed";
          break;
        }
      }
      if (android && !androidPoll && performance.now() >= nextAndroid) {
        androidPoll = android
          .snapshot()
          .catch(() => {
            android.public.pollFailed = true;
          })
          .finally(() => {
            androidPoll = null;
          });
        nextAndroid = performance.now() + 15000;
        if (android.public.status === "usb-disconnected")
          console.log(
            "USB disconnected; Android evidence now UNKNOWN. Linux observation continues.",
          );
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    clearTimeout(captureTimer);
    io?.off("line", onLine);
    input.durationMs = Math.round(performance.now() - begin);
    input.endedMs = Date.now();
    const atEnd = read(root, "desktop-state.json");
    if (atEnd.run === marker.run) input.active = atEnd;
    else {
      input.failedStage = "session-changed";
      input.outcome = "failed";
    }
    mark("TEST_ENDED");
    if (android) {
      await android.stop();
      await androidPoll;
      await android.sample();
    }
    input.owner = {};
    if (!interrupted && io) {
      input.owner.recipientVisible =
        (
          (await question(
            "Only if you identified the intended phone/Linux native recipient in its UI, type CONFIRMED RECIPIENT; otherwise Enter: ",
          )) || ""
        ).trim() === "CONFIRMED RECIPIENT";
      input.owner.nativeCompleted =
        (
          (await question(
            "Only if the receiving native UI explicitly completed this fixture, type CONFIRMED RECEIVED; otherwise Enter: ",
          )) || ""
        ).trim() === "CONFIRMED RECEIVED";
    }
    phase = "integrity";
    const manifest = read(root, "fixtures/fixture-manifest.json");
    const markerNow = read(root, "lab.json");
    const hashes = await hashDirectory(
      input.direction === "samsung-to-linux"
        ? path.join(root, "sessions", markerNow.run, "share/Received")
        : options.readback ||
            path.join(root, "sessions", markerNow.run, "readback"),
      manifest,
    );
    const checked = hashes.checked.find((v) => v.fixture === "lab-small.txt");
    input.integrity = {
      fixtureMatch: checked?.result === "match",
      actualSha256: checked?.sha256,
      expectedSha256: manifest["lab-small.txt"]?.sha256,
      size: checked?.size,
    };
    input.outcome = interrupted
      ? "interrupted"
      : ["failed", "interrupted"].includes(input.outcome)
        ? input.outcome
        : "completed";
  } catch {
    input.failedStage = phase;
    input.outcome = "failed";
    console.log(
      "Diagnostic orchestration failed; sanitized partial report will be written. Run --preflight for build/display checks.",
    );
  } finally {
    clearTimeout(captureTimer);
    ownerAbort.abort();
    io?.close();
    await android?.stop();
    // Preserve active evidence before any stop/reset snapshot is written.
    const before = read(root, "desktop-state.json");
    if (!input.active && before.run === input.marker?.run)
      input.active = before;
    if (owned)
      try {
        if (read(root, "lab.json").run !== input.marker?.run) {
          input.failedStage = "session-changed";
          input.outcome = "failed";
        } else await lab.stop(opts);
      } catch {
        input.failedStage = "stop";
        input.outcome = "failed";
      }
    input.desktop = read(root, "desktop-state.json");
    input.runtime = read(root, "runtime.json");
    const expected = input.marker?.run;
    if (!expected || input.desktop.run !== expected) input.desktop = {};
    if (!expected || input.runtime.run !== expected) input.runtime = {};
    if (android) input.android = android.public;
    input.preflight = pf || {};
    if (interrupted) input.outcome = "interrupted";
    try {
      const output = deep.create(input),
        directory = deep.write(root, output, options.archive === true);
      console.log(
        "Sanitized reports: " +
          directory +
          "\nFEF3 " +
          output.report.bluetooth.peak.observed +
          "; decoded " +
          output.report.bluetooth.peak.decoded +
          "; resolved " +
          output.report.bluetooth.peak.resolved +
          "; ready " +
          output.report.bluetooth.peak.ready +
          ". Root cause and Samsung attribution require evidence. Nothing uploaded.",
      );
    } finally {
      fs.unlinkSync(lock);
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    }
  }
}
module.exports = { diagnose, ask };
