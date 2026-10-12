import type { AddressInfo } from "node:net";

import { describe, expect, it } from "vite-plus/test";

import { nodeServer } from "@aih/example-04-http-api/src/http/node-server.ts";

import { asyncScope, moduleScope, type RequestScope } from "../src/scope.ts";
import { createNote, harness, storedBy } from "./harness.ts";

/** One process, one listening socket, two connections open at the same time. */
async function overSockets(scope: RequestScope) {
  const test = harness(scope, ["req-A", "req-B"]);
  const server = nodeServer(test.app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const a = fetch(`${origin}/notes`, createNote("from A"));
    await test.writing;
    const b = await fetch(`${origin}/health`);
    test.release();
    const answerA = await a;
    return {
      a: answerA.headers.get("x-request-id"),
      b: b.headers.get("x-request-id"),
      storedBy: storedBy(test.lines, ((await answerA.json()) as { id: string }).id),
    };
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("two requests at once against one Node.js process", () => {
  it("mixes them up when the request ID lives in module scope", async () => {
    expect(await overSockets(moduleScope)).toEqual({ a: "req-A", b: "req-B", storedBy: "req-B" });
  });

  it("keeps them apart when it lives in AsyncLocalStorage", async () => {
    expect(await overSockets(asyncScope)).toEqual({ a: "req-A", b: "req-B", storedBy: "req-A" });
  });
});
