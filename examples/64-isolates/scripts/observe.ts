// vp run isolates:observe
//   node scripts/observe.ts
//
// Runs the real workerd on this machine and prints what it does in situations the tests
// leave out, because the answers are durations. No AWS, no Docker. Takes about 20 seconds.

import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bundleWorker } from "../src/bundle.ts";
import { renderConfig } from "../src/capnp.ts";
import { parseDeployment } from "../src/definition.ts";
import { BUNDLES } from "../src/deployments.ts";
import { WORKERD } from "../src/release.ts";
import { type Running, startWorkerd } from "../src/runtime.ts";

const directory = mkdtempSync(join(tmpdir(), "aih-observe-"));
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const since = (start: number): number => Math.round(performance.now() - start);

const deployment = parseDeployment({
  workers: [
    {
      name: "notes",
      module: BUNDLES.notes.module,
      compatibilityDate: WORKERD.compatibilityDate,
      bindings: [{ from: "text", name: "ALLOWED_ORIGIN", value: "http://localhost:5173" }],
    },
    { name: "spin", module: BUNDLES.spin.module, compatibilityDate: WORKERD.compatibilityDate },
  ],
  sockets: [
    { name: "notes", address: "127.0.0.1:1", service: "notes" },
    { name: "spin", address: "127.0.0.1:2", service: "spin" },
  ],
});

/** One fresh workerd per observation, so that none inherits the last one's connections. */
async function observe(title: string, look: (server: Running) => Promise<void>): Promise<void> {
  console.log(`\n${title}`);
  const server = await startWorkerd(join(directory, "config.capnp"), deployment);
  try {
    await look(server);
  } finally {
    server.process.kill("SIGKILL");
  }
}

/** SIGTERM, then how the process ended within `limit` ms. */
async function terminate(server: Running, limit: number): Promise<string> {
  const exited = once(server.process, "exit") as Promise<[number | null]>;
  const start = performance.now();
  server.process.kill("SIGTERM");
  return Promise.race([
    exited.then(([code]) => `exited with ${code}, ${since(start)} ms after SIGTERM`),
    sleep(limit).then(() => `still running ${limit} ms after SIGTERM`),
  ]);
}

/** A request on `agent`'s one connection. Resolves with what happened, never rejects. */
const call = (url: string, agent: http.Agent, timeout: number): Promise<string> =>
  new Promise((resolve) => {
    const start = performance.now();
    const request = http.get(url, { agent, timeout }, (response) => {
      response.resume();
      response.on("end", () => resolve(`answered ${response.statusCode} after ${since(start)} ms`));
    });
    request.on("timeout", () => request.destroy(new Error(`no answer within ${timeout} ms`)));
    request.on("error", (error) => resolve(error.message));
  });

try {
  await bundleWorker(BUNDLES.notes.entry, join(directory, BUNDLES.notes.module));
  await bundleWorker(BUNDLES.spin.entry, join(directory, BUNDLES.spin.module));
  writeFileSync(join(directory, "config.capnp"), renderConfig(deployment));

  // #region cpu
  await observe("1. One worker holds the CPU for 2000 ms", async (server) => {
    const start = performance.now();
    const spinning = fetch(`${server.url["spin"]}/?ms=2000`).then(async (response) => {
      const { turns } = (await response.json()) as { turns: number };
      // spin.ts gives up after 2e9 turns. Fewer means its clock moved while it ran.
      return `answered ${response.status} after ${since(start)} ms and ${turns} turns of its loop`;
    });
    await sleep(200);
    const neighbour = await call(`${server.url["notes"]}/health`, new http.Agent(), 10_000);
    console.log(`   the spinning worker: ${await spinning}`);
    console.log(`   its neighbour, asked 200 ms in: ${neighbour}`);
  });
  // #endregion cpu

  // #region sigterm
  await observe("2. SIGTERM with a request in flight", async (server) => {
    const held = http.request(`${server.url["notes"]}/notes`, { method: "POST" });
    const answer = new Promise<string>((resolve) => {
      held.on("response", (response) => resolve(`answered ${response.statusCode}`));
      held.on("error", (error) => resolve(`failed: ${error.message}`));
    });
    held.write('{"title":"in flight",');
    await sleep(200);
    const ended = terminate(server, 10_000);
    await sleep(200);
    const late = await call(`${server.url["notes"]}/health`, new http.Agent(), 1500);
    held.end('"body":""}');
    console.log(`   a new request, sent 200 ms after SIGTERM: ${late}`);
    console.log(`   the request in flight, finished 1700 ms after SIGTERM: ${await answer}`);
    console.log(`   workerd: ${await ended}`);
  });

  await observe("3. SIGTERM, then a request on a new connection", async (server) => {
    const ended = terminate(server, 10_000);
    await sleep(200);
    const late = await call(`${server.url["notes"]}/health`, new http.Agent(), 3000);
    console.log(`   the request, sent 200 ms after SIGTERM: ${late}`);
    console.log(`   workerd: ${await ended}`);
  });

  await observe("4. SIGTERM with an idle keep-alive connection open", async (server) => {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    console.log(`   before SIGTERM: ${await call(`${server.url["notes"]}/health`, agent, 3000)}`);
    const ended = terminate(server, 5000);
    await sleep(200);
    const reused = await call(`${server.url["notes"]}/health`, agent, 3000);
    console.log(`   the same connection, 200 ms after SIGTERM: ${reused}`);
    console.log(`   workerd: ${await ended}`);
    agent.destroy();
  });
  // #endregion sigterm
} finally {
  rmSync(directory, { recursive: true, force: true });
}
