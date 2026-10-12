import { describe, expect, it } from "vite-plus/test";

import { type Opened, rotating, withDeadline } from "../src/valkey-client.ts";
import {
  INCREMENT_BELOW,
  UNLOCK_IF_OWNER,
  ValkeyCacheStore,
  type ValkeyCommands,
  ValkeyCounterStore,
} from "../src/valkey-store.ts";

// Pins the commands. Whether Valkey does what they ask is checked against a
// real server by `vp run kv:test:local`.
function fakeValkey(replies: { get?: string | null; set?: unknown; eval?: unknown } = {}) {
  const sent: unknown[][] = [];
  const commands: ValkeyCommands = {
    get: async (key) => {
      sent.push(["GET", key]);
      return replies.get ?? null;
    },
    set: async (...args: unknown[]) => {
      sent.push(["SET", ...args]);
      return "set" in replies ? replies.set : "OK";
    },
    del: async (key) => {
      sent.push(["DEL", key]);
      return 1;
    },
    eval: async (...args) => {
      sent.push(["EVAL", ...args]);
      return replies.eval;
    },
  };
  return { provider: async () => commands, sent };
}

const window = {
  subject: "client-1",
  windowStart: 1_760_000_040_000,
  expiresAt: 1_760_000_160_500,
};

describe("ValkeyCounterStore commands", () => {
  it("runs check, increment, and expiry as one script on one key", async () => {
    const { provider, sent } = fakeValkey({ eval: 3 });
    expect(await new ValkeyCounterStore(provider).incrementBelow(window, 5)).toEqual({
      accepted: true,
      count: 3,
    });
    expect(sent).toEqual([
      ["EVAL", INCREMENT_BELOW, 1, "rate:client-1:1760000040000", 5, 1_760_000_160_500],
    ]);
  });

  it("reads the script's -1 as a refusal", async () => {
    const { provider } = fakeValkey({ eval: -1 });
    expect(await new ValkeyCounterStore(provider).incrementBelow(window, 5)).toEqual({
      accepted: false,
    });
  });

  it("reads a missing key as zero", async () => {
    expect(await new ValkeyCounterStore(fakeValkey().provider).read(window)).toBe(0);
    expect(await new ValkeyCounterStore(fakeValkey({ get: "4" }).provider).read(window)).toBe(4);
  });
});

describe("ValkeyCacheStore commands", () => {
  it("sets the value with an absolute expiry in milliseconds", async () => {
    const { provider, sent } = fakeValkey();
    await new ValkeyCacheStore(provider).set("list", { value: "v1", expiresAt: 1_760_000_130_250 });
    expect(sent).toEqual([["SET", "cache:list", "v1", "PXAT", 1_760_000_130_250]]);
  });

  it("leaves expiry to the server: whatever GET returns is current", async () => {
    const { provider, sent } = fakeValkey({ get: "v1" });
    // A caller clock far in the future changes nothing.
    expect(await new ValkeyCacheStore(provider).get("list", Number.MAX_SAFE_INTEGER)).toBe("v1");
    expect(sent).toEqual([["GET", "cache:list"]]);
  });

  it("takes the lock with NX and reports a nil reply as taken by someone else", async () => {
    const free = fakeValkey({ set: "OK" });
    expect(
      await new ValkeyCacheStore(free.provider).tryLock("list", "a", 1_760_000_105_000, 0),
    ).toBe(true);
    expect(free.sent).toEqual([["SET", "lock:list", "a", "PXAT", 1_760_000_105_000, "NX"]]);

    const held = fakeValkey({ set: null });
    expect(
      await new ValkeyCacheStore(held.provider).tryLock("list", "b", 1_760_000_105_000, 0),
    ).toBe(false);
  });

  it("releases the lock with a compare-and-delete script", async () => {
    const { provider, sent } = fakeValkey({ eval: 1 });
    await new ValkeyCacheStore(provider).unlock("list", "a");
    expect(sent).toEqual([["EVAL", UNLOCK_IF_OWNER, 1, "lock:list", "a"]]);
  });
});

describe("connection rotation", () => {
  function tracker() {
    const opened: { id: number; closed: boolean }[] = [];
    const open = async (): Promise<Opened> => {
      const connection = { id: opened.length, closed: false };
      opened.push(connection);
      return {
        commands: { ...(await fakeValkey().provider()), get: async () => String(connection.id) },
        close: () => {
          connection.closed = true;
        },
      };
    };
    return { opened, open };
  }

  it("keeps one connection until it is too old, then opens another and closes the first", async () => {
    const clock = { now: 0 };
    const { opened, open } = tracker();
    const provider = rotating({ open, maxAgeMs: 600_000, now: () => clock.now });

    expect(await (await provider()).get("k")).toBe("0");
    clock.now = 599_999;
    expect(await (await provider()).get("k")).toBe("0");
    clock.now = 600_000;
    expect(await (await provider()).get("k")).toBe("1");
    expect(opened.map((connection) => connection.closed)).toEqual([true, false]);
  });

  it("opens once when several requests arrive before the connection is ready", async () => {
    const { opened, open } = tracker();
    const provider = rotating({ open, maxAgeMs: 600_000, now: () => 0 });
    await Promise.all([provider(), provider(), provider()]);
    expect(opened).toHaveLength(1);
  });

  it("tries again after a failed open", async () => {
    let attempts = 0;
    const { open } = tracker();
    const provider = rotating({
      open: () => (attempts++ === 0 ? Promise.reject(new Error("WRONGPASS")) : open()),
      maxAgeMs: 600_000,
      now: () => 0,
    });
    await expect(provider()).rejects.toThrow("WRONGPASS");
    expect(await (await provider()).get("k")).toBe("0");
  });
});

describe("command deadline", () => {
  it("gives up on a server that does not answer", async () => {
    const silent = { get: () => new Promise<string | null>(() => {}) };
    await expect(withDeadline(silent as never, 20).get("k")).rejects.toThrow(
      "did not answer within 20 ms",
    );
  });

  it("passes an answer through", async () => {
    const quick = { get: async () => "v1" };
    expect(await withDeadline(quick as never, 20).get("k")).toBe("v1");
  });
});
