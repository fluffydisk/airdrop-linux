"use strict";
// Read-only USB diagnostics. Raw output exists only in bounded process buffers.
// No shell interpolation, serial export, log clearing, permission or radio changes.
const { execFile, spawn } = require("node:child_process");
const { performance } = require("node:perf_hooks");
const MAX_OUTPUT = 256 * 1024,
  MAX_LOG = 4 * 1024 * 1024,
  MAX_LINE = 4096;
function command(args, { timeout = 5000, maxBuffer = MAX_OUTPUT } = {}) {
  return new Promise((resolve) =>
    execFile(
      "adb",
      args,
      {
        timeout,
        maxBuffer,
        encoding: "utf8",
        windowsHide: true,
        killSignal: "SIGKILL",
      },
      (e, stdout = "") =>
        resolve({
          ok: !e,
          output: e ? "" : stdout,
          category: e
            ? e.code === "ENOENT"
              ? "unavailable"
              : e.killed
                ? "timeout"
                : e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
                  ? "output-limit"
                  : "command-failed"
            : "ok",
        }),
    ),
  );
}
const version = (value) =>
  /^\d{1,6}(?:\.\d{1,9}){0,4}$/.test(value || "") ? value : null;
function devices(output) {
  const rows = output
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("List of devices") && !l.startsWith("*"));
  if (!rows.length) return { status: "no-device", count: 0 };
  if (rows.length > 1)
    return { status: "multiple-devices", count: Math.min(rows.length, 100) };
  const row = rows[0];
  if (/\sno permissions\b/.test(row))
    return { status: "host-usb-permission-denied", count: 1 };
  if (/\sunauthorized(?:\s|$)/.test(row))
    return { status: "unauthorized", count: 1 };
  if (!/^\S+\s+device(?:\s|$)/.test(row))
    return { status: "disconnected", count: 1 };
  const transport = row.match(/\btransport_id:(\d{1,8})(?:\s|$)/)?.[1];
  if (!/\busb:[A-Za-z0-9.:_-]+(?:\s|$)/.test(row) || !transport)
    return { status: "usb-transport-unconfirmed", count: 1 };
  return { status: "authorized", count: 1, transport }; // internal only; never serialize this object
}
function packages(output) {
  const all = [];
  for (const line of output.split(/\r?\n/)) {
    const match =
      /^package:([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+)(?:\s+versionCode:(\d+))?$/.exec(
        line.trim(),
      );
    if (
      match &&
      (/quick[._]?share|nearby|sharelive/i.test(match[1]) ||
        match[1] === "com.google.android.gms") &&
      all.length < 16
    )
      all.push({
        name: match[1],
        role:
          match[1] === "com.google.android.gms"
            ? "play-services"
            : "quickshare-candidate",
      });
  }
  return all;
}
function packageMetadata(candidate, output, index) {
  // A package-list keyword match alone does not establish Quick Share ownership.
  if (
    !output
      .split(/\r?\n/)
      .some((l) => l.trim().startsWith("Package [" + candidate.name + "] ("))
  )
    return null;
  const code = output.match(/\bversionCode=(\d{1,18})\b/)?.[1];
  const name = output.match(/\bversionName=([^\s]+)/)?.[1];
  return {
    alias: "package-" + index,
    role: candidate.role,
    system: /\b(?:SYSTEM|UPDATED_SYSTEM_APP)\b/.test(output),
    versionCode: /^\d{1,12}$/.test(code || "") ? code : null,
    versionName: version(name),
    attribution: "candidate-only",
  };
}
const TAGS = [
  "BluetoothGatt",
  "GattService",
  "BtGatt.GattService",
  "BluetoothLeScanner",
  "BluetoothLeAdvertiser",
  "BluetoothManagerService",
  "WifiClientModeImpl",
  "ClientModeImpl",
  "AndroidRuntime",
  "ActivityManager",
];
const CATEGORIES = [
  "gatt-error",
  "gatt-connected",
  "gatt-disconnected",
  "advertising-error",
  "scan-error",
  "bluetooth-enabled",
  "bluetooth-disabled",
  "wifi-connected",
  "wifi-disconnected",
  "permission-denied",
  "service-timeout",
  "process-crash",
  "process-start",
  "process-stop",
  "process-not-observed",
];
function logRecord(line, format = "epoch", knownPids = new Map()) {
  if (
    typeof line !== "string" ||
    Buffer.byteLength(line) > MAX_LINE ||
    /[\r\n\x00]/.test(line)
  )
    return null;
  let m,
    androidMs = null;
  if (format === "epoch") {
    m =
      /^\s*(\d{9,12}\.\d{3,9})\s+(?:\d+\s+)?(\d+)\s+\d+\s+[VDIWEF]\s+([A-Za-z0-9._-]{1,64})\s*:\s*(.*)$/.exec(
        line,
      );
    if (m) androidMs = Number(m[1]) * 1000;
  } else if (format === "threadtime")
    m =
      /^\s*\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3}\s+(?:\d+\s+)?(\d+)\s+\d+\s+[VDIWEF]\s+([A-Za-z0-9._-]{1,64})\s*:\s*(.*)$/.exec(
        line,
      );
  if (!m) return null;
  const [, , pidEpoch, tagEpoch, bodyEpoch] = m;
  const pid = format === "epoch" ? pidEpoch : m[1],
    tag = format === "epoch" ? tagEpoch : m[2],
    body = format === "epoch" ? bodyEpoch : m[3];
  if (!TAGS.includes(tag)) return null;
  let category = null;
  if (
    /(?:SecurityException|permission denial|permission denied|requires.*permission)/i.test(
      body,
    )
  )
    category = "permission-denied";
  else if (tag === "AndroidRuntime" && /FATAL EXCEPTION/.test(body))
    category = "process-crash";
  else if (
    tag === "ActivityManager" &&
    /(?:ANR in|executing service.*timeout|Timeout executing service)/i.test(
      body,
    )
  )
    category = "service-timeout";
  else if (/Gatt/.test(tag)) {
    if (
      /(?:status[=: ]+(?!0\b)\d+|GATT_FAILURE|connection.*(?:fail|timeout)|discoverServices.*fail)/i.test(
        body,
      )
    )
      category = "gatt-error";
    else if (/(?:newState[=: ]+2\b|STATE_CONNECTED)/.test(body))
      category = "gatt-connected";
    else if (/(?:newState[=: ]+0\b|STATE_DISCONNECTED)/.test(body))
      category = "gatt-disconnected";
  } else if (
    tag === "BluetoothLeAdvertiser" &&
    /(?:fail|error|too many)/i.test(body)
  )
    category = "advertising-error";
  else if (
    tag === "BluetoothLeScanner" &&
    /(?:fail|error|already started)/i.test(body)
  )
    category = "scan-error";
  else if (tag === "BluetoothManagerService" && /STATE_ON\b/.test(body))
    category = "bluetooth-enabled";
  else if (tag === "BluetoothManagerService" && /STATE_OFF\b/.test(body))
    category = "bluetooth-disabled";
  else if (
    /^(?:WifiClientModeImpl|ClientModeImpl)$/.test(tag) &&
    /enter ConnectedState/.test(body)
  )
    category = "wifi-connected";
  else if (
    /^(?:WifiClientModeImpl|ClientModeImpl)$/.test(tag) &&
    /enter DisconnectedState/.test(body)
  )
    category = "wifi-disconnected";
  if (!category) return null;
  const alias = knownPids.get(pid);
  return {
    category,
    androidMs: Number.isFinite(androidMs) ? androidMs : null,
    clock: format === "epoch" ? "android-epoch" : "receipt-only",
    scope: alias ? "validated-package-process" : "unattributed-system",
    ...(alias ? { package: alias } : {}),
  };
}
function clockSample(beforeWall, beforeMono, afterWall, afterMono, output) {
  const value = output.trim();
  if (!/^\d{9,12}(?:\.\d{1,9})?$/.test(value)) return null;
  const elapsed = afterMono - beforeMono;
  if (
    elapsed < 0 ||
    elapsed > 5000 ||
    Math.abs(afterWall - beforeWall - elapsed) > 100
  )
    return null;
  const androidMs = Number(value) * 1000,
    precision = value.includes(".")
      ? 1000 * 10 ** -value.split(".")[1].length
      : 1000;
  return {
    hostMs: beforeWall + elapsed / 2,
    androidMs,
    offsetMs: androidMs - (beforeWall + elapsed / 2),
    latencyMs: elapsed,
    uncertaintyMs: elapsed / 2 + precision / 2,
    precisionMs: precision,
  };
}
class Android {
  constructor({
    execute = command,
    spawnProcess = spawn,
    onEvent = () => {},
  } = {}) {
    this.execute = execute;
    this.spawn = spawnProcess;
    this.onEvent = onEvent;
    this.public = {
      requested: true,
      status: "unknown",
      visibility: "unknown",
      packages: [],
      categories: {},
      discarded: 0,
      truncated: false,
      clocks: [],
    };
    this.knownPids = new Map();
    this.candidates = [];
  }
  async call(args, options) {
    const at = performance.now();
    const result = await this.execute(
      [...(this.transport ? ["-t", this.transport] : []), ...args],
      options,
    );
    const elapsed = Math.min(10000, Math.max(0, performance.now() - at));
    const v = this.public.commandLatency || {
      count: 0,
      minMs: 10000,
      maxMs: 0,
      timeouts: 0,
      outputLimits: 0,
    };
    v.count = Math.min(1000000, v.count + 1);
    v.minMs = Math.min(v.minMs, elapsed);
    v.maxMs = Math.max(v.maxMs, elapsed);
    if (result.category === "timeout") v.timeouts++;
    if (result.category === "output-limit") v.outputLimits++;
    this.public.commandLatency = v;
    return result;
  }
  async preflight() {
    const v = await this.execute(["version"]);
    if (!v.ok) {
      this.public.status =
        v.category === "unavailable" ? "adb-unavailable" : "adb-failed";
      return this.public;
    }
    this.public.adbVersion = version(
      v.output.match(/Android Debug Bridge version ([0-9.]+)/)?.[1],
    );
    const list = await this.execute(["devices", "-l"]);
    if (!list.ok) {
      this.public.status = "adb-failed";
      return this.public;
    }
    const d = devices(list.output);
    this.public.status = d.status;
    this.public.attachedCount = d.count;
    if (d.status !== "authorized") return this.public;
    this.transport = d.transport;
    for (const [key, prop] of Object.entries({
      android: "ro.build.version.release",
      sdk: "ro.build.version.sdk",
      oneUi: "ro.build.version.oneui",
    })) {
      const r = await this.call(["shell", "getprop", prop]);
      this.public[key] = r.ok ? version(r.output.trim()) : null;
    }
    const security = await this.call([
      "shell",
      "getprop",
      "ro.build.version.security_patch",
    ]);
    this.public.securityPatch =
      security.ok && /^\d{4}-\d{2}-\d{2}$/.test(security.output.trim())
        ? security.output.trim()
        : null;
    const build = await this.call(["shell", "getprop", "ro.build.type"]);
    this.public.buildType =
      build.ok && ["user", "userdebug", "eng"].includes(build.output.trim())
        ? build.output.trim()
        : "unknown";
    const pm = await this.call(["shell", "pm", "help"]);
    const args = ["shell", "pm", "list", "packages"];
    if (pm.ok && pm.output.includes("--show-versioncode"))
      args.push("--show-versioncode");
    const installed = await this.call(args);
    this.public.packageDiscovery = {
      accessible: installed.ok,
      matched: installed.ok ? packages(installed.output).length : 0,
      rejected: 0,
      restricted: 0,
    };
    if (installed.ok)
      for (const c of packages(installed.output)) {
        const r = await this.call(["shell", "dumpsys", "package", c.name]);
        if (!r.ok) {
          this.public.packageDiscovery.restricted++;
          continue;
        }
        const meta = packageMetadata(c, r.output, this.candidates.length + 1);
        if (!meta) this.public.packageDiscovery.rejected++;
        if (meta) {
          this.public.packages.push(meta);
          this.candidates.push({ ...c, alias: meta.alias });
        }
      }
    const services = await this.call(["shell", "dumpsys", "-l"]);
    this.public.services = {
      bluetooth:
        services.ok && /^\s*bluetooth_manager\s*$/m.test(services.output)
          ? "available"
          : "unknown",
      wifi:
        services.ok && /^\s*wifi\s*$/m.test(services.output)
          ? "available"
          : "unknown",
    };
    const help = await this.call(["logcat", "--help"]);
    this.format =
      help.ok && /\bepoch\b/.test(help.output)
        ? "epoch"
        : help.ok && /\bthreadtime\b/.test(help.output)
          ? "threadtime"
          : null;
    this.public.logcatFormat = this.format || "unsupported";
    this.public.logcatVisibility = "unknown";
    // Current buffer tail only when the platform explicitly supports it. No clear.
    this.tail = help.ok && /\-T\b/.test(help.output);
    await this.sample();
    await this.snapshot();
    return this.public;
  }
  async sample() {
    for (let i = 0; i < 3; i++) {
      const b = Date.now(),
        m = performance.now();
      let r = await this.call(["shell", "date", "+%s.%N"]);
      let a = Date.now(),
        n = performance.now();
      let s = r.ok && clockSample(b, m, a, n, r.output);
      if (!s) {
        const b2 = Date.now(),
          m2 = performance.now();
        r = await this.call(["shell", "date", "+%s"]);
        s =
          r.ok && clockSample(b2, m2, Date.now(), performance.now(), r.output);
      }
      if (s && this.public.clocks.length < 12) this.public.clocks.push(s);
    }
  }
  async snapshot() {
    if (this.stopping) return;
    const state = await this.call(["get-state"]);
    if (!state.ok || state.output.trim() !== "device") {
      this.public.status = "usb-disconnected";
      this.event({ category: "usb-disconnected", scope: "transport" });
      return;
    }
    if (this.stopping) return;
    if (this.public.services.bluetooth === "available") {
      const r = await this.call(["shell", "dumpsys", "bluetooth_manager"]);
      this.public.bluetooth = {
        accessible:
          r.ok && !/Permission Denial|SecurityException/i.test(r.output),
        enabled:
          r.ok && /^\s*enabled:\s*(true|false)\s*$/im.test(r.output)
            ? /^\s*enabled:\s*true\s*$/im.test(r.output)
            : null,
      };
    }
    if (this.stopping) return;
    const help = await this.call(["shell", "cmd", "wifi", "help"]);
    if (this.stopping) return;
    if (help.ok && /^\s*status(?:\s|$)/m.test(help.output)) {
      const r = await this.call(["shell", "cmd", "wifi", "status"]);
      this.public.wifi = {
        accessible:
          r.ok && !/Permission Denial|SecurityException/i.test(r.output),
        enabled:
          r.ok && /Wifi is (enabled|disabled)/i.test(r.output)
            ? /Wifi is enabled/i.test(r.output)
            : null,
        connected: r.ok && /Wifi is connected to/i.test(r.output) ? true : null,
      };
    }
    for (const c of this.candidates) {
      if (this.stopping) return;
      const p = await this.call(["shell", "pidof", c.name]);
      const pids =
        p.ok && /^\s*\d+(?:\s+\d+)*\s*$/.test(p.output)
          ? p.output.trim().split(/\s+/).slice(0, 32)
          : [];
      const previous = c.running;
      c.running = pids.length > 0 ? true : null;
      for (const [pid, alias] of this.knownPids)
        if (alias === c.alias) this.knownPids.delete(pid);
      for (const pid of pids) this.knownPids.set(pid, c.alias);
      if (previous !== undefined && previous !== c.running)
        this.event({
          category: c.running ? "process-start" : "process-not-observed",
          scope: "validated-package-process",
          package: c.alias,
        });
    }
  }
  event(e) {
    const c = e.category;
    this.public.categories[c] = Math.min(
      1000000,
      (this.public.categories[c] || 0) + 1,
    );
    this.onEvent(e);
  }
  start() {
    this.stopping = false;
    if (this.public.status !== "authorized" || !this.format) return;
    const args = [
      "logcat",
      "-v",
      this.format,
      ...(this.tail ? ["-T", "1"] : []),
      ...TAGS.map((t) => t + ":V"),
      "*:S",
    ];
    this.child = this.spawn("adb", ["-t", this.transport, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.public.historyWindow = this.tail
      ? "tail-requested"
      : this.format === "epoch" && this.public.clocks.length
        ? "epoch-filtered"
        : "historical-possible";
    const clock = this.public.clocks.at(-1);
    const androidCutoff = clock
      ? Date.now() + clock.offsetMs - clock.uncertaintyMs - 1
      : null;
    let buffer = "",
      bytes = 0,
      dropping = false;
    this.child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_LOG) {
        this.public.truncated = true;
        this.child.kill("SIGTERM");
        return;
      }
      buffer += chunk.toString("utf8");
      let at;
      while ((at = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        if (dropping) {
          dropping = false;
          this.public.discarded++;
          continue;
        }
        if (line.startsWith("--------- beginning of ")) {
          if (this.public.logcatVisibility !== "restricted")
            this.public.logcatVisibility = "readable-partial";
          continue;
        }
        const e = logRecord(line, this.format, this.knownPids);
        if (
          e &&
          e.androidMs !== null &&
          androidCutoff !== null &&
          e.androidMs < androidCutoff
        ) {
          this.public.discarded = Math.min(1000000, this.public.discarded + 1);
          continue;
        }
        if (e && this.public.logcatVisibility !== "restricted")
          this.public.logcatVisibility = "readable-partial";
        if (e) this.event(e);
        else
          this.public.discarded = Math.min(1000000, this.public.discarded + 1);
      }
      if (Buffer.byteLength(buffer) > MAX_LINE) {
        buffer = "";
        dropping = true;
        this.public.discarded++;
      }
    });
    // Categorize access failure without retaining the diagnostic body.
    this.child.stderr.on("data", (chunk) => {
      if (/permission|not allowed|denied/i.test(chunk.toString("utf8")))
        this.public.logcatVisibility = "restricted";
    });
    this.child.on("error", () => {
      this.public.logcatVisibility = "unavailable";
    });
    this.child.on("exit", (code) => {
      if (!this.stopping && code !== 0)
        this.public.logcatVisibility = "unavailable-or-disconnected";
    });
  }
  async stop() {
    this.stopping = true;
    if (!this.child) return;
    const child = this.child;
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null)
        return resolve();
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 1000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill("SIGTERM");
    });
  }
}
module.exports = {
  Android,
  command,
  devices,
  packages,
  packageMetadata,
  logRecord,
  clockSample,
  CATEGORIES,
  TAGS,
  MAX_LOG,
  MAX_LINE,
};
