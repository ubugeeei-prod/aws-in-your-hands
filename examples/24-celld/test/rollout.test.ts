import { describe, expect, it } from "vite-plus/test";
import type { CelldVersion } from "../src/celld.ts";
import type { NodeName } from "../src/config.ts";
import type { FleetView, NodeHealth } from "../src/health.ts";
import { describeRollout, drainFleet, type FleetOps, rollingUpdate, stoppedFleetUpdate } from "../src/rollout.ts";

// A stand-in fleet: three records and a log. No clock: `wait` only writes to the log,
// and every failure below is placed at an exact step.

type Failure = { node: NodeName; step: "drain" | "install" | "start" };
type Options = {
  from?: string;
  fail?: Failure;
  /** After a restart, this many health checks answer 503 before the node reports healthy. */
  slowToSettle?: Partial<Record<NodeName, number>>;
  /** A node that keeps restoring cells forever after it was restarted. */
  neverSettles?: NodeName;
  /** A node whose service does not come up on the new binary. */
  startsOldBinary?: NodeName;
  down?: NodeName[];
};

function fleet(names: NodeName[], options: Options = {}) {
  const log: string[] = [];
  const nodes = new Map(
    names.map((name) => [
      name,
      {
        running: !(options.down ?? []).includes(name),
        installed: options.from ?? "v0.6.1",
        binary: options.from ?? "v0.6.1",
        checksUntilHealthy: 0,
        restarted: false,
      },
    ]),
  );
  const get = (name: NodeName) => {
    const node = nodes.get(name);
    if (node === undefined) {
      throw new Error(`no node ${name}`);
    }
    return node;
  };
  const failing = (node: NodeName, step: Failure["step"]): void => {
    if (options.fail?.node === node && options.fail.step === step) {
      throw new Error(`${step} failed on ${node}`);
    }
  };
  /** Checked on every step: the invariants of the procedure itself. */
  const observed = { mostDownAtOnce: 0, mixedVersionsServing: false };
  const observe = (): void => {
    const running = [...nodes.values()].filter((node) => node.running);
    observed.mostDownAtOnce = Math.max(observed.mostDownAtOnce, nodes.size - running.length);
    if (new Set(running.map((node) => node.binary)).size > 1) {
      observed.mixedVersionsServing = true;
    }
  };

  const ops: FleetOps = {
    nodeHealth: async (name): Promise<NodeHealth> => {
      const node = get(name);
      const healthy = node.running && node.checksUntilHealthy === 0;
      if (node.running && node.checksUntilHealthy > 0) {
        node.checksUntilHealthy -= 1;
      }
      return { active: node.running, healthy, version: node.installed };
    },
    fleetView: async (via): Promise<FleetView> => {
      log.push(`diagnose via ${via}`);
      return {
        failures: [],
        expired: 0,
        unreadable: [],
        peers: [...nodes.entries()]
          .filter(([, node]) => node.running)
          .map(([name, node]) => ({
            node: name,
            address: `10.20.128.${name.charCodeAt(0)}:8081`,
            restoring: options.neverSettles === name && node.restarted ? 7 : 0,
          })),
      };
    },
    drain: async (name) => {
      failing(name, "drain");
      get(name).running = false;
      log.push(`drain ${name}`);
      observe();
    },
    install: async (name, version: CelldVersion) => {
      failing(name, "install");
      get(name).installed = options.startsOldBinary === name ? get(name).installed : version;
      log.push(`install ${name} ${version}`);
    },
    start: async (name) => {
      failing(name, "start");
      const node = get(name);
      node.running = true;
      node.restarted = true;
      node.binary = node.installed;
      node.checksUntilHealthy = options.slowToSettle?.[name] ?? 0;
      log.push(`start ${name}`);
      observe();
    },
    wait: async (ms) => {
      log.push(`wait ${ms}`);
    },
  };
  return { ops, log, observed, nodes };
}

const quick = { attempts: 4, intervalMs: 5_000 };
const actions = (log: string[]): string[] =>
  log.filter((line) => !line.startsWith("wait") && !line.startsWith("diagnose"));

describe("a rolling update", () => {
  it("takes one node at a time, in order: drain, install, start, settle", async () => {
    const { ops, log, observed } = fleet(["a", "b", "c"]);
    const result = await rollingUpdate({ nodes: ["a", "b", "c"], target: "v0.6.2", ops, settle: quick });
    expect(result.ok).toBe(true);
    expect(actions(log)).toEqual([
      "drain a",
      "install a v0.6.2",
      "start a",
      "drain b",
      "install b v0.6.2",
      "start b",
      "drain c",
      "install c v0.6.2",
      "start c",
    ]);
    expect(observed.mostDownAtOnce).toBe(1);
  });

  it("does not move on until the restarted node is healthy and nothing is restoring", async () => {
    const { ops, log } = fleet(["a", "b"], { slowToSettle: { a: 2 } });
    const result = await rollingUpdate({ nodes: ["a", "b"], target: "v0.6.2", ops, settle: quick });
    expect(result.ok).toBe(true);
    // Three waits for a (two unhealthy checks, then the healthy one) before b is touched.
    expect(log.slice(log.indexOf("start a") + 1, log.indexOf("drain b"))).toEqual([
      "wait 5000",
      "wait 5000",
      "wait 5000",
      "diagnose via a",
    ]);
  });

  it.each<[Failure["step"], string[], NodeName[]]>([
    ["drain", ["drain a", "install a v0.6.2", "start a"], ["b", "c"]],
    ["install", ["drain a", "install a v0.6.2", "start a", "drain b"], ["c"]],
    ["start", ["drain a", "install a v0.6.2", "start a", "drain b", "install b v0.6.2"], ["c"]],
  ])("stops where %s fails on the second node and leaves the rest alone", async (step, done, untouched) => {
    const { ops, log, observed } = fleet(["a", "b", "c"], { fail: { node: "b", step } });
    const result = await rollingUpdate({ nodes: ["a", "b", "c"], target: "v0.6.2", ops, settle: quick });
    expect(result).toMatchObject({ ok: false, failed: { node: "b", phase: step }, untouched });
    expect(actions(log)).toEqual(done);
    expect(observed.mostDownAtOnce).toBeLessThanOrEqual(1);
  });

  it("stops when a restarted node never finishes restoring, with the next node still serving", async () => {
    const { ops, log, nodes } = fleet(["a", "b", "c"], { neverSettles: "a" });
    const result = await rollingUpdate({ nodes: ["a", "b", "c"], target: "v0.6.2", ops, settle: quick });
    expect(result).toMatchObject({
      ok: false,
      failed: { node: "a", phase: "settle", detail: "not settled after 4 checks: peer a is still restoring 7 cell(s)" },
      untouched: ["b", "c"],
    });
    expect(log.filter((line) => line === "wait 5000")).toHaveLength(4);
    expect(nodes.get("b")?.running).toBe(true);
    expect(describeRollout(result).at(-1)).toContain("Nothing is rolled back automatically");
  });

  it("stops at once when the node came back on the old binary", async () => {
    const { ops, log } = fleet(["a", "b"], { startsOldBinary: "a" });
    const result = await rollingUpdate({ nodes: ["a", "b"], target: "v0.6.2", ops, settle: quick });
    expect(result).toMatchObject({
      ok: false,
      failed: { node: "a", phase: "settle", detail: "runs v0.6.1, not v0.6.2" },
    });
    expect(log.filter((line) => line === "wait 5000")).toHaveLength(1);
  });

  it("touches nothing when a node is already down", async () => {
    const { ops, log } = fleet(["a", "b", "c"], { down: ["c"] });
    const result = await rollingUpdate({ nodes: ["a", "b", "c"], target: "v0.6.2", ops, settle: quick });
    expect(result).toMatchObject({ ok: false, failed: { node: "c", phase: "precheck" }, untouched: ["a", "b", "c"] });
    expect(actions(log)).toEqual([]);
  });

  it("refuses any version pair the upgrade notes do not list as rolling", async () => {
    for (const from of ["v0.5.1", "v0.3.0", "v9.9.9"]) {
      const { ops, log } = fleet(["a", "b"], { from });
      const result = await rollingUpdate({ nodes: ["a", "b"], target: "v0.6.2", ops, settle: quick });
      expect(result, from).toMatchObject({ ok: false, failed: { phase: "plan" }, untouched: ["a", "b"] });
      expect(actions(log), from).toEqual([]);
    }
  });

  it("refuses a fleet of one: there is no peer to hand the cells to", async () => {
    const { ops, log } = fleet(["a"]);
    const result = await rollingUpdate({ nodes: ["a"], target: "v0.6.2", ops, settle: quick });
    expect(result).toMatchObject({ ok: false, failed: { node: "fleet", phase: "plan" } });
    expect(actions(log)).toEqual([]);
  });
});

describe("an update of a stopped fleet", () => {
  it("installs everywhere before anything starts, so two versions never serve together", async () => {
    const { ops, log, observed } = fleet(["a", "b", "c"], { down: ["a", "b", "c"] });
    const result = await stoppedFleetUpdate({ nodes: ["a", "b", "c"], target: "v0.6.2", ops, settle: quick });
    expect(result.ok).toBe(true);
    expect(actions(log)).toEqual([
      "install a v0.6.2",
      "install b v0.6.2",
      "install c v0.6.2",
      "start a",
      "start b",
      "start c",
    ]);
    expect(observed.mixedVersionsServing).toBe(false);
  });

  it("refuses to start while any old node is still running", async () => {
    const { ops, log } = fleet(["a", "b", "c"], { down: ["a", "c"] });
    const result = await stoppedFleetUpdate({ nodes: ["a", "b", "c"], target: "v0.6.2", ops, settle: quick });
    expect(result).toMatchObject({ ok: false, failed: { node: "b", phase: "precheck" } });
    expect(actions(log)).toEqual([]);
  });

  it("starts nothing when one install fails", async () => {
    const { ops, log } = fleet(["a", "b"], { down: ["a", "b"], fail: { node: "b", step: "install" } });
    const result = await stoppedFleetUpdate({ nodes: ["a", "b"], target: "v0.6.2", ops, settle: quick });
    expect(result).toMatchObject({ ok: false, failed: { node: "b", phase: "install" }, untouched: ["b"] });
    expect(actions(log)).toEqual(["install a v0.6.2"]);
  });

  it("shows that the rolling procedure would have mixed versions, which is why the notes matter", async () => {
    const { ops, observed } = fleet(["a", "b"]);
    await rollingUpdate({ nodes: ["a", "b"], target: "v0.6.2", ops, settle: quick });
    expect(observed.mixedVersionsServing).toBe(true);
  });
});

describe("stopping the whole fleet", () => {
  it("drains every node in order, then waits out one lease lifetime", async () => {
    const { ops, log } = fleet(["a", "b", "c"]);
    const result = await drainFleet(["a", "b", "c"], ops);
    expect(result.ok).toBe(true);
    expect(log).toEqual(["drain a", "drain b", "drain c", "wait 15000"]);
  });

  it("stops at the node that would not drain", async () => {
    const { ops, log } = fleet(["a", "b", "c"], { fail: { node: "b", step: "drain" } });
    const result = await drainFleet(["a", "b", "c"], ops);
    expect(result).toMatchObject({ ok: false, failed: { node: "b", phase: "drain" }, untouched: ["b", "c"] });
    expect(log).toEqual(["drain a"]);
  });
});
