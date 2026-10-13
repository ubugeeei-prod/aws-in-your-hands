import { composeWebApp } from "./app.ts";
import { listenAddress } from "./listen.ts";
import { serve, SHUTDOWN_BUDGET_MS } from "./serve.ts";

// #region entry
// Runs once per execution environment. After that, this one process answers many requests at once.
const app = composeWebApp(process.env);
const running = await serve(app, listenAddress(process.env));
console.info({ message: "listening", host: running.address.address, port: running.address.port });

// Lambda has already stopped sending requests when this arrives. It does not arrive at all
// when the host fails, so nothing that must be kept is saved here.
process.once("SIGTERM", () => {
  void running.stop(SHUTDOWN_BUDGET_MS).then((how) => {
    console.info({ message: "stopped", how });
    process.exit(0);
  });
});
// #endregion entry
