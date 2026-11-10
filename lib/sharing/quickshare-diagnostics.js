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
  return { schema: 1, counters: counters(value?.counters) };
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
  result.diagnostics = {
    schema: 1,
    counters: { ...counters(previous?.diagnostics?.counters) },
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
