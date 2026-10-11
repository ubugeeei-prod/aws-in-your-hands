import {
  NodeTracerProvider,
  ParentBasedSampler,
  type Sampler,
  SimpleSpanProcessor,
  type SpanExporter,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-node";
import { z } from "zod";

const ratioSchema = z.coerce.number().min(0).max(1).default(1);

export function parseSampleRatio(value: string | undefined): number {
  const result = ratioSchema.safeParse(value);
  if (!result.success) {
    throw new Error("Invalid environment:\n  TRACE_SAMPLE_RATIO: expected a number from 0 to 1");
  }
  return result.data;
}

// #region local
// For a laptop and for tests. In Lambda the layer does this part.
export function startLocalTracing(options: { exporter: SpanExporter; sampler: Sampler }): NodeTracerProvider {
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
