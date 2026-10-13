// vp run webfn:demo
//   node scripts/demo.ts
//
// Starts the entry file the way Lambda does: as its own process, with the address in
// AWS_LAMBDA_HTTP_ENDPOINT. Then fifty requests at once, and a SIGTERM. No AWS.

import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

import { REQUEST_ID_HEADER } from "../src/app.ts";

/** A port nobody is listening on right now. */
async function freePort(): Promise<number> {
  const probe = createServer().listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  probe.close();
  await once(probe, "close");
  if (address === null || typeof address === "string") {
    throw new Error("no port");
  }
  return address.port;
}

const endpoint = `127.0.0.1:${await freePort()}`;
const startedAt = performance.now();
const server = spawn(
  process.execPath,
  [fileURLToPath(new URL("../src/index.ts", import.meta.url))],
  {
    env: {
      ...process.env,
      AWS_LAMBDA_HTTP_ENDPOINT: endpoint,
      ALLOWED_ORIGIN: "http://localhost:5173",
      RELEASE: "demo",
    },
    stdio: ["ignore", "ignore", "inherit"],
  },
);
const exited = once(server, "exit") as Promise<[number | null, NodeJS.Signals | null]>;

try {
  // Lambda waits for the socket to accept a connection, and gives up after 10 seconds.
  let listening = false;
  while (!listening && performance.now() - startedAt < 10_000) {
    listening = await fetch(`http://${endpoint}/health`).then(
      (response) => response.ok,
      () => false,
    );
  }
  if (!listening) {
    throw new Error("the server did not start listening within 10 seconds");
  }
  console.log(`listening on ${endpoint} after ${Math.round(performance.now() - startedAt)} ms`);

  const ids = Array.from({ length: 50 }, (_, index) => `demo-${index + 1}`);
  const answers = await Promise.all(
    ids.map(async (id) => {
      const response = await fetch(`http://${endpoint}/notes`, {
        method: "POST",
        headers: { [REQUEST_ID_HEADER]: id },
        body: JSON.stringify({ title: id, body: "" }),
      });
      return { id, status: response.status, echoed: response.headers.get("x-request-id") };
    }),
  );
  const mixed = answers.filter((answer) => answer.status !== 201 || answer.echoed !== answer.id);
  console.log(
    `50 requests at once in one process: ${answers.length - mixed.length} answered under their own request ID`,
  );
  if (mixed.length > 0) {
    throw new Error(`mixed up: ${JSON.stringify(mixed.slice(0, 3))}`);
  }

  const signalledAt = performance.now();
  server.kill("SIGTERM");
  const [code] = await exited;
  console.log(
    `SIGTERM: exited with code ${code} after ${Math.round(performance.now() - signalledAt)} ms (Lambda allows 1000 ms)`,
  );
} finally {
  server.kill("SIGKILL");
}
