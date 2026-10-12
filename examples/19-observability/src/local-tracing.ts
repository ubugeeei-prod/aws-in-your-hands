import {
  NodeTracerProvider,
  ParentBasedSampler,
  type Sampler,
  SimpleSpanProcessor,
  type SpanExporter,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-node";
import * as v from "valibot";

// An environment variable is text. "0.1" becomes 0.1; "half" becomes NaN, which v.number() refuses.
const ratioSchema = v.optional(
  v.pipe(v.string(), v.transform(Number), v.number(), v.minValue(0), v.maxValue(1)),
  "1",
);

export function parseSampleRatio(value: string | undefined): number {
  const result = v.safeParse(ratioSchema, value);
  if (!result.success) {
    throw new Error("Invalid environment:\n  TRACE_SAMPLE_RATIO: expected a number from 0 to 1");
  }
  return result.output;
}

// #region local
// For a laptop and for tests. In Lambda the layer does this part.
export function startLocalTracing(options: {
  exporter: SpanExporter;
  sampler: Sampler;
}): NodeTracerProvider {
  const provider = new NodeTracerProvider({
    sampler: options.sampler,
    // Simple, not batching: a span is handed to the exporter the moment it ends.
    spanProcessors: [new SimpleSpanProcessor(options.exporter)],
  });
  // Also installs the context manager that keeps "the current span" across
  // awaits, and the W3C propagator that reads and writes `traceparent`.
  provider.register();
  return provider;
}

/** The decision is made once, where a trace starts. Everything below follows its parent. */
export function ratioSampler(ratio: number): Sampler {
  return new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(ratio) });
}
// #endregion local
