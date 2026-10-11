import { describe, expect, it } from "vite-plus/test";
import { createKeyring } from "../src/keyring.ts";
import { MemorySecretStore, type SecretSource } from "../src/secret-source.ts";
import { parseToken, signToken, verifyToken } from "../src/token.ts";

const TTL = 300_000;
const MIN_REFRESH = 30_000;
const key = (n: number) => `key-${n}-${"x".repeat(40)}`;
const version = (n: number) => ({ versionId: `v${n}`, key: key(n), createdAt: new Date(0) });

/** One clock and one secret, shared by as many execution environments as a test needs. */
function world() {
  const clock = { ms: 0 };
  const store = new MemorySecretStore(version(1));
  const environment = (source: SecretSource = store) =>
    createKeyring({ source, now: () => clock.ms, ttlMs: TTL, minRefreshMs: MIN_REFRESH });
  const seconds = () => Math.floor(clock.ms / 1000);
  const accepts = async (keyring: ReturnType<typeof environment>, token: string) => {
    const parsed = parseToken(token);
    const found = parsed === null ? null : await keyring.find(parsed.versionId);
    return parsed !== null && found !== null && verifyToken(parsed, found, seconds()) === "ok";
  };
  const issue = async (keyring: ReturnType<typeof environment>) =>
    signToken(await keyring.current(), "alice", seconds() + 300);
  return { clock, store, environment, accepts, issue };
}

describe("a rotation seen by two execution environments at different times", () => {
  it("accepts a token signed with the new key in an environment that has not reloaded yet", async () => {
    const { clock, store, environment, accepts, issue } = world();
    const a = environment();
    const b = environment();
    await a.current();
    await b.current();

    clock.ms += 60_000;
    store.put(version(2));
    // A new environment starts after the rotation and signs with v2. B still holds v1 as current.
    const fresh = environment();
    const token = await issue(fresh);
    expect(parseToken(token)?.versionId).toBe("v2");
    expect(await accepts(b, token)).toBe(true);
  });

  it("keeps accepting tokens signed with the previous key, from an environment that is still using it", async () => {
    const { clock, store, environment, accepts, issue } = world();
    const stale = environment();
    await stale.current();

    clock.ms += 60_000;
    store.put(version(2));
    // Inside its TTL, the stale environment has no reason to look: it still signs with v1.
    const token = await issue(stale);
    expect(parseToken(token)?.versionId).toBe("v1");
    expect(await accepts(environment(), token)).toBe(true);
  });

  it("rejects an unexpired token once its key is two rotations old", async () => {
    const { clock, store, environment, accepts, issue } = world();
    const token = await issue(environment());
    clock.ms += 10_000;
    store.put(version(2));
    clock.ms += 10_000;
    store.put(version(3));
    // This is the invariant a second rotation inside the overlap breaks. rotation.ts refuses to do it.
    expect(await accepts(environment(), token)).toBe(false);
  });

  it("moves to the new key by itself once the cache expires", async () => {
    const { clock, store, environment } = world();
    const keyring = environment();
    expect((await keyring.current()).versionId).toBe("v1");
    store.put(version(2));
    clock.ms += TTL - 1;
    expect((await keyring.current()).versionId).toBe("v1");
    clock.ms += 1;
    expect((await keyring.current()).versionId).toBe("v2");
  });
});

describe("what an attacker or an outage can make the keyring do", () => {
  it("does not let made-up version ids buy a Secrets Manager call each", async () => {
    const { clock, store, environment } = world();
    const keyring = environment();
    await keyring.current();
    const afterStart = store.reads;

    for (let i = 0; i < 1000; i++) {
      expect(await keyring.find(`made-up-${i}`)).toBeNull();
    }
    // The initial load already counts as an attempt, so nothing more is read inside the window.
    expect(store.reads).toBe(afterStart);

    clock.ms += MIN_REFRESH;
    for (let i = 0; i < 1000; i++) {
      await keyring.find(`made-up-again-${i}`);
    }
    // One reload, which is two reads: AWSCURRENT and AWSPREVIOUS.
    expect(store.reads).toBe(afterStart + 2);
  });

  it("shares one load between concurrent requests", async () => {
    const { store, environment } = world();
    const keyring = environment();
    await Promise.all(Array.from({ length: 50 }, () => keyring.current()));
    expect(store.reads).toBe(2);
  });

  it("keeps verifying with the keys it has when Secrets Manager stops answering", async () => {
    const { clock, store, environment, accepts, issue } = world();
    let failing = false;
    let attempts = 0;
    const flaky: SecretSource = {
      read: (stage) => {
        attempts += 1;
        return failing ? Promise.reject(new Error("timeout")) : store.read(stage);
      },
    };
    const keyring = environment(flaky);
    const token = await issue(keyring);

    failing = true;
    clock.ms += TTL + 1;
    const before = attempts;
    expect(await accepts(keyring, token)).toBe(false); // expired by now, but checked, not thrown
    expect((await keyring.current()).versionId).toBe("v1");
    await keyring.current();
    // One failed reload, then quiet until the refresh window has passed.
    expect(attempts).toBe(before + 2);
  });

  it("fails loudly when it has never had a key", async () => {
    const { environment } = world();
    const down: SecretSource = { read: () => Promise.reject(new Error("timeout")) };
    await expect(environment(down).current()).rejects.toThrow("timeout");
  });
});
