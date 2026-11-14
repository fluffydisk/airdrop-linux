"use strict";
// Export schema is deliberately closed. Never forward arbitrary keys or strings.
const schema = require("./quickshare-diagnostic-schema.json");
const integer = (v, limit = schema.limit) =>
  Number.isSafeInteger(v) && v >= 0 ? Math.min(v, limit) : 0;
function counters(value, keys = schema.counters) {
  return Object.fromEntries(
    keys
      .filter((k) => Object.hasOwn(value || {}, k))
      .map((k) => [k, integer(value[k])]),
  );
}
function diagnostics(value) {
  return {
    schema: 1,
    counters: counters(value?.counters),
    ...(value?.advertising && typeof value.advertising === "object"
      ? { advertising: advertising(value.advertising) }
      : {}),
    ...(value?.advertisingCleanup &&
    typeof value.advertisingCleanup === "object"
      ? { advertisingCleanup: advertisingCleanup(value.advertisingCleanup) }
      : {}),
  };
}
function advertising(value) {
  const v = value || {},
    out = {};
  for (const [key, values] of Object.entries(schema.advertising)) {
    const field = {
      phases: "phase",
      results: "result",
      modes: "mode",
      errorNames: "errorName",
      categories: "category",
      triggers: "trigger",
      failureDetails: "failureDetail",
    }[key];
    out[field] = values.includes(v[field]) ? v[field] : "unknown";
  }
  for (const [key, limit] of [
    ["serviceDataBytes", 512],
    ["estimatedLegacyBytes", 519],
    ["timeoutSeconds", 120],
    ["retrySeconds", 30],
  ])
    out[key] = integer(v[key], limit);
  out.advertisementType = ["peripheral", "broadcast"].includes(
    v.advertisementType,
  )
    ? v.advertisementType
    : "unknown";
  out.secondaryChannel = ["none", "1M", "other"].includes(v.secondaryChannel)
    ? v.secondaryChannel
    : "unknown";
  out.discoverable = ["true", "false", "adapter-default"].includes(
    v.discoverable,
  )
    ? v.discoverable
    : "unknown";
  out.discovery = ["idle", "active", "unknown"].includes(v.discovery)
    ? v.discovery
    : "unknown";
  out.ownScanPaused = v.ownScanPaused === true;
  for (const key of ["availableInstances", "activeInstances"])
    out[key] =
      Number.isInteger(v[key]) && v[key] >= 0 && v[key] <= 255 ? v[key] : null;
  return out;
}
function advertisingCleanup(v) {
  const out = {};
  for (const [field, values] of [
    ["reason", schema.advertisingCleanup.reasons],
    ["result", schema.advertisingCleanup.results],
    ["unregisterResult", schema.advertisingCleanup.unregisterResults],
    ["errorName", schema.advertising.errorNames],
    ["category", schema.advertising.categories],
  ])
    out[field] = values.includes(v[field]) ? v[field] : "unknown";
  for (const field of ["ageMs", "leaseMs", "durationMs", "settleMs"])
    out[field] = integer(v[field]);
  for (const field of [
    "daemonReleaseBeforeCleanup",
    "daemonReleaseDuringCleanup",
    "ioStopped",
    "ownerScopeClosed",
  ])
    out[field] = v[field] === true;
  return out;
}
function pipeline(value) {
  return counters(value, schema.pipeline);
}
function increment(value, key) {
  if (schema.pipeline.includes(key))
    value[key] = integer((value[key] || 0) + 1);
}
function peak(previous, current) {
  const result = { ...previous, ...current };
  for (const key of ["observed", "decoded", "resolved", "ready"])
    result[key] = Math.max(integer(previous?.[key]), integer(current?.[key]));
  const lastAdvertisement =
    diagnostics(current?.diagnostics).advertising ||
    diagnostics(previous?.diagnostics).advertising;
  const lastCleanup =
    diagnostics(current?.diagnostics).advertisingCleanup ||
    diagnostics(previous?.diagnostics).advertisingCleanup;
  result.diagnostics = {
    schema: 1,
    counters: { ...counters(previous?.diagnostics?.counters) },
    ...(lastAdvertisement ? { advertising: lastAdvertisement } : {}),
    ...(lastCleanup ? { advertisingCleanup: lastCleanup } : {}),
  };
  for (const [k, v] of Object.entries(counters(current?.diagnostics?.counters)))
    result.diagnostics.counters[k] = Math.max(
      v,
      result.diagnostics.counters[k] || 0,
    );
  for (const key of ["bleScanning", "bleAdvertising", "gattBootstrap", "l2cap"])
    result[key] = previous?.[key] === true || current?.[key] === true;
  if (current?.mode === "off" && previous?.mode) result.mode = previous.mode;
  return result;
}
const EXITS = new Set([
  "running",
  "clean-stop",
  "forced-stop",
  "unexpected-exit",
  "start-failed",
]);
const lifecycle = (value) => ({
  outcome: EXITS.has(value?.outcome) ? value.outcome : "running",
  shutdownRequested: value?.shutdownRequested === true,
});
module.exports = {
  schema,
  integer,
  counters,
  diagnostics,
  pipeline,
  increment,
  peak,
  lifecycle,
};

const FINALIZATION_STAGES = new Set([
  "LocalPayloadComplete",
  "PeerEof",
  "PeerDisconnection",
  "PeerCloseTimeout",
  "FinalizationReadError",
  "PeerPayloadFailure",
  "PayloadReceiptAckObserved",
  "PayloadReceiptAckModernObserved",
  "PayloadReceiptAckLegacyObserved",
]);
const CONNECTION_METHODS = new Set(["lan-tcp", "ble-gatt", "ble-l2cap"]);
module.exports.FINALIZATION_STAGES = FINALIZATION_STAGES;
module.exports.CONNECTION_METHODS = CONNECTION_METHODS;
