import { composeServer } from "./compose.ts";
import { MAX_CONNECTIONS } from "./config.ts";
import { startServer } from "./serve.ts";
import { timing } from "./timing.ts";

// #region main
const { fetch, env, log } = composeServer(process.env);

const server = await startServer({
  fetch,
  port: env.PORT,
  keepAliveTimeoutMs: timing.serverKeepAlive * 1000,
  maxConnections: MAX_CONNECTIONS,
  shutdownDeadlineMs: timing.shutdownDeadline * 1000,
});
log({ level: "info", message: "listening", port: server.port, version: env.APP_VERSION });

// ECS sends SIGTERM, waits stopTimeout, then sends SIGKILL. Ctrl-C sends SIGINT.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    log({ level: "info", message: "draining", signal });
    void server.shutdown().then((result) => {
      log({ level: result === "drained" ? "info" : "error", message: "stopped", result });
      // Nothing is left to keep the process alive. The exit code says whether anything was cut.
      process.exitCode = result === "drained" ? 0 : 1;
    });
  });
}
// #endregion main
