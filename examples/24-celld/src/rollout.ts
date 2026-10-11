import { type CelldVersion, DOCUMENTED, upgradeModeFor } from "./celld.ts";
import type { NodeName } from "./config.ts";
import { type FleetView, fleetSettled, type NodeHealth } from "./health.ts";

// The order of operations, and nothing else. Every effect goes through `FleetOps`,
// so the tests can replay any failure at any step without a clock or a network.

// #region ops
export type FleetOps = {
  nodeHealth(node: NodeName): Promise<NodeHealth>;
  /** `celld diagnose`, run on `via`: every node lease, and a probe of each live peer. */
  fleetView(via: NodeName): Promise<FleetView>;
  /** SIGTERM and wait: the node hands its cells off, then the process exits. */
  drain(node: NodeName): Promise<void>;
  install(node: NodeName, version: CelldVersion): Promise<void>;
  start(node: NodeName): Promise<void>;
  wait(ms: number): Promise<void>;
};

export type Phase = "plan" | "precheck" | "drain" | "install" | "start" | "settle";
export type Step = { node: NodeName | "fleet"; phase: Phase; detail: string };
export type RolloutResult =
  | { ok: true; steps: Step[] }
  | { ok: false; steps: Step[]; failed: Step; untouched: NodeName[] };

export type SettlePolicy = { attempts: number; intervalMs: number };
/** Two checks past celld's own first-readiness gate (CELLD_READY_FLEET_GATE_MS, 120 s). */
export const DEFAULT_SETTLE: SettlePolicy = { attempts: 30, intervalMs: 5_000 };
// #endregion ops

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

class Halt extends Error {
  readonly step: Step;
  constructor(step: Step) {
    super(step.detail);
    this.step = step;
  }
}

async function attempt<T>(node: NodeName | "fleet", phase: Phase, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw error instanceof Halt ? error : new Halt({ node, phase, detail: message(error) });
  }
}

/** Polls until the node is healthy on the target version and the whole fleet has nothing left to restore. */
async function settle(
  node: NodeName,
  nodes: NodeName[],
  target: CelldVersion,
  ops: FleetOps,
  policy: SettlePolicy,
): Promise<string> {
  let last = "never checked";
  for (let check = 1; check <= policy.attempts; check += 1) {
    await ops.wait(policy.intervalMs);
    const health = await ops.nodeHealth(node);
    if (!health.active) {
      last = "the service is not active";
      continue;
    }
    if (health.version !== target) {
      // Not a matter of waiting: the wrong binary is running.
      throw new Halt({
        node,
        phase: "settle",
        detail: `runs ${health.version ?? "an unknown version"}, not ${target}`,
      });
    }
    if (!health.healthy) {
      last = `${DOCUMENTED.healthPath} does not answer 200 yet`;
      continue;
    }
    const settled = fleetSettled(await ops.fleetView(node), nodes.length);
    if (settled.settled) {
      return `healthy after ${check} check(s)`;
    }
    last = settled.reasons.join("; ");
  }
  throw new Halt({ node, phase: "settle", detail: `not settled after ${policy.attempts} checks: ${last}` });
}

// #region rolling
export type RollingInput = {
  nodes: NodeName[];
  target: CelldVersion;
  ops: FleetOps;
  settle?: SettlePolicy;
};

/**
 * One node at a time: drain, install, start, wait until the fleet has settled, next.
 * Stops at the first thing that goes wrong and leaves the remaining nodes alone.
 */
export async function rollingUpdate(input: RollingInput): Promise<RolloutResult> {
  const { nodes, target, ops } = input;
  const policy = input.settle ?? DEFAULT_SETTLE;
  const steps: Step[] = [];
  const done = new Set<NodeName>();
  try {
    if (nodes.length < 2) {
      // The handoff releases each cell to a peer. With one node there is none.
      throw new Halt({ node: "fleet", phase: "plan", detail: "a rolling update needs at least two nodes" });
    }
    // Every node must be up, and every version in the fleet must be one the notes allow to roll.
    await attempt("fleet", "precheck", async () => {
      for (const node of nodes) {
        const health = await ops.nodeHealth(node);
        if (!health.active || !health.healthy || health.version === null) {
          throw new Halt({ node, phase: "precheck", detail: "not healthy before the update started" });
        }
        const decision = upgradeModeFor(health.version, target);
        if (decision.mode !== "rolling") {
          throw new Halt({ node, phase: "plan", detail: `${decision.reason}; a rolling update is not allowed` });
        }
      }
      const first = nodes[0];
      const settled = fleetSettled(first === undefined ? emptyView() : await ops.fleetView(first), nodes.length);
      if (!settled.settled) {
        throw new Halt({ node: "fleet", phase: "precheck", detail: settled.reasons.join("; ") });
      }
    });
    steps.push({ node: "fleet", phase: "precheck", detail: `${nodes.length} nodes healthy, nothing restoring` });

    for (const node of nodes) {
      await attempt(node, "drain", () => ops.drain(node));
      steps.push({ node, phase: "drain", detail: "stopped after handing its cells off" });
      // From here the node counts as touched: it is down, whatever happens next.
      done.add(node);
      await attempt(node, "install", () => ops.install(node, target));
      steps.push({ node, phase: "install", detail: target });
      await attempt(node, "start", () => ops.start(node));
      steps.push({ node, phase: "start", detail: "started" });
      const detail = await attempt(node, "settle", () => settle(node, nodes, target, ops, policy));
      steps.push({ node, phase: "settle", detail });
    }
    return { ok: true, steps };
  } catch (error) {
    if (!(error instanceof Halt)) {
      throw error;
    }
    return { ok: false, steps, failed: error.step, untouched: nodes.filter((node) => !done.has(node)) };
  }
}
// #endregion rolling

const emptyView = (): FleetView => ({ failures: [], peers: [], expired: 0, unreadable: [] });

// #region stop-all
/** SIGTERM to every node in turn, then one lease lifetime so that no lease is still alive. */
export async function drainFleet(nodes: NodeName[], ops: FleetOps): Promise<RolloutResult> {
  const steps: Step[] = [];
  const done = new Set<NodeName>();
  try {
    for (const node of nodes) {
      await attempt(node, "drain", () => ops.drain(node));
      done.add(node);
      steps.push({ node, phase: "drain", detail: "stopped" });
    }
    await ops.wait(DOCUMENTED.leaseTtlMs + 5_000);
    for (const node of nodes) {
      const health = await attempt(node, "settle", () => ops.nodeHealth(node));
      if (health.active) {
        throw new Halt({ node, phase: "settle", detail: "the service is active again" });
      }
    }
    steps.push({ node: "fleet", phase: "settle", detail: "every node stopped, one lease lifetime waited" });
    return { ok: true, steps };
  } catch (error) {
    if (!(error instanceof Halt)) {
      throw error;
    }
    return { ok: false, steps, failed: error.step, untouched: nodes.filter((node) => !done.has(node)) };
  }
}

/**
 * For version pairs the notes mark "stop all". Starts from a fleet that is already
 * stopped (`drainFleet`, then a backup), so an old and a new binary never serve together.
 */
export async function stoppedFleetUpdate(input: RollingInput): Promise<RolloutResult> {
  const { nodes, target, ops } = input;
  const policy = input.settle ?? DEFAULT_SETTLE;
  const steps: Step[] = [];
  const done = new Set<NodeName>();
  try {
    for (const node of nodes) {
      const health = await attempt(node, "precheck", () => ops.nodeHealth(node));
      if (health.active) {
        throw new Halt({ node, phase: "precheck", detail: "still running; stop the whole fleet first" });
      }
      if (health.version !== null && upgradeModeFor(health.version, target).mode === "unknown") {
        throw new Halt({ node, phase: "plan", detail: upgradeModeFor(health.version, target).reason });
      }
    }
    steps.push({ node: "fleet", phase: "precheck", detail: "every node is stopped" });
    // Install everywhere before anything starts: a node that restarts on its own must find the new binary.
    for (const node of nodes) {
      await attempt(node, "install", () => ops.install(node, target));
      done.add(node);
      steps.push({ node, phase: "install", detail: target });
    }
    for (const node of nodes) {
      await attempt(node, "start", () => ops.start(node));
      steps.push({ node, phase: "start", detail: "started" });
    }
    for (const node of nodes) {
      const detail = await attempt(node, "settle", () => settle(node, nodes, target, ops, policy));
      steps.push({ node, phase: "settle", detail });
    }
    return { ok: true, steps };
  } catch (error) {
    if (!(error instanceof Halt)) {
      throw error;
    }
    return { ok: false, steps, failed: error.step, untouched: nodes.filter((node) => !done.has(node)) };
  }
}
// #endregion stop-all

export function describeRollout(result: RolloutResult): string[] {
  const lines = result.steps.map((step) => `  ${step.node.padEnd(5)} ${step.phase.padEnd(8)} ${step.detail}`);
  if (result.ok) {
    return [...lines, "done"];
  }
  return [
    ...lines,
    `STOPPED at ${result.failed.node} (${result.failed.phase}): ${result.failed.detail}`,
    result.untouched.length > 0 ? `not touched: ${result.untouched.join(", ")}` : "every node was touched",
    "Nothing is rolled back automatically. Look at the node first: vp run celld:status, vp run celld:logs.",
  ];
}
