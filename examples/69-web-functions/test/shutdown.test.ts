import { describe, expect, it } from "vite-plus/test";

import { asyncScope } from "@aih/example-35-lambda-managed-instances/src/scope.ts";

import { serve, SHUTDOWN_BUDGET_MS } from "../src/serve.ts";
import { as, createNote, deferred, harness } from "./harness.ts";

const ANY_PORT = { host: "127.0.0.1", port: 0 };

/** A clock the test moves by hand: the wait ends when `expire` is called. */
function budget() {
  const expired = deferred();
  const asked: number[] = [];
  return {
    asked,
    expire: expired.resolve,
    wait: (ms: number) => {
      asked.push(ms);
      return expired.promise;
    },
  };
}

describe("SIGTERM: one second to stop", () => {
  it("leaves room inside the second Lambda allows", () => {
    expect(SHUTDOWN_BUDGET_MS).toBeLessThan(1000);
  });

  // #region drained
  it("lets a request that is still open finish, and takes no new connection", async () => {
    const test = harness(asyncScope);
    const clock = budget();
    const running = await serve(test.app, ANY_PORT, clock.wait);
    const origin = `http://127.0.0.1:${running.address.port}`;

    const open = fetch(`${origin}/notes`, as("req-open", createNote("still being written")));
    await test.writing;
    const stopped = running.stop(SHUTDOWN_BUDGET_MS);

    await expect(fetch(`${origin}/health`)).rejects.toThrow();
    test.release();
    expect((await open).status).toBe(201);
    expect(await stopped).toBe("drained");
    expect(clock.asked).toEqual([SHUTDOWN_BUDGET_MS]);
  });
  // #endregion drained

  // #region cut
  it("cuts a request that outlasts the budget: the caller sees a broken connection, not an answer", async () => {
    const test = harness(asyncScope);
    const clock = budget();
    const running = await serve(test.app, ANY_PORT, clock.wait);

    const open = fetch(
      `http://127.0.0.1:${running.address.port}/notes`,
      as("req-open", createNote("never finished")),
    );
    await test.writing;
    const stopped = running.stop(SHUTDOWN_BUDGET_MS);
    clock.expire();

    expect(await stopped).toBe("cut");
    await expect(open).rejects.toThrow();
    test.release();
  });
  // #endregion cut

  it("stops at once when nothing is open", async () => {
    const clock = budget();
    const running = await serve(harness(asyncScope).app, ANY_PORT, clock.wait);
    const response = await fetch(`http://127.0.0.1:${running.address.port}/health`);
    await response.arrayBuffer();
    expect(await running.stop(SHUTDOWN_BUDGET_MS)).toBe("drained");
  });
});
