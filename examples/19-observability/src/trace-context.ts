// #region traceparent
export type TraceParent = { traceId: string; parentId: string; sampled: boolean };

// version "00": 32 hex of trace ID, 16 hex of parent ID, 2 hex of flags, lowercase.
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/** Reads a W3C `traceparent` header. Anything malformed is `undefined`: start a new trace instead. */
export function parseTraceparent(header: string | undefined): TraceParent | undefined {
  const match = TRACEPARENT.exec(header?.trim() ?? "");
  const [, traceId, parentId, flags] = match ?? [];
  if (traceId === undefined || parentId === undefined || flags === undefined) {
    return undefined;
  }
  // All zeros means "no ID" in the specification.
  if (/^0+$/.test(traceId) || /^0+$/.test(parentId)) {
    return undefined;
  }
  // Only the lowest bit has a meaning in version 00: the caller recorded this trace.
  return { traceId, parentId, sampled: (Number.parseInt(flags, 16) & 1) === 1 };
}

export function formatTraceparent(parent: TraceParent): string {
  return `00-${parent.traceId}-${parent.parentId}-${parent.sampled ? "01" : "00"}`;
}
// #endregion traceparent

// #region xray
/** X-Ray writes the same 32 hex characters as `1-<first 8>-<last 24>`. */
export function toXRayTraceId(traceId: string): string {
  if (!/^[0-9a-f]{32}$/.test(traceId)) {
    throw new Error(`Not a W3C trace ID: ${traceId}`);
  }
  return `1-${traceId.slice(0, 8)}-${traceId.slice(8)}`;
}

export function fromXRayTraceId(xrayTraceId: string): string {
  const match = /^1-([0-9a-f]{8})-([0-9a-f]{24})$/.exec(xrayTraceId);
  if (match === null) {
    throw new Error(`Not an X-Ray trace ID: ${xrayTraceId}`);
  }
  return `${match[1]}${match[2]}`;
}
// #endregion xray
