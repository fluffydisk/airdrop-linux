"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  zlib = require("node:zlib");
const { EventEmitter } = require("node:events"),
  { PassThrough } = require("node:stream");
const {
  Android,
  devices,
  packages,
  packageMetadata,
  logRecord,
  clockSample,
  MAX_LINE,
} = require("../scripts/quickshare-lab/adb.cjs");
const deep = require("../scripts/quickshare-lab/deep-report.cjs");
const { Evidence } = require("../lib/sharing/lab-evidence");
const { QuickShare, sanitizeBluetooth } = require("../lib/sharing/quickshare");
const { parse } = require("../scripts/quickshare-android-lab.cjs");
const { pipeline } = require("../lib/sharing/quickshare-diagnostics");
const secrets = [
  "AA:BB:CC:DD:EE:FF",
  "00:11:22:33:44:55",
  "owner@example.com",
  "super-secret-password",
  "/home/alice/private-tax.pdf",
  "My Home SSID",
  "SESSION-SECRET",
  "IMEI123456789",
  "serial-secret",
];
function noSecrets(value) {
  const text = JSON.stringify(value);
  for (const s of secrets) assert.equal(text.includes(s), false, s);
}
function usb(state = "device") {
  return `List of devices attached\nserial-secret\t${state} usb:1-2 product:private model:Galaxy device:private transport_id:7\n`;
}
function executor(overrides = {}) {
  return async (args) => {
    const a = args[0] === "-t" ? args.slice(2) : args;
    const key = a.join(" ");
    if (Object.hasOwn(overrides, key)) return overrides[key];
    const output =
      key === "version"
        ? "Android Debug Bridge version 1.0.41"
        : key === "devices -l"
          ? usb()
          : key === "get-state"
            ? "device"
            : key === "shell getprop ro.build.version.release"
              ? "17"
              : key === "shell getprop ro.build.version.sdk"
                ? "37"
                : key === "shell getprop ro.build.version.oneui"
                  ? "90000"
                  : key === "shell pm help"
                    ? "--show-versioncode"
                    : key === "shell pm list packages --show-versioncode"
                      ? "package:com.vendor.quickshare versionCode:123\npackage:com.google.android.gms versionCode:999"
                      : key.startsWith("shell dumpsys package ")
                        ? `Package [${a.at(-1)}] (abc):\n flags=[ SYSTEM ]\nversionCode=123\n versionName=2.4.6\n${secrets.join(" ")}`
                        : key === "shell dumpsys -l"
                          ? "bluetooth_manager\nwifi"
                          : key === "shell dumpsys bluetooth_manager"
                            ? "enabled: true\n" + secrets.join(" ")
                            : key === "shell cmd wifi help"
                              ? "  status\n"
                              : key === "shell cmd wifi status"
                                ? "Wifi is enabled\nWifi is connected to My Home SSID"
                                : key === "logcat --help"
                                  ? "epoch threadtime -T <count>"
                                  : key === "shell date +%s.%N"
                                    ? "1794268800.123456789"
                                    : key === "shell date +%s"
                                      ? "1794268800"
                                      : key.startsWith("shell pidof")
                                        ? "200"
                                        : "";
    return { ok: true, output };
  };
}
test("USB selection detects absent, unauthorized, multiple, offline and non-USB transports without exporting identities", () => {
  assert.equal(devices("List of devices attached\n").status, "no-device");
  assert.equal(devices(usb("unauthorized")).status, "unauthorized");
  assert.equal(devices(usb("offline")).status, "disconnected");
  assert.equal(
    devices(usb() + "second device usb:1 transport_id:8\n").status,
    "multiple-devices",
  );
  assert.equal(
    devices("List of devices attached\n10.0.0.2:5555 device transport_id:1")
      .status,
    "usb-transport-unconfirmed",
  );
  assert.equal(devices(usb()).transport, "7");
});
test("ADB unavailable and authorization failures do not issue phone commands", async () => {
  for (const [output, status] of [
    [usb("unauthorized"), "unauthorized"],
    [usb() + "second device usb:2 transport_id:8\n", "multiple-devices"],
  ]) {
    const calls = [];
    const a = new Android({
      execute: async (args) => {
        calls.push(args);
        return {
          ok: true,
          output:
            args[0] === "version"
              ? "Android Debug Bridge version 1.0.41"
              : output,
        };
      },
    });
    assert.equal((await a.preflight()).status, status);
    assert.equal(calls.length, 2);
    noSecrets(deep.android(a.public));
  }
  const a = new Android({
    execute: async () => ({ ok: false, category: "unavailable", output: "" }),
  });
  assert.equal((await a.preflight()).status, "adb-unavailable");
});
test("package candidates are discovered and validated, never guessed or exported as arbitrary names", () => {
  const c = packages(
    "package:com.vendor.quickshare versionCode:2\npackage:com.google.android.gms\npackage:com.alice.private\npackage:bad;cmd\n",
  );
  assert.equal(c.length, 2);
  assert.equal(packageMetadata(c[0], "other Package [wrong]", 1), null);
  const m = packageMetadata(
    c[0],
    "Package [com.vendor.quickshare] (a):\nversionCode=2\nversionName=1.2.3\nflags=[ SYSTEM ]",
    1,
  );
  assert.equal(m.system, true);
  assert.equal(m.versionName, "1.2.3");
  assert.equal(JSON.stringify(m).includes("com.vendor"), false);
});
test("read-only Android preflight exports numeric versions, package aliases and service accessibility only", async () => {
  const calls = [];
  const execute = executor();
  const a = new Android({
    execute: async (args) => {
      calls.push(args);
      return execute(args);
    },
  });
  await a.preflight();
  assert.equal(a.public.status, "authorized");
  assert.equal(a.public.packages.length, 2);
  assert.equal(a.public.bluetooth.enabled, true);
  assert.equal(a.public.wifi.connected, true);
  noSecrets(deep.android(a.public));
  for (const args of calls) {
    const s = args.join(" ");
    assert.doesNotMatch(
      s,
      /bugreport|\binstall\b|\bgrant\b|\bsetprop\b|\blogcat -c\b|tether|\bsu\b/,
    );
  }
});
test("missing Android permissions are unknown, and USB disconnect is explicit", async () => {
  const a = new Android({
    execute: executor({
      "shell dumpsys bluetooth_manager": {
        ok: false,
        output: "Permission Denial " + secrets.join(" "),
      },
      "logcat --help": { ok: false, output: "" },
    }),
  });
  await a.preflight();
  assert.equal(a.public.bluetooth.accessible, false);
  assert.equal(a.public.bluetooth.enabled, null);
  assert.equal(a.public.logcatVisibility, "unknown");
  a.execute = executor({ "get-state": { ok: false, output: "" } });
  await a.snapshot();
  assert.equal(a.public.status, "usb-disconnected");
  noSecrets(deep.android(a.public));
});
test("strict log parsers handle epoch, numeric UID and threadtime without bodies or identifiers", () => {
  for (const prefix of [
    "1794268800.123 200 201 E ",
    "1794268800.123 1000 200 201 E ",
  ]) {
    const r = logRecord(
      prefix + "BluetoothGatt: status=133 " + secrets.join(" "),
      "epoch",
      new Map([["200", "package-1"]]),
    );
    assert.equal(r.category, "gatt-error");
    assert.equal(r.package, "package-1");
    noSecrets(r);
  }
  const r = logRecord(
    "11-10 10:20:30.123 200 201 E BluetoothGatt: status=133 " +
      secrets.join(" "),
    "threadtime",
  );
  assert.equal(r.category, "gatt-error");
  assert.equal(r.androidMs, null);
  assert.equal(r.clock, "receipt-only");
  for (const line of [
    "malformed",
    "1794268800.123 200 201 E PrivateTag: " + secrets.join(" "),
    "1794268800.123 200 201 E BluetoothGatt: status=",
    "1794268800.123 200 201 E BluetoothGatt: status=0",
    "line1\n1794268800.123 200 201 E BluetoothGatt: status=133",
    "x".repeat(MAX_LINE + 1),
  ])
    assert.equal(logRecord(line), null);
});
test("log stream is bounded, restricted access remains visible, stop reaps child", async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = (signal) => {
    child.signalCode = signal;
    queueMicrotask(() => child.emit("exit", null, signal));
  };
  let args;
  const events = [];
  const a = new Android({
    execute: executor(),
    spawnProcess: (_c, argv) => {
      args = argv;
      return child;
    },
    onEvent: (e) => events.push(e),
  });
  await a.preflight();
  a.public.clocks = []; // This fixture checks streaming independent of wall-clock alignment.
  a.start();
  child.stderr.write("Permission denied " + secrets.join(" "));
  child.stdout.write("--------- beginning of main\n");
  child.stdout.write(
    "1794268800.123 200 201 E BluetoothGatt: status=133 " +
      secrets.join(" ") +
      "\n",
  );
  child.stdout.write("malformed " + secrets.join(" ") + "\n");
  await a.stop();
  assert.ok(args.includes("*:S"));
  assert.equal(events.length, 1);
  assert.equal(a.public.discarded, 1);
  assert.equal(a.public.logcatVisibility, "restricted");
  noSecrets(events);
  noSecrets(deep.android(a.public));
  assert.equal(child.signalCode, "SIGTERM");
});
test("clock alignment includes command latency and source precision, rejects host clock steps", () => {
  const s = clockSample(
    1794268800000,
    100,
    1794268800040,
    140,
    "1794268801.000",
  );
  assert.equal(s.offsetMs, 980);
  assert.equal(s.latencyMs, 40);
  assert.equal(s.uncertaintyMs, 20.5);
  const coarse = clockSample(
    1794268800000,
    100,
    1794268800040,
    140,
    "1794268801",
  );
  assert.equal(coarse.uncertaintyMs, 520);
  assert.equal(
    clockSample(1794268800000, 100, 1794268805000, 140, "1794268801"),
    null,
  );
  assert.equal(clockSample(0, 100, 40, 140, "garbage"), null);
  const timeline = deep.extraTimeline(
    [
      {
        type: "android",
        category: "gatt-error",
        hostAt: "2026-11-10T00:00:00.040Z",
        elapsedMs: 40,
        androidMs: 1794268801000,
        scope: "unattributed-system",
      },
    ],
    [s],
  );
  assert.equal(timeline[0].hostEstimateMs, 1794268800020);
  assert.equal(timeline[0].uncertaintyMs, 20.5);
});
test("corrected 72 observations/zero endpoints remains unknown, preserves peaks across shutdown", () => {
  const e = new Evidence("a".repeat(32));
  e.state({
    status: "ready",
    bluetooth: {
      observed: 72,
      decoded: 0,
      resolved: 0,
      ready: 0,
      bleAdvertising: true,
      gattBootstrap: true,
      l2cap: true,
      mode: "compact-gatt",
      diagnostics: {
        counters: {
          candidate_rejected: 72,
          full_reject_unsupported_fast_format: 72,
        },
      },
    },
  });
  e.event("shutdown-requested");
  e.state({
    status: "stopped",
    lifecycle: { outcome: "clean-stop", shutdownRequested: true },
    bluetooth: { stage: "stopped" },
  });
  const { report } = deep.create({
    desktop: e.value,
    direction: "linux-to-samsung",
    outcome: "completed",
  });
  assert.equal(report.bluetooth.peak.observed, 72);
  assert.equal(report.bluetooth.lastActive.mode, "compact-gatt");
  assert.equal(
    report.bluetooth.peak.diagnostics.counters.candidate_rejected,
    72,
  );
  assert.equal(report.shutdown.classification, "clean-stop");
  assert.equal(report.transfer.outcome, "unconfirmed");
  assert.equal(report.samsungCompatibilityEstablished, false);
  assert.equal(report.bluetooth.peak.decoded, 0);
  assert.match(report.findings[0].text, /Samsung attribution is UNKNOWN/);
});
test("legacy error after shutdown intent is ordering evidence, not proof of crash or clean exit", () => {
  const { report } = deep.create({
    desktop: {
      events: [
        { type: "bluetooth", elapsedMs: 100, bluetooth: { observed: 72 } },
        { type: "shutdown-requested", elapsedMs: 253000 },
        {
          type: "helper",
          status: "error",
          category: "HELPER_UNAVAILABLE",
          elapsedMs: 253001,
        },
        { type: "helper", status: "stopped", elapsedMs: 253002 },
      ],
    },
  });
  assert.equal(
    report.shutdown.classification,
    "legacy-error-after-shutdown-intent",
  );
  assert.equal(report.bluetooth.peak.observed, 72);
  assert.equal(
    report.findings.some((f) => f.kind === "helper-error"),
    false,
  );
});
test("closed schema and archive allowlisting exclude synthetic secrets and malformed multiline records", () => {
  const privateValue = secrets.join(" ");
  const { report, timeline } = deep.create({
    marker: { commit: privateValue, helperSha256: privateValue },
    owner: { nativeCompleted: privateValue },
    desktop: {
      helper: {
        bluetooth: {
          diagnostics: {
            counters: { [privateValue]: 72, full_reject_invalid_length: 72 },
          },
          private: privateValue,
        },
      },
      pipeline: { [privateValue]: 1 },
      events: [
        {
          type: "protocol",
          elapsedMs: 1,
          attempt: privateValue,
          stage: privateValue,
        },
        { type: "bluetooth", elapsedMs: 2, bluetooth: { name: privateValue } },
      ],
    },
    android: {
      packages: [{ alias: privateValue, role: privateValue }],
      categories: { [privateValue]: 1 },
    },
    events: [{ type: "android", category: privateValue, elapsedMs: 1 }],
  });
  noSecrets(report);
  noSecrets(timeline);
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "quickshare-deep-private-"),
  );
  fs.chmodSync(root, 0o700);
  try {
    fs.writeFileSync(path.join(root, "raw-logcat.txt"), privateValue);
    const directory = deep.write(root, { report, timeline }, true);
    const tar = zlib.gunzipSync(
      fs.readFileSync(path.join(directory, "quickshare-deep-sanitized.tar.gz")),
    );
    const names = [];
    for (let at = 0; at < tar.length && tar[at]; ) {
      names.push(
        tar
          .subarray(at, at + 100)
          .toString()
          .replace(/\0.*$/s, ""),
      );
      const n = parseInt(tar.subarray(at + 124, at + 136).toString(), 8);
      at += 512 + Math.ceil(n / 512) * 512;
    }
    assert.deepEqual(names, deep.FILES);
    for (const secret of secrets)
      assert.equal(tar.includes(Buffer.from(secret)), false);
    assert.equal(
      fs.statSync(path.join(directory, deep.FILES[1])).mode & 0o777,
      0o600,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("completion needs independent fixture bytes, explicit owner UI evidence and protocol event", () => {
  const protocol = {
    events: [
      {
        type: "transfer",
        attempt: "attempt-1",
        elapsedMs: 1,
        direction: "outgoing",
        phase: "outcome-unknown",
      },
    ],
  };
  assert.equal(
    deep.create({ desktop: protocol, owner: { nativeCompleted: true } }).report
      .transfer.outcome,
    "unconfirmed",
  );
  assert.equal(
    deep.create({
      integrity: {
        fixtureMatch: true,
        actualSha256: "a".repeat(64),
        expectedSha256: "a".repeat(64),
        size: 1,
      },
      owner: { nativeCompleted: true },
    }).report.transfer.outcome,
    "unconfirmed",
  );
  assert.equal(
    deep.create({
      desktop: protocol,
      integrity: {
        fixtureMatch: true,
        actualSha256: "a".repeat(64),
        expectedSha256: "a".repeat(64),
        size: 1,
      },
      owner: { nativeCompleted: true },
    }).report.transfer.outcome,
    "owner-confirmed-with-independent-bytes",
  );
});
test("GATT metadata resolution is distinct from Weave and connection, pipeline excludes raw peers", () => {
  const { report } = deep.create({
    desktop: {
      helper: {
        bluetooth: {
          observed: 1,
          decoded: 1,
          resolved: 1,
          diagnostics: {
            counters: {
              gatt_resolution_failure: 1,
              gatt_slot_read_failure: 1,
              dbus_permission_denied: 1,
            },
          },
        },
      },
      pipeline: { recipient_route_published: 1, secret: "secret" },
    },
  });
  assert.equal(
    report.bluetooth.peak.diagnostics.counters.weave_established,
    undefined,
  );
  assert.equal(
    report.findings.some((f) => f.kind === "gatt-failure"),
    true,
  );
  assert.equal(
    report.findings.some((f) => f.kind === "renderer-visibility-unknown"),
    true,
  );
  assert.deepEqual(pipeline({ outbound_requested: 1, private: "private" }), {
    outbound_requested: 1,
  });
});
test("CLI extends existing interface and bounds duration and comparison settings", () => {
  assert.equal(
    parse([
      "--diagnose",
      "--adb",
      "--authorize-adb",
      "--direction",
      "linux-to-samsung",
      "--duration",
      "10",
    ]).operation,
    "diagnose",
  );
  assert.equal(parse(["--preflight"]).operation, "preflight");
  assert.throws(() => parse(["--diagnose", "--duration", "9999"]));
  assert.throws(() => parse(["--diagnose", "--network", "personal SSID"]));
  assert.throws(() => parse(["--diagnose", "--apple-sharing", "maybe"]));
});
test("normal real helper process stop does not emit synthetic error; crash remains unexpected", async (t) => {
  const fsp = require("node:fs/promises"),
    crypto = require("node:crypto"),
    { spawn } = require("node:child_process");
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "qs-deep-stop-"));
  const helper = path.resolve("tests/fixtures/quickshare-helper.cjs");
  const a = new QuickShare({
    enabled: true,
    helper,
    sha256: crypto
      .createHash("sha256")
      .update(await fsp.readFile(helper))
      .digest("hex"),
    directory: root,
    inbox: path.join(root, "inbox"),
    spawnProcess: () =>
      spawn(process.execPath, [helper], { stdio: ["pipe", "pipe", "pipe"] }),
  });
  t.after(async () => {
    await a.stop();
    await fsp.rm(root, { recursive: true, force: true });
  });
  const states = [];
  a.on("state", (v) => states.push(v.status));
  await a.start();
  await a.stop();
  assert.equal(states.includes("error"), false);
  assert.equal(a.snapshot().lifecycle.outcome, "clean-stop");
  await a.start();
  await a.request("crash");
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(a.snapshot().lifecycle.outcome, "unexpected-exit");
  assert.equal(a.status, "error");
});

test("attached-session history cannot establish a new transfer and lifetime counters have window deltas", () => {
  const input = {
    startedMs: 1794268801000,
    owner: { nativeCompleted: true },
    integrity: {
      fixtureMatch: true,
      actualSha256: "a".repeat(64),
      expectedSha256: "a".repeat(64),
      size: 1,
    },
    baseline: {
      helper: {
        bluetooth: { diagnostics: { counters: { fef3_observations: 20 } } },
      },
    },
    desktop: {
      startedAt: "2026-11-10T00:00:00.000Z",
      helper: {
        bluetooth: { diagnostics: { counters: { fef3_observations: 72 } } },
      },
      events: [
        {
          type: "transfer",
          attempt: "attempt-1",
          elapsedMs: 100,
          direction: "outgoing",
          phase: "outcome-unknown",
        },
      ],
    },
  };
  const { report, timeline } = deep.create(input);
  assert.equal(report.transfer.outcome, "unconfirmed");
  assert.equal(report.bluetooth.windowCounters.fef3_observations, 52);
  assert.equal(timeline.events.length, 0);
});

test(
  "actual diagnostic CLI with unauthorized USB creates only sanitized partial reports without preparing or starting",
  { timeout: 30000 },
  async (t) => {
    const fsp = require("node:fs/promises"),
      { execFile } = require("node:child_process"),
      { promisify } = require("node:util");
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "qs-deep-cli-"));
    await fsp.chmod(root, 0o700);
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    const bin = path.join(root, "bin");
    await fsp.mkdir(bin, { mode: 0o700 });
    await fsp.writeFile(
      path.join(bin, "adb"),
      '#!/usr/bin/env node\nprocess.stdout.write(process.argv.includes("version")?"Android Debug Bridge version 1.0.41\\n":"List of devices attached\\nserial-secret unauthorized usb:1-2 transport_id:7\\n");\n',
      { mode: 0o700 },
    );
    const workspace = path.join(root, "lab");
    const result = await promisify(execFile)(
      process.execPath,
      [
        path.resolve("scripts/quickshare-android-lab.cjs"),
        "--diagnose",
        "--adb",
        "--authorize-adb",
        "--duration",
        "10",
        "--workspace",
        workspace,
        "--archive",
      ],
      {
        env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH },
        timeout: 25000,
        maxBuffer: 65536,
      },
    );
    assert.equal(result.stdout.includes("serial-secret"), false);
    const report = JSON.parse(
      await fsp.readFile(
        path.join(workspace, "reports", "quickshare-deep-diagnostic.json"),
      ),
    );
    assert.equal(report.android.status, "unauthorized");
    assert.equal(report.captureOutcome, "blocked");
    assert.equal(report.transfer.outcome, "unconfirmed");
    assert.equal(
      JSON.parse(await fsp.readFile(path.join(workspace, "lab.json"))).prepared,
      false,
    );
    assert.equal(fs.existsSync(path.join(workspace, "diagnose.lock")), false);
    noSecrets(report);
  },
);

test("historical 59-event/54-status shape preserves 72/0 without inventing a rejection reason", () => {
  const events = [
    { type: "helper", status: "starting", elapsedMs: 0 },
    { type: "helper", status: "ready", elapsedMs: 100 },
  ];
  for (let i = 0; i < 54; i++)
    events.push({
      type: "bluetooth",
      elapsedMs: 1000 + i * 4500,
      bluetooth: {
        observed: Math.min(72, Math.round((i * 72) / 53)),
        decoded: 0,
        resolved: 0,
        ready: 0,
        bleScanning: i % 2 === 0,
        bleAdvertising: true,
        mode: "compact-gatt",
        gattBootstrap: true,
        l2cap: true,
      },
    });
  events.push(
    { type: "shutdown-requested", elapsedMs: 253000 },
    {
      type: "helper",
      status: "error",
      category: "HELPER_UNAVAILABLE",
      elapsedMs: 253001,
    },
    { type: "helper", status: "stopped", elapsedMs: 253002 },
  );
  assert.equal(events.length, 59);
  const { report } = deep.create({ desktop: { events } });
  assert.equal(report.bluetooth.peak.observed, 72);
  assert.equal(report.bluetooth.peak.decoded, 0);
  assert.equal(report.bluetooth.rejectionReasonCoverage, "unavailable");
  assert.equal(report.evidenceStages.parserAccepted, null);
  assert.equal(report.transfer.outcome, "unconfirmed");
  assert.equal(
    report.shutdown.classification,
    "legacy-error-after-shutdown-intent",
  );
});
test("freeze at TEST_ENDED excludes later file completion and preserves active counters", () => {
  const at = 1794268800000;
  const active = {
    startedAt: "2026-11-10T00:00:00.000Z",
    helper: { bluetooth: { observed: 72 } },
    events: [],
  };
  const desktop = {
    ...active,
    helper: {
      bluetooth: { observed: 9999 },
      lifecycle: { outcome: "clean-stop", shutdownRequested: true },
    },
    events: [
      {
        type: "transfer",
        attempt: "attempt-1",
        elapsedMs: 2000,
        direction: "outgoing",
        phase: "outcome-unknown",
      },
      { type: "shutdown-requested", elapsedMs: 3000 },
    ],
  };
  const { report } = deep.create({
    active,
    desktop,
    startedMs: at,
    endedMs: at + 1000,
    owner: { nativeCompleted: true },
    integrity: {
      fixtureMatch: true,
      expectedSha256: "a".repeat(64),
      actualSha256: "a".repeat(64),
      size: 1,
    },
  });
  assert.equal(report.transfer.outcome, "unconfirmed");
  assert.equal(report.bluetooth.peak.observed, 72);
  assert.equal(report.shutdown.classification, "clean-stop");
});
test("maximum diagnostic counter schema and 2000 statuses produce bounded sampled export", () => {
  const counters = Object.fromEntries(
    require("../lib/sharing/quickshare-diagnostic-schema.json").counters.map(
      (k) => [k, 1e9],
    ),
  );
  const events = Array.from({ length: 1999 }, (_, i) => ({
    type: "bluetooth",
    elapsedMs: i,
    bluetooth: { observed: i, diagnostics: { counters } },
  }));
  events.push({
    type: "protocol",
    attempt: "attempt-1",
    elapsedMs: 2000,
    direction: "outgoing",
    stage: "SentUkeyClientInit",
  });
  const result = deep.create({
    desktop: { events },
    owner: { nativeCompleted: "pass" },
  });
  assert.equal(result.timeline.sampledBluetooth, true);
  assert.equal(result.timeline.omittedBluetoothEvents, 1743);
  assert.equal(
    result.timeline.events.some((e) => e.type === "protocol"),
    true,
  );
  assert.ok(
    Buffer.byteLength(JSON.stringify(result.timeline, null, 2)) <
      8 * 1024 * 1024,
  );
  assert.equal(result.report.owner.nativeCompleted, "unknown");
});

test("stopping an in-flight USB snapshot prevents further service/process polling", async () => {
  let release;
  const calls = [];
  const a = new Android({
    execute: (args) => {
      calls.push(args.join(" "));
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  a.transport = "7";
  a.public.services = { bluetooth: "available", wifi: "available" };
  const pending = a.snapshot();
  await a.stop();
  release({ ok: true, output: "device" });
  await pending;
  assert.equal(calls.length, 1);
});

test("timed-out owner prompt cancels readline state; late text never satisfies the wrong question", async () => {
  const { ask } = require("../scripts/quickshare-lab/diagnose.cjs");
  const input = new PassThrough(),
    output = new PassThrough();
  const io = require("node:readline").createInterface({
    input,
    output,
    terminal: false,
  });
  try {
    assert.equal(await ask(io, "First", { timeout: 5 }), null);
    const next = ask(io, "Second", { timeout: 1000 });
    input.write("SECOND ANSWER\n");
    assert.equal(await next, "SECOND ANSWER");
    const eof = ask(io, "Third", { timeout: 1000 });
    input.end();
    assert.equal(await eof, null);
  } finally {
    io.close();
  }
});

test("controller chipset IDs are retained, while addresses, arbitrary driver names and identities are dropped", () => {
  const { report } = deep.create({
    preflight: {
      adapters: {
        bluetooth: [
          {
            driver: "btusb",
            usbVendor: "0BDA",
            usbProduct: "B00A",
            address: "AA:BB:CC:DD:EE:FF",
            serial: "serial-secret",
          },
        ],
        wifi: [
          { driver: "owner@example.com", vendor: "0x10ec", device: "0xc821" },
        ],
      },
    },
  });
  assert.deepEqual(report.linux.adapters.bluetooth, [
    { driver: "btusb", usbVendor: "0bda", usbProduct: "b00a" },
  ]);
  assert.equal(report.linux.adapters.wifi[0].driver, "unknown");
  noSecrets(report);
});

test("physical S24 timeline: mDNS/LAN inference, UKEY2, 49/49 Sent, owner UI and later independent readback remain distinct", () => {
  const evidence = require("./fixtures/quickshare-s24-lan-evidence.json"),
    trial = evidence.transfer;
  const start = new Date(trial.startedMs).toISOString();
  const events = trial.events.map((e) => ({
    ...e,
    elapsedMs: Date.parse(e.hostAt) - trial.startedMs,
  }));
  const input = {
    direction: trial.direction,
    startedMs: trial.startedMs,
    endedMs: trial.endedMs,
    owner: { recipientVisible: true, nativeCompleted: true },
    desktop: {
      startedAt: start,
      events,
      peakBluetooth: trial.peakBluetooth,
      pipeline: trial.pipeline,
    },
    runtime: {
      status: "stopped",
      listenerReachable: false,
      advertisements: { ownObserved: true, maxVisible: 2 },
    },
  };
  const archived = deep.create(input).report;
  assert.equal(archived.schema, 2);
  assert.equal(archived.transfer.localPayloadCompletionObserved, true);
  assert.equal(
    Object.hasOwn(archived.transfer, "protocolCompletionObserved"),
    false,
  );
  assert.equal(archived.transfer.selectedTransport, "lan-tcp");
  assert.equal(archived.transfer.discoveryPath, "mdns");
  assert.equal(archived.transfer.transportProvenance, "Source-code inference");
  assert.equal(archived.transfer.remoteApplicationSuccessAcknowledged, false);
  assert.equal(archived.transfer.peerCloseStatus, "unknown");
  assert.equal(archived.transfer.outcome, "unconfirmed");
  assert.equal(archived.lan.listenerReachable, null);
  assert.equal(archived.lan.listenerReachableAfterShutdown, false);
  assert.equal(archived.bluetooth.peak.observed, 102);
  const verified = deep.create({
    ...input,
    integrity: {
      fixtureMatch: true,
      expectedSha256: evidence.fixture.sha256,
      actualSha256: evidence.laterOwnerReadback.sha256,
      size: 49,
    },
  }).report;
  assert.equal(
    verified.transfer.outcome,
    "owner-confirmed-with-independent-bytes",
  );
  assert.equal(verified.transfer.remoteApplicationSuccessAcknowledged, false);
  assert.equal(verified.productionAcceptanceEstablished, false);
  const first = evidence.discovery;
  assert.equal(first.peakBluetooth.observed, 64);
  assert.equal(
    first.peakBluetooth.diagnostics.counters.unsupported_fast_well_formed,
    63,
  );
  assert.equal(
    first.events.some((e) => e.type === "transfer"),
    false,
  );
});
test("actual connection diagnostics take precedence over a planned transport, and closure/ACK never assert remote application success", () => {
  const events = [
    {
      type: "transfer",
      attempt: "attempt-1",
      elapsedMs: 1,
      direction: "outgoing",
      phase: "connecting",
      connectionMethod: "ble-l2cap",
    },
    {
      type: "connection",
      attempt: "attempt-1",
      elapsedMs: 2,
      direction: "outgoing",
      connectionMethod: "ble-gatt",
    },
    {
      type: "finalization",
      attempt: "attempt-1",
      elapsedMs: 3,
      direction: "outgoing",
      stage: "PayloadReceiptAckObserved",
    },
    {
      type: "finalization",
      attempt: "attempt-1",
      elapsedMs: 4,
      direction: "outgoing",
      stage: "PeerEof",
    },
    {
      type: "protocol",
      attempt: "attempt-1",
      elapsedMs: 5,
      direction: "outgoing",
      stage: "Sent",
    },
  ];
  const r = deep.create({ desktop: { events } }).report;
  assert.equal(r.transfer.selectedTransport, "ble-gatt");
  assert.equal(r.transfer.localPayloadCompletionObserved, true);
  assert.equal(r.transfer.payloadReceiptAckObserved, true);
  assert.equal(r.transfer.peerCloseObserved, true);
  assert.equal(r.transfer.remoteApplicationSuccessAcknowledged, false);
  assert.equal(r.transfer.outcome, "unconfirmed");
});
test("active listener probe survives teardown; an outgoing connection is independent of the inbound listener", () => {
  const r = deep.create({
    activeRuntime: { listenerReachable: true },
    runtime: {
      status: "stopped",
      listenerReachable: false,
      lastActive: { listenerReachable: true },
    },
  }).report;
  assert.equal(r.lan.listenerReachable, true);
  assert.equal(r.lan.listenerReachableAfterShutdown, false);
  assert.equal(r.lan.listenerObservation, "captured-before-teardown");
  assert.equal(
    deep.create({ runtime: { status: "stopped", listenerReachable: false } })
      .report.lan.listenerReachable,
    null,
  );
});
test("ADB buffer limits are visible as collector limits, not invented Android permission failures", async () => {
  const a = new Android({
    execute: executor({
      "shell dumpsys bluetooth_manager": {
        ok: false,
        output: "",
        category: "output-limit",
      },
    }),
  });
  await a.preflight();
  const r = deep.android(a.public);
  assert.equal(r.bluetooth.observationStatus, "output-limit");
  assert.equal(r.bluetooth.enabled, null);
  noSecrets(r);
});
test("connection and finalization evidence allowlists reject private fields and require development diagnostics", () => {
  const e = new Evidence("a".repeat(32));
  e.connection({
    id: "private-session",
    direction: "outgoing",
    connectionMethod: "lan-tcp",
    address: secrets[0],
  });
  e.finalization({
    id: "private-session",
    direction: "outgoing",
    stage: "PeerEof",
    body: secrets.join(" "),
  });
  e.finalization({
    id: "private-session",
    direction: "outgoing",
    stage: "PeerEof",
  });
  e.finalization({
    id: "private-session",
    direction: "outgoing",
    stage: secrets[0],
  });
  assert.equal(e.value.events.length, 2);
  noSecrets(e.value);
  const a = new QuickShare();
  assert.throws(
    () =>
      a.message(
        {
          v: 1,
          event: "connection",
          data: {
            id: "id",
            direction: "outgoing",
            connectionMethod: "lan-tcp",
          },
        },
        a.generation,
      ),
    /diagnostic/,
  );
  a.protocolDiagnostics = true;
  assert.throws(
    () =>
      a.message(
        {
          v: 1,
          event: "finalization",
          data: { id: "id", direction: "outgoing", stage: secrets[0] },
        },
        a.generation,
      ),
    /diagnostic/,
  );
});
