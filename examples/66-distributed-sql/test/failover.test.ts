import { describe, expect, it } from "vite-plus/test";

import { createFailover, type Endpoint, NoNodeReachableError } from "../src/failover.ts";

const endpoints: Endpoint[] = [5431, 5432, 5433].map((port) => ({ host: "10.0.0.1", port }));

function connector(down: Set<number>) {
  const attempts: number[] = [];
  const connect = (endpoint: Endpoint): Promise<string> => {
    attempts.push(endpoint.port);
    return down.has(endpoint.port)
      ? Promise.reject(new Error("ECONNREFUSED"))
      : Promise.resolve(`session on ${endpoint.port}`);
  };
  return { attempts, connect };
}

describe("opening a session on a cluster", () => {
  it("skips a node that refuses and uses the next", async () => {
    const { attempts, connect } = connector(new Set([5431]));
    const skipped: number[] = [];
    const failover = createFailover(endpoints, connect, ({ endpoint }) =>
      skipped.push(endpoint.port),
    );
    expect((await failover.open()).session).toBe("session on 5432");
    expect(attempts).toEqual([5431, 5432]);
    expect(skipped).toEqual([5431]);
  });

  it("starts the next time with the node that worked, not with the dead one", async () => {
    const { attempts, connect } = connector(new Set([5431]));
    const failover = createFailover(endpoints, connect);
    await failover.open();
    await failover.open();
    expect(attempts).toEqual([5431, 5432, 5432]);
  });

  it("names every node it tried when none answers", async () => {
    const { connect } = connector(new Set([5431, 5432, 5433]));
    const failover = createFailover(endpoints, connect);
    const error = await failover.open().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NoNodeReachableError);
    expect(String(error)).toContain("10.0.0.1:5431");
    expect(String(error)).toContain("10.0.0.1:5433");
  });

  it("comes back to a node once it accepts connections again", async () => {
    const down = new Set([5431, 5432]);
    const { attempts, connect } = connector(down);
    const failover = createFailover(endpoints, connect);
    expect((await failover.open()).endpoint.port).toBe(5433);
    down.clear();
    down.add(5433);
    expect((await failover.open()).endpoint.port).toBe(5431);
    expect(attempts).toEqual([5431, 5432, 5433, 5433, 5431]);
  });
});
