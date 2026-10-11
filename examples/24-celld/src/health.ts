import { z } from "zod";

// What the nodes print, turned into values. Every parser fails closed: output
// it cannot read is "not healthy", never "probably fine".

// #region node-health
export type NodeHealth = { active: boolean; healthy: boolean; version: string | null };

/** Reads the three lines of `nodeCommands().health()`. */
export function parseNodeHealth(stdout: string): NodeHealth {
  const field = (name: string): string | null => new RegExp(`^${name} (.*)$`, "m").exec(stdout)?.[1]?.trim() ?? null;
  const version = field("VERSION");
  return {
    active: field("ACTIVE") === "active",
    // 200 is celld's "healthy". It answers 503 while draining and before a joining node settles.
    healthy: field("HEALTH") === "200",
    version: version !== null && /^v\d+\.\d+\.\d+$/.test(version) ? version : null,
  };
}
// #endregion node-health

// #region diagnose
/** One line of `celld diagnose --json`, as fleet.rs prints it at the pinned tag. */
const checkSchema = z.object({
  verdict: z.string(),
  check: z.string(),
  detail: z.string().default(""),
});

export type PeerView = { node: string; address: string; restoring: number | null };
export type FleetView = {
  /** Checks with verdict "fail", as printed. */
  failures: string[];
  /** Live peers that answered the signed probe. */
  peers: PeerView[];
  /** Node leases that were listed but had expired. */
  expired: number;
  unreadable: string[];
};

export function parseDiagnose(stdout: string): FleetView {
  const view: FleetView = { failures: [], peers: [], expired: 0, unreadable: [] };
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      view.unreadable.push(line);
      continue;
    }
    const parsed = checkSchema.safeParse(json);
    if (!parsed.success) {
      view.unreadable.push(line);
      continue;
    }
    const { verdict, check, detail } = parsed.data;
    if (verdict === "fail") {
      view.failures.push(`${check}: ${detail}`);
      continue;
    }
    if (verdict === "skip") {
      view.expired += 1;
      continue;
    }
    const peer = /^peer (\S+) at (\S+)$/.exec(check);
    if (verdict === "ok" && peer !== null) {
      const restoring = /(?:^|\s)restoring=(\d+)(?:\s|$)/.exec(detail);
      view.peers.push({
        node: peer[1] ?? "",
        address: peer[2] ?? "",
        restoring: restoring === null ? null : Number(restoring[1]),
      });
    }
  }
  return view;
}
// #endregion diagnose

// #region settled
export type Settled = { settled: true } | { settled: false; reasons: string[] };

/**
 * The gate between two nodes of a rolling update. celld's documentation asks for
 * `restoring=0` on every node before the next restart; the rest makes sure the
 * view is complete enough to believe.
 */
export function fleetSettled(view: FleetView, expectedNodes: number): Settled {
  const reasons: string[] = [];
  if (view.unreadable.length > 0) {
    reasons.push(`${view.unreadable.length} line(s) of diagnose output were not understood`);
  }
  reasons.push(...view.failures.map((failure) => `diagnose failed: ${failure}`));
  if (view.peers.length !== expectedNodes) {
    reasons.push(`${view.peers.length} live peer(s) answered, expected ${expectedNodes}`);
  }
  for (const peer of view.peers) {
    if (peer.restoring === null) {
      reasons.push(`peer ${peer.node} did not report restoring`);
    } else if (peer.restoring > 0) {
      reasons.push(`peer ${peer.node} is still restoring ${peer.restoring} cell(s)`);
    }
  }
  return reasons.length === 0 ? { settled: true } : { settled: false, reasons };
}
// #endregion settled
