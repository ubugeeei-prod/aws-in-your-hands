import {
  type Attributes,
  type Context,
  context,
  propagation,
  ROOT_CONTEXT,
  type Span,
  SpanKind,
  SpanStatusCode,
  TraceFlags,
  trace,
} from "@opentelemetry/api";

import type { Logger } from "@aih/example-05-dynamodb/src/log.ts";

// Only the API is imported here. Whoever starts the process decides whether
// an SDK is behind it: src/local-tracing.ts on a laptop, a Lambda layer in AWS.
// With nothing registered every call below is a no-op.
const tracer = () => trace.getTracer("aih-observability");

// #region span
export type SpanOptions = { attributes?: Attributes; kind?: SpanKind; parent?: Context };

export function withSpan<T>(
  name: string,
  options: SpanOptions,
  run: (span: Span) => Promise<T>,
): Promise<T> {
  const { attributes = {}, kind = SpanKind.INTERNAL, parent = context.active() } = options;
  return tracer().startActiveSpan(name, { attributes, kind }, parent, async (span) => {
    try {
      return await run(span);
    } catch (error) {
      // The type only. Messages can quote user input, and spans are kept for 30 days.
      const type = error instanceof Error ? error.name : "unknown";
      span.setAttribute("error.type", type);
      span.setStatus({ code: SpanStatusCode.ERROR, message: type });
      throw error;
    } finally {
      span.end();
    }
  });
}
// #endregion span

// #region fields
export type TraceFields = { traceId?: string; spanId?: string; sampled?: boolean };

/** The IDs of the span this code is running in, for a log line. */
export function traceFields(): TraceFields {
  const active = trace.getActiveSpan()?.spanContext();
  if (active === undefined || !trace.isSpanContextValid(active)) {
    return {};
  }
  return {
    traceId: active.traceId,
    spanId: active.spanId,
    // false: the IDs exist, but no span of this trace is exported.
    sampled: (active.traceFlags & TraceFlags.SAMPLED) === TraceFlags.SAMPLED,
  };
}

export function withTraceFields(log: Logger): Logger {
  return (entry) => log({ ...entry, ...traceFields() });
}
// #endregion fields

// #region propagation
export function hasActiveSpan(): boolean {
  return traceFields().traceId !== undefined;
}

/** Headers that carry the current trace to the next process, such as `traceparent`. */
export function outgoingTraceHeaders(): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier;
}

/** The context a receiver continues from. Without usable headers it is a new trace. */
export function contextFromHeaders(carrier: Record<string, string | undefined>): Context {
  return propagation.extract(ROOT_CONTEXT, carrier);
}
// #endregion propagation
