---
title: "19 Observability: Run It Locally"
---

# 19 Observability: Run It Locally

## Running it locally

<!-- section: 19.local -->

This page runs the logs and traces from the [pages so far](/en/chapters/19-observability/more.md) on your machine, without AWS. Copy `examples/19-observability/.env.example` to `.env` and start the server.

<<< @/examples/19-observability/.env.example

```bash
vp run dev:obs
```

<<< @/examples/19-observability/src/dev.ts{dev}

Locally, the code uses an exporter that prints spans to the console. From another terminal, run these three calls in order.

```bash
curl -s -X POST http://localhost:8787/notes -H 'content-type: application/json' -d '{"title":"first note"}'
curl -s http://localhost:8787/health -H 'traceparent: 00-4efaaf4d1e8720b39541901950019ee5-00f067aa0ba902b7-01'
curl -s http://localhost:8787/health -H 'traceparent: 00-4efaaf4d1e8720b39541901950019ee5-00f067aa0ba902b7-00'
```

The first call prints two spans, `notes.create` and `POST`, and a log line with a `traceId`. A span is printed when it ends, so the inner `notes.create` appears first.

The second call sets the trace ID with `traceparent`. The `traceId` in the log becomes `4efaaf4d…`, and the parent of the span becomes `00f067aa0ba902b7`.

In the third call, the last two characters of `traceparent` are `00`. `00` means the caller is not recording this trace, so no span is printed. Only the log line remains, with `"sampled":false`.

If you set `TRACE_SAMPLE_RATIO` to `0` in `.env` and restart, every request gives the same result as the third call.

Run the tests with this command.

```bash
vp run test:unit
```

The following are not reproduced locally.

- CloudWatch and X-Ray themselves. Alarm state changes, running Logs Insights, the metric filter and the X-Ray console are not reproduced
- Lambda's sampling. The local sampler decides by a ratio only and has no "first request each second"
- The layer. The local SDK is set up differently from the Lambda layer
- The system logs Lambda writes, such as the `platform.report` lines in the JSON format
