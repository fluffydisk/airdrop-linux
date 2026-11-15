"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  zlib = require("node:zlib");
const {
  atomicJson,
  atomicText,
  ownedDirectory,
  capabilities,
} = require("../../lib/sharing/lab-evidence");
const d = require("../../lib/sharing/quickshare-diagnostics");
const { sanitizeBluetooth } = require("../../lib/sharing/quickshare");
const { timeline: labTimeline } = require("./report.cjs");
const { CATEGORIES } = require("./adb.cjs");
const PHASES = [
  "BASELINE",
  "ANDROID_RECEIVE_OPEN",
  "ANDROID_SEND_OPEN",
  "LINUX_DISCOVERY_RUNNING",
  "RECIPIENT_SELECTED",
  "CONNECTION_ATTEMPTED",
  "AUTHENTICATION",
  "FILE_ACCEPTED",
  "TRANSFER_COMPLETED",
  "TEST_ENDED",
];
const PROVENANCE = [
  "Direct runtime observation",
  "Phone system observation",
  "Owner UI observation",
  "Source-code inference",
  "Unknown",
];
const FILES = [
  "quickshare-deep-diagnostic.md",
  "quickshare-deep-diagnostic.json",
  "quickshare-event-timeline.json",
];
const num = (v, max = 1e9) => d.integer(v, max),
  bool = (v) => (typeof v === "boolean" ? v : null);
const enumOf = (v, values, fallback = "unknown") =>
  values.includes(v) ? v : fallback;
const hex = (v, n) =>
  typeof v === "string" && new RegExp("^[a-f0-9]{" + n + "}$").test(v)
    ? v
    : null;
const ver = (v) =>
  typeof v === "string" && /^\d{1,6}(?:\.\d{1,9}){0,4}$/.test(v) ? v : null;
const timestamp = (v) =>
  typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)
    ? v
    : null;
function adapters(value = {}) {
  const drivers = [
    "btusb",
    "btrtl",
    "btintel",
    "btbcm",
    "hci_uart",
    "rtl8821ce",
    "rtw_8821ce",
    "rtw88_8821ce",
    "iwlwifi",
    "ath9k",
    "ath10k_pci",
    "ath11k_pci",
    "brcmfmac",
    "mt76",
  ];
  const hex4 = (v) =>
    typeof v === "string" && /^[a-fA-F0-9]{4}$/.test(v)
      ? v.toLowerCase()
      : null;
  const pci = (v) =>
    typeof v === "string" && /^0x[a-fA-F0-9]{4}$/.test(v)
      ? v.toLowerCase()
      : null;
  return {
    bluetooth: (Array.isArray(value.bluetooth) ? value.bluetooth : [])
      .slice(0, 16)
      .map((v) => ({
        driver: enumOf(v.driver, drivers),
        usbVendor: hex4(v.usbVendor),
        usbProduct: hex4(v.usbProduct),
      })),
    wifi: (Array.isArray(value.wifi) ? value.wifi : [])
      .slice(0, 16)
      .map((v) => ({
        driver: enumOf(v.driver, drivers),
        vendor: pci(v.vendor),
        device: pci(v.device),
      })),
  };
}
function sample(s) {
  if (
    !s ||
    ![
      s.hostMs,
      s.androidMs,
      s.offsetMs,
      s.latencyMs,
      s.uncertaintyMs,
      s.precisionMs,
    ].every(Number.isFinite) ||
    s.hostMs < 1e12 ||
    s.hostMs > 1e14 ||
    s.androidMs < 1e12 ||
    s.androidMs > 1e14 ||
    s.latencyMs < 0 ||
    s.latencyMs > 5000 ||
    s.uncertaintyMs < 0 ||
    s.uncertaintyMs > 5000 ||
    s.precisionMs < 0 ||
    s.precisionMs > 1000
  )
    return null;
  return Object.fromEntries(
    [
      "hostMs",
      "androidMs",
      "offsetMs",
      "latencyMs",
      "uncertaintyMs",
      "precisionMs",
    ].map((k) => [k, s[k]]),
  );
}
function android(v = {}) {
  return {
    requested: v.requested === true,
    consent: enumOf(v.consent, ["explicit-flag", "interactive-phrase"]),
    pollFailed: v.pollFailed === true,
    status: enumOf(v.status, [
      "authorized",
      "no-device",
      "multiple-devices",
      "unauthorized",
      "disconnected",
      "usb-disconnected",
      "usb-transport-unconfirmed",
      "host-usb-permission-denied",
      "adb-unavailable",
      "adb-failed",
      "not-requested",
      "consent-missing",
    ]),
    securityPatch:
      typeof v.securityPatch === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(v.securityPatch)
        ? v.securityPatch
        : null,
    buildType: enumOf(v.buildType, ["user", "userdebug", "eng"]),
    historyWindow: enumOf(v.historyWindow, [
      "tail-requested",
      "epoch-filtered",
      "historical-possible",
    ]),
    packageDiscovery: {
      accessible: bool(v.packageDiscovery?.accessible),
      matched: num(v.packageDiscovery?.matched, 16),
      rejected: num(v.packageDiscovery?.rejected, 16),
      restricted: num(v.packageDiscovery?.restricted, 16),
    },
    commandLatency: {
      count: num(v.commandLatency?.count),
      minMs: num(Math.round(v.commandLatency?.minMs), 10000),
      maxMs: num(Math.round(v.commandLatency?.maxMs), 10000),
      timeouts: num(v.commandLatency?.timeouts),
      outputLimits: num(v.commandLatency?.outputLimits),
    },
    attachedCount: num(v.attachedCount, 100),
    adbVersion: ver(v.adbVersion),
    android: ver(v.android),
    sdk: ver(v.sdk),
    oneUi: ver(v.oneUi),
    packages: (v.packages || [])
      .slice(0, 16)
      .filter((p) => /^package-[1-9][0-9]?$/.test(p?.alias || ""))
      .map((p) => ({
        alias: p.alias,
        role: enumOf(p.role, ["play-services", "quickshare-candidate"]),
        system: p.system === true,
        versionCode:
          typeof p.versionCode === "string" && /^\d{1,12}$/.test(p.versionCode)
            ? p.versionCode
            : null,
        versionName: ver(p.versionName),
        attribution: "candidate-only",
      })),
    services: Object.fromEntries(
      ["bluetooth", "wifi"].map((k) => [
        k,
        enumOf(v.services?.[k], ["available"]),
      ]),
    ),
    bluetooth: {
      observationStatus: enumOf(v.bluetooth?.observationStatus, [
        "readable",
        "permission-denied",
        "output-limit",
        "timeout",
        "command-failed",
        "unavailable",
      ]),
      accessible: bool(v.bluetooth?.accessible),
      enabled: bool(v.bluetooth?.enabled),
    },
    wifi: {
      observationStatus: enumOf(v.wifi?.observationStatus, [
        "readable",
        "permission-denied",
        "output-limit",
        "timeout",
        "command-failed",
        "unavailable",
        "status-command-not-advertised",
      ]),
      accessible: bool(v.wifi?.accessible),
      enabled: bool(v.wifi?.enabled),
      connected: bool(v.wifi?.connected),
    },
    logcatFormat: enumOf(v.logcatFormat, [
      "epoch",
      "threadtime",
      "unsupported",
    ]),
    logcatVisibility: enumOf(v.logcatVisibility, [
      "readable-partial",
      "restricted",
      "unavailable",
      "unavailable-or-disconnected",
    ]),
    categories: Object.fromEntries(
      [...CATEGORIES, "usb-disconnected"]
        .filter((k) => Object.hasOwn(v.categories || {}, k))
        .map((k) => [k, num(v.categories[k])]),
    ),
    discarded: num(v.discarded),
    truncated: v.truncated === true,
    clocks: (v.clocks || []).slice(0, 12).map(sample).filter(Boolean),
    visibility:
      "Privileged service internals may be inaccessible; absent events are UNKNOWN.",
  };
}
function extraTimeline(input = [], clocks = []) {
  return input.slice(-2000).flatMap((e) => {
    if (!e || !Number.isSafeInteger(e.elapsedMs) || e.elapsedMs < 0) return [];
    const base = {
      hostAt: timestamp(e.hostAt),
      elapsedMs: num(e.elapsedMs, 86400000),
    };
    if (e.type === "marker" && PHASES.includes(e.phase))
      return [
        {
          ...base,
          type: "marker",
          phase: e.phase,
          provenance:
            e.manual === true
              ? "Owner UI observation"
              : "Direct runtime observation",
          meaning:
            e.manual === true
              ? "Owner marked an action; this is not a success assertion."
              : "Runner phase",
        },
      ];
    if (
      e.type === "android" &&
      [...CATEGORIES, "usb-disconnected"].includes(e.category)
    ) {
      const value = {
        ...base,
        type: "android",
        category: e.category,
        provenance: "Phone system observation",
        scope: enumOf(e.scope, [
          "transport",
          "validated-package-process",
          "unattributed-system",
        ]),
      };
      if (/^package-[1-9][0-9]?$/.test(e.package || ""))
        value.package = e.package;
      if (
        Number.isFinite(e.androidMs) &&
        e.androidMs >= 1e12 &&
        e.androidMs < 1e14 &&
        clocks.length
      ) {
        const nearest = clocks.reduce((a, b) =>
          Math.abs(b.hostMs - Date.parse(base.hostAt)) <
          Math.abs(a.hostMs - Date.parse(base.hostAt))
            ? b
            : a,
        );
        value.androidMs = e.androidMs;
        value.hostEstimateMs = e.androidMs - nearest.offsetMs;
        value.uncertaintyMs =
          Math.max(...clocks.map((s) => s.offsetMs + s.uncertaintyMs)) -
          Math.min(...clocks.map((s) => s.offsetMs - s.uncertaintyMs));
        value.uncertaintyMs /= 2;
        const low = Math.min(
            ...clocks.map((s) => s.offsetMs - s.uncertaintyMs),
          ),
          high = Math.max(...clocks.map((s) => s.offsetMs + s.uncertaintyMs));
        value.hostEstimateMs = e.androidMs - (low + high) / 2;
        value.uncertaintyScope =
          "Sampled offset envelope only; between-sample drift and log delay remain unknown";
        value.clock = "android-epoch-estimate";
      } else value.clock = "host-receipt-only";
      return [value];
    }
    return [];
  });
}
function findings(b, p, events, a) {
  const c = b.diagnostics.counters,
    result = [];
  const add = (rank, kind, provenance, text) =>
    result.push({ rank, kind, provenance, text });
  if (c.adapter_disappeared || c.adapter_health_failed || c.runtime_failed)
    add(
      1,
      "adapter-runtime-interrupted",
      "Direct runtime observation",
      "The helper observed adapter loss or a radio-runtime failure. A later powered property or GATT registration is partial recovery, not proof of advertising or controller stability. Kernel reset and audio-service causality require separate system evidence; protocol disconnection timing does not establish their cause.",
    );
  if (c.scan_stop_failed || c.scan_stop_timeout || c.scan_stop_unobserved)
    add(
      1,
      "owned-scan-stop-unconfirmed",
      "Direct runtime observation",
      "An owned discovery lease lacked a successful observed stop. The affected generation must stop issuing radio work. A D-Bus acknowledgement, when available, confirms only that boundary and is not independent controller or RF completion evidence.",
    );
  const incompleteInbound = events.some(connection =>
    connection.type === "connection" && connection.direction === "incoming" &&
    connection.connectionMethod === "ble-l2cap" &&
    events.some(e => e.attempt === connection.attempt && e.direction === "incoming" &&
      e.type === "protocol" && e.stage.includes("Ukey")) &&
    !events.some(e => e.attempt === connection.attempt && e.direction === "incoming" && (
      e.type === "protocol" && ["WaitingForUserConsent", "ReceivingFiles", "Finished", "Rejected", "Cancelled"].includes(e.stage) ||
      e.type === "transfer" && ["awaiting-acceptance", "transferring", "verifying", "complete", "declined", "cancelled"].includes(e.phase))),
  );
  const postConsentNoPayload = events.some(connection =>
    connection.type === "connection" && connection.direction === "incoming" && connection.connectionMethod === "ble-l2cap" &&
    events.some(e => e.attempt === connection.attempt && e.type === "protocol" && e.stage === "ReceivingFiles") &&
    events.some(e => e.attempt === connection.attempt && e.type === "transfer" && e.phase === "interrupted" && e.bytes === 0 && e.total > 0) &&
    !events.some(e => e.attempt === connection.attempt && e.type === "transfer" && ["complete","verifying"].includes(e.phase)));
  if (postConsentNoPayload) add(1,"inbound-post-consent-no-payload","Direct runtime observation",
    "An inbound LE CoC session passed introduction and local consent response writing, then interrupted before any fixture bytes were recorded. ReceivingFiles does not prove the peer received acceptance or sent payload. Inspect per-attempt session diagnostics for socket read/write cause, encrypted file frames and BWU events. Older captures with only l2cap_transport_io_error cannot distinguish peer closure, link/controller error or negotiation failure. Later advertising renewal failure is a separate boundary; timing alone does not establish causality.");
  if (incompleteInbound)
    add(
      2,
      "inbound-ble-handshake-incomplete",
      "Direct runtime observation",
      "An inbound LE CoC connection reached UKEY2 processing without receiver finalization. SentConnectionResponse is a protocol state, not proof of completed mutual authentication, user consent or file delivery. A protocol failure and a controller interruption remain separate possibilities.",
    );
  if (
    c.advertisement_registration_failure &&
    !c.advertisement_registration_success
  )
    add(
      1,
      "receiver-advertising-registration-failed",
      "Direct runtime observation",
      `${c.advertisement_registration_failure} local BlueZ advertisement registration attempts failed with no registration success recorded. This is a local receiver-advertising boundary, separate from scanning remote Fast candidates. GATT service registration and an available LE CoC socket do not establish advertising or phone visibility. The old generic error counter cannot identify the BlueZ rejection cause.`,
    );
  if (
    c.advertisement_registration_success &&
    c.advertisement_registration_failure
  )
    add(
      1,
      "receiver-advertising-interrupted",
      "Direct runtime observation",
      `${c.advertisement_registration_success} local registrations succeeded and ${c.advertisement_registration_failure} failed. Earlier registration is not evidence of continued advertising or initial RF visibility. Inspect replacement trigger and cleanup completion separately from the phone's recipient UI.`,
    );
  if (
    c.advertisement_cleanup_error ||
    c.advertisement_cleanup_timeout ||
    c.advertisement_cleanup_owner_timeout
  )
    add(
      1,
      "receiver-advertising-cleanup-incomplete",
      "Direct runtime observation",
      "Advertisement cleanup failed or timed out. Normal replacement waits for unregister/owner teardown and backs off on incomplete cleanup. An unregister acknowledgement or zero ActiveInstances is not proof the controller completed removal.",
    );
  if (c.advertisement_publisher_failure || c.advertisement_validation_failure)
    add(
      1,
      "receiver-advertising-setup-failed",
      "Direct runtime observation",
      "Local parameter validation or advertisement publisher setup failed before BlueZ registration. Inspect the operation phase; this is not evidence of a peer GATT failure.",
    );
  if (c.fast_accepted && !b.resolved)
    add(
      2,
      "remote-fast-metadata-unresolved",
      "Direct runtime observation",
      `${c.fast_accepted} strict Fast parser acceptances did not produce a resolved endpoint. Connection attempts/failures and missing metadata concern Linux scanning remote candidates; those candidates are unattributed and do not explain local advertising rejection.`,
    );
  if (b.observed > 0 && b.decoded === 0)
    add(
      1,
      "confirmed-boundary",
      "Direct runtime observation",
      `${b.observed} FEF3 service-data observations reached Linux; the decoded-candidate status remained zero. Parsing, validation and filtering must be distinguished by the new counters. These are observations, not distinct phones, and Samsung attribution is UNKNOWN.`,
    );
  if (c.candidate_rejected)
    add(
      2,
      "rejection-evidence",
      "Direct runtime observation",
      `${c.candidate_rejected} observations were rejected by all applicable parsers in the captured build. Per-format reason counters describe validation gates, not a proven Samsung protocol defect.`,
    );
  if (c.unsupported_fast_well_formed)
    add(
      2,
      "unsupported-format-candidate",
      "Source-code inference",
      "A bounded Fast shape passed legacy diagnostic-only inspection and was rejected by the captured decoder. This does not establish complete validity or Samsung attribution; compare the recorded build with the strict Fast subset and its rejection counters.",
    );
  if (c.gatt_ownership_busy_rejected || c.gatt_ownership_capacity_rejected)
    add(
      2,
      "remote-gatt-ownership-guard",
      "Direct runtime observation",
      "Remote GATT resolution was refused by the owned-ACL guard (retained connection or capacity). Failed disconnects retain ownership conservatively. This is separate from local advertisement registration; no unrelated ACL is disconnected.",
    );
  if (c.gatt_resolution_failure || c.gatt_slot_read_failure)
    add(
      2,
      "gatt-failure",
      "Direct runtime observation",
      "GATT metadata resolution or slot reads failed. Review connection, service, slot and categorized D-Bus counters; this is distinct from Weave negotiation.",
    );
  if (
    c.dbus_not_supported ||
    c.dbus_permission_denied ||
    c.scan_start_failure ||
    c.adapter_disappeared
  )
    add(
      2,
      "linux-radio-limitation-candidate",
      "Direct runtime observation",
      "Linux radio operations failed or the adapter became unavailable. Registration alone cannot establish over-the-air transmission.",
    );
  if (c.transport_unavailable)
    add(
      3,
      "transport-unavailable",
      "Direct runtime observation",
      "At least one decoded candidate lacked a usable transport; endpoint decoding does not establish connectability.",
    );
  if (
    (p.recipient_route_published || 0) > 0 &&
    (p.renderer_publications || 0) === 0
  )
    add(
      3,
      "renderer-visibility-unknown",
      "Direct runtime observation",
      "Main-process routes were published; renderer acknowledgement was not observed.",
    );
  if (a.categories["permission-denied"])
    add(
      3,
      "android-permission-candidate",
      "Phone system observation",
      "A permission failure was observed. Unattributed system errors do not establish a Quick Share permission failure.",
    );
  if (
    events.some((e) => e.type === "helper" && e.status === "error") &&
    !events.some((e) => e.type === "shutdown-requested")
  )
    add(
      2,
      "helper-error",
      "Direct runtime observation",
      "A helper error preceded observed shutdown intent; inspect sanitized lifecycle and protocol stages.",
    );
  add(
    9,
    "unresolved",
    "Unknown",
    "No packet is attributed to Samsung by this report. Network limitations, Android service visibility, unsupported formats and radio behavior require controlled comparison; timestamp proximity alone is not causality.",
  );
  return result.sort((a, b) => a.rank - b.rank);
}
function create(input = {}) {
  const desktop = input.desktop || {},
    runtime = input.runtime || {},
    marker = input.marker || {},
    pf = input.preflight || {};
  const observation = input.active || desktop;
  const labStarted = Date.parse(observation.startedAt || desktop.startedAt);
  const during = (e) =>
    (!Number.isFinite(input.startedMs) ||
      !Number.isFinite(labStarted) ||
      labStarted + e.elapsedMs >= input.startedMs) &&
    (!Number.isFinite(input.endedMs) ||
      !Number.isFinite(labStarted) ||
      labStarted + e.elapsedMs <= input.endedMs);
  const events = labTimeline(observation.events).filter(during);
  if (
    input.active &&
    Number.isFinite(input.endedMs) &&
    Number.isFinite(labStarted)
  )
    events.push(
      ...labTimeline(desktop.events).filter(
        (e) =>
          ["helper", "shutdown-requested"].includes(e.type) &&
          labStarted + e.elapsedMs > input.endedMs,
      ),
    );
  let peak = sanitizeBluetooth(observation.peakBluetooth);
  for (const e of events)
    if (e.type === "bluetooth") peak = d.peak(peak, e.bluetooth);
  for (const s of [
    observation.helper?.bluetooth,
    observation.lastActiveHelper?.bluetooth,
  ])
    peak = d.peak(peak, sanitizeBluetooth(s));
  const active = observation.lastActiveHelper || observation.helper || {};
  const a = android(input.android || { status: "not-requested" }),
    pipeline = d.pipeline(observation.pipeline);
  const shutdownIndex = events.findIndex(
      (e) => e.type === "shutdown-requested",
    ),
    errorIndex = events.findIndex(
      (e) => e.type === "helper" && e.status === "error",
    );
  const lifecycle = d.lifecycle(desktop.helper?.lifecycle);
  const hasExit = !!desktop.helper?.lifecycle;
  const shutdown = {
    ...lifecycle,
    classification: hasExit
      ? lifecycle.outcome
      : shutdownIndex >= 0 && errorIndex > shutdownIndex
        ? "legacy-error-after-shutdown-intent"
        : errorIndex >= 0
          ? "helper-error-observed"
          : "unknown",
    qualification: hasExit
      ? "Explicit lifecycle outcome. Forced shutdown is distinct from a clean exit."
      : "Legacy ordering alone cannot distinguish expected teardown from a process failure.",
  };
  const c = peak.diagnostics.counters;
  const evidenceStages = {
    fef3Observed: peak.observed > 0,
    parserAccepted:
      Object.hasOwn(c, "full_accepted") ||
      Object.hasOwn(c, "compact_accepted") ||
      Object.hasOwn(c, "fast_accepted")
        ? (c.full_accepted || 0) +
            (c.compact_accepted || 0) +
            (c.fast_accepted || 0) >
          0
        : peak.observed > 0 && !(c.candidate_rejected > 0)
          ? null
          : false,
    gattMetadataResolved: peak.resolved > 0,
    gattSlotDecoded: c.gatt_slot_decoded > 0,
    endpointPublished: peak.decoded > 0,
    transportReady: peak.ready > 0,
    recipientRoutePublished: pipeline.recipient_route_published > 0,
    rendererAcknowledged: pipeline.renderer_publications > 0,
    weaveEstablished: c.weave_established > 0,
    l2capEstablished: events.some(
      (e) =>
        e.type === "bluetooth" && e.bluetooth.stage === "l2cap-established",
    ),
    ukey2Reached: events.some(
      (e) => e.type === "protocol" && e.stage.includes("Ukey"),
    ),
    fileStateReached: events.some(
      (e) =>
        e.type === "transfer" &&
        ["transferring", "verifying", "complete", "outcome-unknown"].includes(
          e.phase,
        ),
    ),
  };
  const observations = {
    recipientVisible:
      input.owner?.recipientVisible === true ? "confirmed" : "unknown",
    nativeCompleted:
      input.owner?.nativeCompleted === true ? "confirmed" : "unknown",
  };
  const expectedSha256 = hex(input.integrity?.expectedSha256, 64),
    actualSha256 = hex(input.integrity?.actualSha256, 64);
  const hashMatches =
    input.integrity?.fixtureMatch === true &&
    expectedSha256 !== null &&
    actualSha256 === expectedSha256 &&
    Number.isSafeInteger(input.integrity?.size) &&
    input.integrity.size >= 0 &&
    input.integrity.size <= 3 * 1024 * 1024;
  const localPayloadCompletionObserved = events.some(
    (e) =>
      (e.type === "transfer" &&
        ["complete", "outcome-unknown"].includes(e.phase)) ||
      (e.type === "protocol" && e.stage === "Sent") ||
      (e.type === "finalization" && e.stage === "LocalPayloadComplete"),
  );
  const finalization = events.filter((e) => e.type === "finalization");
  const connectionEvents = events.filter((e) => e.type === "connection");
  const methods = [
    ...new Set(
      (connectionEvents.length ? connectionEvents : events)
        .filter(
          (e) =>
            ["transfer", "connection"].includes(e.type) &&
            d.CONNECTION_METHODS.has(e.connectionMethod),
        )
        .map((e) => e.connectionMethod),
    ),
  ];
  const ukeyObserved = events.some(
    (e) => e.type === "protocol" && e.stage.includes("Ukey"),
  );
  const noBleConnection =
    !c.weave_established &&
    !c.l2cap_connection_succeeded &&
    !events.some(
      (e) =>
        e.type === "bluetooth" &&
        ["weave-established", "l2cap-established"].includes(e.bluetooth.stage),
    );
  const inferredLan =
    input.direction === "linux-to-samsung" &&
    (c.fef3_observations !== undefined ||
      pf.helper?.capabilities?.ble === false) &&
    methods.length === 0 &&
    ukeyObserved &&
    noBleConnection &&
    peak.decoded === 0 &&
    pipeline.recipient_route_published > 0;
  const selectedTransport =
    methods.length === 1 ? methods[0] : inferredLan ? "lan-tcp" : "unknown";
  const activeRuntime = input.activeRuntime || {};
  const listenerValue =
    typeof activeRuntime.listenerReachable === "boolean"
      ? activeRuntime.listenerReachable
      : typeof runtime.lastActive?.listenerReachable === "boolean"
        ? runtime.lastActive.listenerReachable
        : runtime.status === "running" &&
            typeof runtime.listenerReachable === "boolean"
          ? runtime.listenerReachable
          : null;
  const report = {
    schema: 2,
    provenanceTypes: PROVENANCE,
    createdAt: new Date().toISOString(),
    experimental: true,
    samsungCompatibilityEstablished: false,
    productionAcceptanceEstablished: false,
    direction: enumOf(input.direction, [
      "linux-to-samsung",
      "samsung-to-linux",
    ]),
    network: enumOf(input.network, ["ordinary", "hotspot", "school", "other"]),
    appleSharing: enumOf(input.appleSharing, ["on", "off", "not-available"]),
    captureStartedAt: Number.isFinite(input.startedMs)
      ? new Date(input.startedMs).toISOString()
      : null,
    observationEndedAt: Number.isFinite(input.endedMs)
      ? new Date(input.endedMs).toISOString()
      : null,
    durationMs: num(input.durationMs, 86400000),
    failedStage: enumOf(input.failedStage, [
      "preflight",
      "usb-preflight",
      "prepare",
      "start",
      "capture",
      "integrity",
      "stop",
      "session-changed",
    ]),
    captureOutcome: enumOf(input.outcome, [
      "completed",
      "interrupted",
      "blocked",
      "failed",
    ]),
    build: {
      commit: hex(marker.commit, 40),
      currentCommit: hex(pf.source?.commit, 40),
      dirty: marker.dirty === true,
      helperSha256: hex(marker.helperSha256, 64),
      sourceTreeSha256: hex(marker.build?.sourceTreeSha256, 64),
      helperHashVerified:
        pf.helper?.hashMatches === true &&
        pf.helper?.sha256 === marker.helperSha256,
      sourceVerified:
        marker.commit === pf.source?.commit &&
        marker.fingerprint === pf.source?.fingerprint,
      features: (marker.build?.features || []).filter((v) =>
        ["ble-native", "ble-fastinit"].includes(v),
      ),
      compiledCapabilities: capabilities(pf.helper?.capabilities),
    },
    linux: {
      kernel: ver(pf.system?.kernel?.match(/^\d+\.\d+\.\d+/)?.[0]),
      distro: enumOf(pf.system?.distro, [
        "arch",
        "omarchy",
        "ubuntu",
        "debian",
        "fedora",
        "linuxmint",
        "opensuse-tumbleweed",
        "pop",
      ]),
      distroVersion: ver(pf.system?.distroVersion),
      versions: Object.fromEntries(
        ["node", "electron", "cargo", "rustc", "networkManager", "bluez"].map(
          (k) => [k, ver(pf.versions?.[k])],
        ),
      ),
      controller: sanitizeBluetooth({
        controller: pf.helper?.bluetooth || peak.controller,
      }).controller || { bluez: false, registrationTested: false },
      adapters: adapters(pf.adapters),
      bluetoothAdapters: num(pf.adapters?.bluetooth?.length, 16),
      wifiAdapters: num(pf.adapters?.wifi?.length, 16),
      dependencies: Object.fromEntries(
        [
          "cargo",
          "rustc",
          "npm",
          "protoc",
          "cc",
          "pkg-config",
          "git",
          "dbusDevelopment",
          "electronBinary",
        ].map((k) => [k, pf.dependencies?.[k] === true]),
      ),
      services: {
        bluez: bool(pf.services?.bluez),
        networkManager: bool(pf.services?.networkManager),
      },
    },
    evidenceStages,
    bluetooth: {
      rejectionReasonCoverage:
        peak.observed === 0
          ? "not-exercised"
          : c.candidate_rejected ||
              c.full_accepted ||
              c.compact_accepted ||
              c.fast_accepted
            ? "instrumented"
            : "unavailable",
      windowCounters: Object.fromEntries(
        Object.entries(peak.diagnostics.counters).map(([k, v]) => [
          k,
          Math.max(
            0,
            v -
              d.integer(
                input.baseline?.helper?.bluetooth?.diagnostics?.counters?.[k],
              ),
          ),
        ]),
      ),
      peak: sanitizeBluetooth(peak),
      lastActive: sanitizeBluetooth(active.bluetooth),
      remoteGattConnectionErrorCategories: Object.fromEntries(
        Object.entries(c).filter(([k]) =>
          k.startsWith("gatt_connection_error_"),
        ),
      ),
      receiverAdvertising: {
        registrationObserved: (c.advertisement_registration_success || 0) > 0,
        requested: c.advertisement_registration_requested || 0,
        succeeded: c.advertisement_registration_success || 0,
        failed: c.advertisement_registration_failure || 0,
        publisherFailed: c.advertisement_publisher_failure || 0,
        validationFailed: c.advertisement_validation_failure || 0,
        lastAttempt: peak.diagnostics?.advertising || null,
        lastCleanup: peak.diagnostics?.advertisingCleanup || null,
        renewalRequests: c.advertisement_renewal_requested || 0,
        failureDetails: Object.fromEntries(
          Object.entries(c).filter(([k]) =>
            k.startsWith("advertisement_failure_detail_"),
          ),
        ),
        errorCategories: Object.fromEntries(
          Object.entries(c).filter(([k]) =>
            k.startsWith("advertisement_error_"),
          ),
        ),
        gattServiceRegistered: (c.gatt_registration_success || 0) > 0,
        l2capSocketBound: (c.l2cap_bind_success || 0) > 0,
        onAirTransmission: "unknown",
        cleanupQualification:
          "Cleanup records unregister acknowledgement, owned I/O teardown and a bounded guard interval. BlueZ can acknowledge after queuing controller removal; neither this barrier nor global instance samples prove MGMT completion, RF emission, or Samsung visibility.",
        qualification:
          "Registration is a BlueZ API observation, not independent proof of RF emission or Samsung visibility. Context instance counts and discovery state are samples before the attempt; no global radio or policy change is made. NotPermitted can indicate capacity; it does not by itself prove a permissions defect. Failed can hide a controller status code.",
      },
      counterSemantics:
        "Cumulative helper-lifetime counters. Full and compact parsers are attempted per observation; Fast is additionally tried only on a Fast-marked full rejection; candidate_rejected counts observations accepted by none. Address-based ephemeral candidates can rotate and are not device counts. Registration is not proof of emission.",
      provenance: "Direct runtime observation",
    },
    lan: {
      localMdnsObserved: runtime.advertisements?.ownObserved === true,
      maxVisible: num(runtime.advertisements?.maxVisible, 100),
      listenerReachable: listenerValue,
      listenerReachableEver:
        runtime.listenerReachableEver === true || listenerValue === true,
      listenerReachableAfterShutdown:
        runtime.status === "stopped" ? bool(runtime.listenerReachable) : null,
      listenerObservation:
        typeof activeRuntime.listenerReachable === "boolean"
          ? "captured-before-teardown"
          : runtime.lastActive
            ? "preserved-last-active"
            : runtime.status === "stopped"
              ? "legacy-stopped-snapshot-unknown"
              : "unknown",
      listenerProvenance:
        listenerValue === null ? "Unknown" : "Direct runtime observation",
      qualification:
        "This probes Linux's inbound listener; an outgoing TCP session is independent. A stopped-state false does not establish an active-session failure.",
      phoneAttribution: "unknown",
    },
    android: a,
    pipeline,
    shutdown,
    owner: observations,
    transfer: {
      sessionDiagnostics: events.filter(e => e.type === "session"),
      localPayloadCompletionObserved,
      selectedTransport,
      discoveryPath:
        selectedTransport === "lan-tcp"
          ? "mdns"
          : selectedTransport.startsWith("ble-")
            ? "ble"
            : "unknown",
      transportProvenance:
        methods.length === 1
          ? "Direct runtime observation"
          : inferredLan
            ? "Source-code inference"
            : "Unknown",
      peerCloseObserved: finalization.some((e) =>
        ["PeerEof", "PeerDisconnection"].includes(e.stage),
      ),
      peerCloseStatus: finalization.some((e) =>
        ["PeerEof", "PeerDisconnection"].includes(e.stage),
      )
        ? "observed"
        : finalization.some((e) => e.stage === "PeerCloseTimeout")
          ? "timeout"
          : "unknown",
      payloadReceiptAckObserved: finalization.some(
        (e) => e.stage === "PayloadReceiptAckObserved",
      ),
      finalizationFailureObserved: finalization.some((e) =>
        ["FinalizationReadError", "PeerPayloadFailure"].includes(e.stage),
      ),
      payloadReceiptAckStatus: finalization.some(
        (e) => e.stage === "PayloadReceiptAckObserved",
      )
        ? "observed"
        : finalization.length
          ? "not-observed"
          : "unknown",
      payloadReceiptAckEncoding: finalization.some(
        (e) => e.stage === "PayloadReceiptAckModernObserved",
      )
        ? "packet-type-3"
        : finalization.some(
              (e) => e.stage === "PayloadReceiptAckLegacyObserved",
            )
          ? "legacy-control"
          : "unknown",
      payloadReceiptAckScope:
        "At least one matched file payload ID; not proof all files were durably finalized.",
      remoteApplicationSuccessAcknowledged: false,
      remoteApplicationSuccessStatus:
        "No implemented durable application-success acknowledgement; EOF/disconnection/payload receipt are separate observations.",
      receiverFinalizationObserved: events.some(
        (e) =>
          e.type === "transfer" &&
          e.direction === "incoming" &&
          e.phase === "complete",
      ),
      nativeUiCompletion: observations.nativeCompleted,
      independentFixtureMatch: hashMatches,
      fixtureReadback: {
        fixture: "lab-small.txt",
        expectedSha256,
        actualSha256,
        size:
          Number.isSafeInteger(input.integrity?.size) &&
          input.integrity.size >= 0 &&
          input.integrity.size <= 3 * 1024 * 1024
            ? input.integrity.size
            : null,
      },
      outcome:
        localPayloadCompletionObserved &&
        observations.nativeCompleted === "confirmed" &&
        hashMatches
          ? "owner-confirmed-with-independent-bytes"
          : "unconfirmed",
      provenance: {
        protocol: localPayloadCompletionObserved
          ? "Direct runtime observation"
          : "Unknown",
        nativeUi:
          observations.nativeCompleted === "confirmed"
            ? "Owner UI observation"
            : "Unknown",
        fixtureReadback: actualSha256
          ? "Direct runtime observation"
          : "Unknown",
      },
    },
    findings: findings(peak, pipeline, events, a),
    nextTests: [
      ...(events.some(e => e.type === "protocol" && e.stage === "ReceivingFiles") && !events.some(e => e.type === "transfer" && e.direction === "incoming" && e.phase === "complete") ? ["Prioritize one generated 49-byte Samsung-to-Linux transfer with private code comparison and explicit consent. Record consent-response-written, socket read/write stage/cause, BWU events, authenticated file frames and finalization independently. Do not attribute a later renewal failure to the transfer without additional evidence."] : []),
      "First verify local receiver advertisement registration on ordinary home LAN, unchanged radio settings and an unused private workspace. For Samsung-to-Linux, open native Share after the baseline; record whether Airdrop S24 Lab stays visible across the 90-second renewal. Registration alone does not prove RF emission.",
      "If registration fails, inspect receiverAdvertising.lastAttempt phase/errorName/category, compact payload budget, instance samples and discovery state before changing protocol parsing or system permissions.",
      "Defer hotspot and Apple-sharing setting comparisons until the local advertising failure is characterized; preserve the previously verified ordinary-LAN sender path.",
      "Compare baseline with Receive closed against an explicit ANDROID_RECEIVE_OPEN marker. A changed rejection count is a hypothesis, not phone attribution.",
      "If supported-format counters stay zero, review exact reason, length and version buckets before proposing a parser change.",
      "If GATT is reached, identify connection, service, slot, characteristic and Weave boundaries independently.",
      "Only after native completion, independently read back the generated fixture bytes and rerun/collect with --readback; never use an answer of pass as integrity evidence.",
    ],
    privacy: {
      rawLogs: false,
      rawAdvertisements: false,
      hci: false,
      automaticUpload: false,
      retention:
        "Only sanitized reports and isolated disposable lab files persist. Delete the private workspace after review; stop the lab first.",
      limitations: [
        "Unprivileged Android may hide Nearby/Quick Share internals. Missing events mean UNKNOWN.",
        "Validated package candidates are not proof of the active Quick Share service. Process categories may be unattributed.",
        "Host timestamps and clock samples have latency/precision uncertainty; logs can be delayed.",
        "No addresses, serials, SSIDs, accounts, packet payloads, personal filenames, codes or keys are exported. Unparseable log records are discarded.",
        "Default reports contain build versions, fixed counters, time samples and owner-selected test settings. Review before sharing.",
      ],
    },
  };
  const extra = extraTimeline(input.events, a.clocks);
  const bluetoothEvents = events.filter((e) => e.type === "bluetooth");
  const keep = new Set(
    bluetoothEvents.length > 256
      ? Array.from(
          { length: 256 },
          (_, i) =>
            bluetoothEvents[
              Math.round((i * (bluetoothEvents.length - 1)) / 255)
            ],
        )
      : bluetoothEvents,
  );
  const exportedEvents = events.filter(
    (e) => e.type !== "bluetooth" || keep.has(e),
  );
  const started = Date.parse(desktop.startedAt);
  const linuxEvents = exportedEvents.map((e) => ({
    ...e,
    hostAt:
      Number.isFinite(started) && e.elapsedMs <= 86400000
        ? new Date(started + e.elapsedMs).toISOString()
        : null,
    elapsedMs:
      Number.isFinite(started) && Number.isFinite(input.startedMs)
        ? Math.max(0, Math.round(started + e.elapsedMs - input.startedMs))
        : e.elapsedMs,
    provenance: "Direct runtime observation",
  }));
  return {
    report,
    timeline: {
      schema: 1,
      sampledBluetooth: bluetoothEvents.length > 256,
      omittedBluetoothEvents: Math.max(0, bluetoothEvents.length - 256),
      clockSamples: a.clocks,
      causality:
        "Temporal correlation is a hypothesis; no peer attribution is inferred.",
      events: [...linuxEvents, ...extra]
        .sort((a, b) => Date.parse(a.hostAt) - Date.parse(b.hostAt))
        .slice(-2000),
      truncated:
        desktop.truncated === true ||
        input.truncated === true ||
        linuxEvents.length + extra.length > 2000,
    },
  };
}
function markdown(r) {
  return [
    "# Quick Share deep diagnostic",
    "",
    `Commit: ${r.build.commit || "unknown"} · helper SHA-256: ${r.build.helperSha256 || "unknown"}`,
    `Direction: ${r.direction} · network: ${r.network} · capture outcome: ${r.captureOutcome}`,
    "",
    "**Production compatibility acceptance: not established. Single-fixture evidence is separate.**",
    "",
    `FEF3 observations: ${r.bluetooth.peak.observed}; decoded: ${r.bluetooth.peak.decoded}; GATT-resolved: ${r.bluetooth.peak.resolved}; ready: ${r.bluetooth.peak.ready}.`,
    `ADB: ${r.android.status}; log visibility: ${r.android.logcatVisibility}.`,
    `Shutdown: ${r.shutdown.classification}. Transfer: ${r.transfer.outcome}.`,
    "",
    `Runner failure stage: ${r.failedStage}. Clock alignment: sampled offset envelope; unsampled drift and log delivery delay remain unknown.`,
    "## Findings",
    "",
    ...r.findings.map((f) => `- [${f.provenance}] ${f.text}`),
    "",
    "## Session boundaries",
    ...(r.transfer.sessionDiagnostics.length ? r.transfer.sessionDiagnostics.slice(0,100).map(e => `${e.attempt}: ${e.stage}; cause=${e.cause} (Direct runtime observation; local boundary only).`) : ["No categorized session diagnostics in this captured build. Transport error cause remains unknown."]),
    "",
    "## Local receiver advertising",
    "",
    `BlueZ registration: ${r.bluetooth.receiverAdvertising.succeeded} succeeded / ${r.bluetooth.receiverAdvertising.failed} failed / ${r.bluetooth.receiverAdvertising.requested} requested. GATT service registered: ${r.bluetooth.receiverAdvertising.gattServiceRegistered}; LE CoC socket bound: ${r.bluetooth.receiverAdvertising.l2capSocketBound}. Independent RF transmission: unknown.`,
    r.bluetooth.receiverAdvertising.lastAttempt
      ? `Last attempt: phase=${r.bluetooth.receiverAdvertising.lastAttempt.phase}; mode=${r.bluetooth.receiverAdvertising.lastAttempt.mode}; result=${r.bluetooth.receiverAdvertising.lastAttempt.result}; error=${r.bluetooth.receiverAdvertising.lastAttempt.errorName}; category=${r.bluetooth.receiverAdvertising.lastAttempt.category}; detail=${r.bluetooth.receiverAdvertising.lastAttempt.failureDetail}; trigger=${r.bluetooth.receiverAdvertising.lastAttempt.trigger}; service bytes=${r.bluetooth.receiverAdvertising.lastAttempt.serviceDataBytes}; conservative legacy bytes=${r.bluetooth.receiverAdvertising.lastAttempt.estimatedLegacyBytes}; type=${r.bluetooth.receiverAdvertising.lastAttempt.advertisementType}; secondary=${r.bluetooth.receiverAdvertising.lastAttempt.secondaryChannel}; discoverable=${r.bluetooth.receiverAdvertising.lastAttempt.discoverable}; discovery=${r.bluetooth.receiverAdvertising.lastAttempt.discovery}; own scan paused=${r.bluetooth.receiverAdvertising.lastAttempt.ownScanPaused}; retry=${r.bluetooth.receiverAdvertising.lastAttempt.retrySeconds}s; available/active instances=${r.bluetooth.receiverAdvertising.lastAttempt.availableInstances}/${r.bluetooth.receiverAdvertising.lastAttempt.activeInstances}.`
      : "Last categorized advertising attempt: unavailable in this captured build. Cause remains unknown.",
    "",
    r.bluetooth.receiverAdvertising.lastCleanup
      ? `Last cleanup: reason=${r.bluetooth.receiverAdvertising.lastCleanup.reason}; result=${r.bluetooth.receiverAdvertising.lastCleanup.result}; unregister=${r.bluetooth.receiverAdvertising.lastCleanup.unregisterResult}; error=${r.bluetooth.receiverAdvertising.lastCleanup.errorName}; age=${r.bluetooth.receiverAdvertising.lastCleanup.ageMs}ms of lease ${r.bluetooth.receiverAdvertising.lastCleanup.leaseMs}ms; daemon Release before/during cleanup=${r.bluetooth.receiverAdvertising.lastCleanup.daemonReleaseBeforeCleanup}/${r.bluetooth.receiverAdvertising.lastCleanup.daemonReleaseDuringCleanup}; I/O stopped=${r.bluetooth.receiverAdvertising.lastCleanup.ioStopped}; owner scope closed=${r.bluetooth.receiverAdvertising.lastCleanup.ownerScopeClosed}; guard interval=${r.bluetooth.receiverAdvertising.lastCleanup.settleMs}ms. This is not controller completion or RF evidence.`
      : "Awaited cleanup evidence: unavailable in this captured build. A local handle drop is not a recorded BlueZ Release callback.",
    "",
    "## Rejection and lifecycle counters",
    "",
    "| Counter | Count |",
    "| --- | ---: |",
    ...Object.entries(r.bluetooth.peak.diagnostics.counters).map(
      ([k, v]) => `| ${k} | ${v} |`,
    ),
    "",
    "## Next physical tests",
    "",
    ...r.nextTests.map((v) => "- " + v),
    "",
    "## Privacy and limitations",
    "",
    ...r.privacy.limitations.map((v) => "- " + v),
    "",
    r.privacy.retention,
    "",
    "The JSON report contains capability, GATT/LE CoC, IPC, renderer, Android, clock and owner evidence. The separate timeline preserves protocol/consent/transfer transitions. No data is uploaded.",
    "",
  ].join("\n");
}
function archive(buffers) {
  // Construct from sanitized generated buffers, never walk a directory.
  const chunks = [];
  for (const name of FILES) {
    const body = buffers[name];
    if (!Buffer.isBuffer(body) || body.length > 8 * 1024 * 1024)
      throw Error("Invalid approved report buffer");
    const h = Buffer.alloc(512);
    h.write(name);
    h.write("0000600\0", 100);
    h.write("0000000\0", 108);
    h.write("0000000\0", 116);
    h.write(body.length.toString(8).padStart(11, "0") + "\0", 124);
    h.write("00000000000\0", 136);
    h.fill(32, 148, 156);
    h[156] = 48;
    h.write("ustar\0", 257);
    h.write("00", 263);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
    chunks.push(h, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(chunks), { level: 9 });
}
function write(root, result, withArchive = false) {
  ownedDirectory(root);
  const directory = path.join(root, "reports");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  ownedDirectory(directory);
  const buffers = {
    [FILES[0]]: Buffer.from(markdown(result.report)),
    [FILES[1]]: Buffer.from(JSON.stringify(result.report, null, 2) + "\n"),
    [FILES[2]]: Buffer.from(JSON.stringify(result.timeline, null, 2) + "\n"),
  };
  for (const b of Object.values(buffers))
    if (b.length > 8 * 1024 * 1024)
      throw Error("Sanitized report exceeded bound");
  for (const [n, b] of Object.entries(buffers)) atomicText(directory, n, b);
  if (withArchive)
    atomicText(directory, "quickshare-deep-sanitized.tar.gz", archive(buffers));
  return directory;
}
module.exports = {
  create,
  write,
  archive,
  android,
  extraTimeline,
  PHASES,
  FILES,
};
