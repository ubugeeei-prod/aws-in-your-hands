---
title: "19 Observability: Run It Locally"
---

# 19 Observability: Run It Locally

## Seeing it on your machine

<!-- section: 19.local -->

Copy `examples/19-observability/.env.example` to `.env` and start the server.

<<< @/examples/19-observability/.env.example

```bash
vp run dev:obs
```

<<< @/examples/19-observability/src/dev.ts{dev}

Locally, an exporter prints the spans to the console. Call the API from another terminal.

```bash
curl -s -X POST http://localhost:8787/notes -H 'content-type: application/json' -d '{"title":"first note"}'
curl -s http://localhost:8787/health -H 'traceparent: 00-4efaaf4d1e8720b39541901950019ee5-00f067aa0ba902b7-01'
curl -s http://localhost:8787/health -H 'traceparent: 00-4efaaf4d1e8720b39541901950019ee5-00f067aa0ba902b7-00'
```

The first prints two spans, `notes.create` and `POST`, and a log line with a `traceId`. A span is printed when it ends, so the inner `notes.create` comes first.

The second names a trace ID with `traceparent`. The log's `traceId` becomes `4efaaf4d…`, and the span's parent becomes `00f067aa0ba902b7`.

The third ends in `00`, which means "the caller is not recording". No span is printed. Only the log line remains, with `"sampled":false`.

Set `TRACE_SAMPLE_RATIO` to `0` in `.env` and restart, and every request behaves that way.

The tests:

```bash
vp run test:unit
```

And what is not reproduced locally:

- **CloudWatch and X-Ray themselves.** Alarm state changes, running Logs Insights, the metric filter, the X-Ray console
- **Lambda's sampling.** The local sampler has a ratio only; there is no "first request each second"
- **The layer.** The local SDK is set up differently from the Lambda layer
- **The system log lines Lambda writes**, such as `platform.report` in the JSON format
