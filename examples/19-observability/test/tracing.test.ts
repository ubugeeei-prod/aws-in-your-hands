import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  ParentBasedSampler,
  type ReadableSpan,
  SamplingDecision,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-node";
import { beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { startLocalTracing } from "../src/local-tracing.ts";
import { contextFromHeaders, outgoingTraceHeaders, withSpan } from "../src/telemetry.ts";
import { formatTraceparent, parseTraceparent } from "../src/trace-context.ts";
import { brokenList, harness } from "./harness.ts";

// A sampler with a switch, so "this trace was not sampled" is a decision the
// test makes, not a matter of luck.
const root = {
  on: true,
  shouldSample() {
    return {
      decision: this.on ? SamplingDecision.RECORD_AND_SAMPLED : SamplingDecision.NOT_RECORD,
    };
  },
  toString: () => "switch",
};
const memory = new InMemorySpanExporter();
// An exporter that can be taken down: spans end as usual and go nowhere.
const exporter: SpanExporter & { down: boolean } = {
  down: false,
  export(batch, done) {
    if (this.down) {
      done({ code: 1 }); // ExportResultCode.FAILED
      return;
    }
    memory.export(batch, done);
  },
  shutdown: () => memory.shutdown(),
};

beforeAll(() => {
  startLocalTracing({ exporter, sampler: new ParentBasedSampler({ root }) });
});
beforeEach(() => {
  memory.reset();
  exporter.down = false;
  root.on = true;
});

const spans = () => memory.getFinishedSpans();
const named = (name: string): ReadableSpan => {
  const span = spans().find((candidate) => candidate.name === name);
  if (span === undefined) {
    throw new Error(`no span named ${name}; got ${spans().map((candidate) => candidate.name)}`);
  }
  return span;
};

describe("one request, one trace", () => {
  it("puts the request span and the table span in the same trace", async () => {
    const h = harness();
    await h.send("POST", "/notes", { title: "first" });

    const request = named("POST");
    const table = named("notes.create");
    expect(table.spanContext().traceId).toBe(request.spanContext().traceId);
    expect(table.parentSpanContext?.spanId).toBe(request.spanContext().spanId);
    expect(request.kind).toBe(SpanKind.SERVER);
  });

  it("links the log line and the span in both directions", async () => {
    const h = harness();
    const response = await h.send("GET", "/health");

    const span = named("GET");
    const [line] = h.lines();
    // log -> trace
    expect(line).toMatchObject({
      traceId: span.spanContext().traceId,
      spanId: span.spanContext().spanId,
      sampled: true,
    });
    // trace -> log
    expect(span.attributes["app.request_id"]).toBe(response.headers.get("x-request-id"));
    expect(span.attributes["app.request_id"]).toBe(line?.requestId);
  });

  it("adds 88 bytes of trace fields to the request line", async () => {
    const h = harness();
    await h.send("GET", "/notes/n-0000000000000-0001");
    // 167 bytes without a tracer (test/log-shape.test.ts). The difference is what tracing costs in log volume.
    expect(Buffer.byteLength(h.raw[0] ?? "", "utf8")).toBe(167 + 88);
  });

  it("marks a 500 as an error on the span", async () => {
    const h = harness({ repository: brokenList("table unavailable") });
    await h.send("GET", "/notes");

    expect(named("GET").status.code).toBe(SpanStatusCode.ERROR);
    expect(named("GET").attributes["http.response.status_code"]).toBe(500);
    expect(named("notes.list").status.code).toBe(SpanStatusCode.ERROR);
  });
});

describe("what a span is allowed to carry", () => {
  it("records only listed attributes", async () => {
    const h = harness({ repository: brokenList("no such user alice@example.com") });
    await h.send(
      "POST",
      "/notes?access_token=query-secret",
      { title: "private title", body: "private body" },
      { authorization: "Bearer header-secret" },
    );
    await h.send("GET", "/notes");

    const allowed = new Set([
      "http.request.method",
      "url.path",
      "http.response.status_code",
      "app.request_id",
      "app.repository.operation",
      "app.repository.outcome",
      "error.type",
    ]);
    for (const span of spans()) {
      for (const key of Object.keys(span.attributes)) {
        expect(allowed, `${span.name}: ${key}`).toContain(key);
      }
      // No events either: recordException would copy the message and the stack.
      expect(span.events).toEqual([]);
    }
    const exported = JSON.stringify(
      spans().map((span) => [span.name, span.attributes, span.status, span.events, span.links]),
    );
    for (const secret of [
      "private title",
      "private body",
      "query-secret",
      "header-secret",
      "alice@example.com",
    ]) {
      expect(exported).not.toContain(secret);
    }
    expect(named("notes.list").attributes["error.type"]).toBe("Error");
  });
});

describe("crossing a process boundary", () => {
  const caller = {
    traceId: "4efaaf4d1e8720b39541901950019ee5",
    parentId: "00f067aa0ba902b7",
    sampled: true,
  };

  it("continues the caller's trace from a traceparent header", async () => {
    const h = harness();
    await h.send("GET", "/health", undefined, { traceparent: formatTraceparent(caller) });

    const span = named("GET");
    expect(span.spanContext().traceId).toBe(caller.traceId);
    expect(span.parentSpanContext?.spanId).toBe(caller.parentId);
    expect(h.lines()[0]?.traceId).toBe(caller.traceId);
  });

  it("starts a new trace when the header is malformed", async () => {
    const h = harness();
    await h.send("GET", "/health", undefined, { traceparent: "00-not-a-trace-id-01" });

    expect(named("GET").parentSpanContext).toBeUndefined();
    expect(h.lines()[0]?.traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it("carries the trace through a queue message to a worker, delivered twice", async () => {
    // Stand-in for chapter 08: the API puts the headers in the message, and
    // the worker continues from them. No SQS here.
    const queue: Record<string, string>[] = [];
    await withSpan("enqueue", {}, async () => {
      queue.push(outgoingTraceHeaders());
    });
    const [message] = queue;
    if (message === undefined) {
      throw new Error("nothing was enqueued");
    }
    const deliver = () =>
      withSpan("worker", { parent: contextFromHeaders(message) }, async () => {});
    await deliver();
    await deliver();

    const enqueue = named("enqueue");
    const workers = spans().filter((span) => span.name === "worker");
    expect(parseTraceparent(message["traceparent"])?.traceId).toBe(enqueue.spanContext().traceId);
    // Both deliveries are visible, as two spans under the same parent.
    expect(workers).toHaveLength(2);
    for (const worker of workers) {
      expect(worker.spanContext().traceId).toBe(enqueue.spanContext().traceId);
      expect(worker.parentSpanContext?.spanId).toBe(enqueue.spanContext().spanId);
    }
  });
});

describe("sampling", () => {
  it("exports nothing for an unsampled request, and still logs it with its trace ID", async () => {
    root.on = false;
    const h = harness();
    const response = await h.send("POST", "/notes", { title: "first" });

    expect(response.status).toBe(201);
    // No span is not "the request failed" or "the table was not called".
    expect(spans()).toEqual([]);
    expect(h.lines()[0]).toMatchObject({ status: 201, sampled: false });
    expect(h.lines()[0]?.traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it("follows the caller's decision instead of deciding again", async () => {
    const h = harness();
    const unsampled = formatTraceparent({
      traceId: "4efaaf4d1e8720b39541901950019ee5",
      parentId: "00f067aa0ba902b7",
      sampled: false,
    });
    // The local sampler would say yes. The caller said no, so no span is exported.
    await h.send("GET", "/health", undefined, { traceparent: unsampled });

    expect(spans()).toEqual([]);
    expect(h.lines()[0]).toMatchObject({
      traceId: "4efaaf4d1e8720b39541901950019ee5",
      sampled: false,
    });
  });

  it("can lose one worker span while the rest of the trace is exported", async () => {
    // The worker's exporter is down for one delivery: the work happens, the span does not arrive.
    let done = 0;
    const carrier: Record<string, string> = {};
    await withSpan("enqueue", {}, async () => {
      Object.assign(carrier, outgoingTraceHeaders());
    });
    exporter.down = true;
    await withSpan("worker", { parent: contextFromHeaders(carrier) }, async () => {
      done += 1;
    });

    expect(done).toBe(1);
    expect(spans().map((span) => span.name)).toEqual(["enqueue"]);
  });
});
