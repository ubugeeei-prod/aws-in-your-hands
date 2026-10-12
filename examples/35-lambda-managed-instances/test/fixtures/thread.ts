// One worker thread, standing in for one runtime worker: it loads the handler's module graph itself.

import { parentPort } from "node:worker_threads";

import { composeManagedApp } from "../../src/app.ts";

const app = composeManagedApp({ ALLOWED_ORIGIN: "http://localhost:5173", LOG_LEVEL: "error" });

parentPort?.on("message", (message: { method: string; path: string; body?: string }) => {
  void (async () => {
    const response = await app(
      new Request(`http://api.test${message.path}`, {
        method: message.method,
        ...(message.body === undefined ? {} : { body: message.body }),
      }),
    );
    parentPort?.postMessage({ status: response.status, body: await response.json() });
  })();
});
