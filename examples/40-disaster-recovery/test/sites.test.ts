import { describe, expect, it } from "vite-plus/test";

import { TwoSites } from "../src/sites.ts";

/** A small deterministic generator, so a failing schedule can be run again. */
const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 2 ** 32;
  return seed / 2 ** 32;
};

describe("who holds the truth", () => {
  it("loses nothing when everything had been replicated before the source died", () => {
    const world = new TwoSites();
    world.write("source", "a");
    world.replicate();
    world.loseSource();
    world.launchRecovery();
    world.switchAddress("recovery");
    expect(world.recovery.notes.has("a")).toBe(true);
    expect(world.silentlyLost()).toEqual([]);
  });

  it("starts the recovery instance at the recovery point, without what was still in flight", () => {
    const world = new TwoSites();
    world.write("source", "a");
    world.replicate();
    world.write("source", "b");
    world.loseSource();
    world.launchRecovery();
    world.switchAddress("recovery");
    expect([...world.recovery.notes.keys()]).toEqual(["a"]);
    // The loss already exists at failover. Failback only decides whether anyone is told.
    expect(world.silentlyLost().map((write) => write.id)).toEqual(["b"]);
  });

  it("refuses a write at a site that is down or fenced, so the client knows", () => {
    const world = new TwoSites();
    expect(world.write("recovery", "early")).toBe(false);
    world.fenceSource();
    expect(world.write("source", "late")).toBe(false);
    expect(world.acknowledged).toEqual([]);
  });
});

describe("the source comes back while the recovery instance serves writes", () => {
  const splitBrain = (): TwoSites => {
    const world = new TwoSites();
    world.write("source", "a");
    world.replicate();
    world.write("source", "in-flight");
    world.loseSource();
    world.launchRecovery();
    world.switchAddress("recovery");
    world.write("recovery", "after-failover");
    world.returnSource({ fenced: false });
    world.write("source", "stale-client");
    return world;
  };

  it("is a split brain: both sites acknowledge writes the other never sees", () => {
    const world = splitBrain();
    expect(world.splitBrain).toBe(true);
    expect(world.source.notes.has("after-failover")).toBe(false);
    expect(world.recovery.notes.has("stale-client")).toBe(false);
  });

  it("loses the source's writes without a word when failback just overwrites it", () => {
    const world = splitBrain();
    world.failbackNaive();
    expect(world.silentlyLost().map((write) => write.id)).toEqual(["in-flight", "stale-client"]);
  });

  it("refuses to replicate over a source that still accepts writes", () => {
    expect(() => splitBrain().failbackAccounted({ sourceReadable: true })).toThrow(/Fence it/);
  });

  it("names every write the overwrite discards once the source is fenced and read", () => {
    const world = splitBrain();
    world.fenceSource();
    const accounted = world.failbackAccounted({ sourceReadable: true });
    expect(accounted.map((entry) => entry.kind === "write" && entry.id)).toEqual([
      "in-flight",
      "stale-client",
    ]);
    expect(world.silentlyLost()).toEqual([]);
    expect(world.source.notes.has("after-failover")).toBe(true);
    expect(world.address).toBe("source");
    expect(world.splitBrain).toBe(false);
  });

  it("declares a window when the source's disk cannot be read", () => {
    const world = new TwoSites();
    world.write("source", "a");
    world.replicate();
    world.write("source", "b");
    world.write("source", "c");
    world.loseSource();
    world.launchRecovery();
    world.switchAddress("recovery");
    const accounted = world.failbackAccounted({ sourceReadable: false });
    expect(accounted).toEqual([
      expect.objectContaining({ kind: "window", site: "source", after: 1 }),
    ]);
    expect(world.silentlyLost()).toEqual([]);
  });
});

describe("the invariant under schedules nobody chose", () => {
  // After failback, no acknowledged write from either side is lost silently.
  it.each([1, 7, 42, 2026, 31337])("holds for seed %i with the accounted failback", (seed) => {
    const random = seeded(seed);
    const world = new TwoSites();
    let next = 0;
    const burst = (site: "source" | "recovery") => {
      for (let count = Math.floor(random() * 5); count > 0; count -= 1) {
        world.write(site, `n${next++}`);
        if (site === "source" && random() < 0.5) {
          world.replicate(1);
        }
      }
    };
    burst("source");
    world.loseSource();
    world.launchRecovery();
    world.switchAddress("recovery");
    burst("recovery");
    const readable = random() < 0.5;
    if (readable) {
      world.returnSource({ fenced: random() < 0.5 });
      burst("source");
    }
    burst("recovery");
    world.fenceSource();
    world.failbackAccounted({ sourceReadable: readable });
    expect(world.silentlyLost()).toEqual([]);
    expect(world.acknowledged.length).toBeGreaterThanOrEqual(world.source.notes.size);
  });

  it("is broken by the naive failback on at least one of the same schedules", () => {
    const broken = [1, 7, 42, 2026, 31337].filter((seed) => {
      const random = seeded(seed);
      const world = new TwoSites();
      for (let index = 0; index < 4; index += 1) {
        world.write("source", `n${index}`);
        if (random() < 0.5) {
          world.replicate(1);
        }
      }
      world.loseSource();
      world.launchRecovery();
      world.switchAddress("recovery");
      world.failbackNaive();
      return world.silentlyLost().length > 0;
    });
    expect(broken.length).toBeGreaterThan(0);
  });
});
