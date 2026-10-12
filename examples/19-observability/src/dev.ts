import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-node";

import { nodeServer } from "@aih/example-04-http-api/src/http/node-server.ts";

import { composeObservedApp } from "./compose.ts";
import { parseSampleRatio, ratioSampler, startLocalTracing } from "./local-tracing.ts";

// #region dev
const ratio = parseSampleRatio(process.env["TRACE_SAMPLE_RATIO"]);
// Before the app is composed, so its first span already has a tracer behind it.
startLocalTracing({ exporter: new ConsoleSpanExporter(), sampler: ratioSampler(ratio) });

const app = composeObservedApp(process.env);
const port = Number(process.env["PORT"] ?? 8787);

nodeServer(app).listen(port, () => {
  console.log(
    `observed notes API on http://localhost:${port} (spans to the console, sample ratio ${ratio})`,
  );
});
// #endregion dev
