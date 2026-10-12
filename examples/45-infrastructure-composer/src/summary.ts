// What a reviewer asks of a graph before reading the template line by line.

import type { Graph, Node } from "./graph.ts";

// #region summary
export type Summary = {
  countsByType: { type: string; count: number }[];
  /** No other resource names these. Each is either an entry point or a leftover. */
  unreferenced: Node[];
  /** These name nothing and are named by nothing. */
  isolated: Node[];
  /** The longest run of resources in which each names the next. Empty when there is a cycle. */
  longestChain: string[];
  /** One cycle, if the references form any. Such a template has no order to create things in. */
  cycle: string[] | undefined;
};
// #endregion summary

function countsByType(nodes: readonly Node[]): Summary["countsByType"] {
  const counts = new Map<string, number>();
  for (const { type } of nodes) {
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [...counts]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || (a.type < b.type ? -1 : 1));
}

// #region chain
/** Depth-first over the references. A node met again while still open closes a cycle. */
function chains(graph: Graph): Pick<Summary, "longestChain" | "cycle"> {
  const next = new Map<string, string[]>(graph.nodes.map((node) => [node.id, []]));
  for (const { from, to } of graph.edges) {
    const targets = next.get(from) ?? [];
    if (!targets.includes(to)) {
      targets.push(to);
    }
  }

  const best = new Map<string, string[]>();
  const open: string[] = [];
  let cycle: string[] | undefined;

  const longestFrom = (id: string): string[] => {
    const done = best.get(id);
    if (done !== undefined) {
      return done;
    }
    const at = open.indexOf(id);
    if (at !== -1) {
      cycle ??= [...open.slice(at), id];
      return [];
    }
    open.push(id);
    let tail: string[] = [];
    for (const target of next.get(id) ?? []) {
      const candidate = longestFrom(target);
      if (candidate.length > tail.length) {
        tail = candidate;
      }
    }
    open.pop();
    const chain = [id, ...tail];
    best.set(id, chain);
    return chain;
  };

  let longestChain: string[] = [];
  for (const { id } of graph.nodes) {
    const chain = longestFrom(id);
    if (chain.length > longestChain.length) {
      longestChain = chain;
    }
  }
  return cycle === undefined ? { longestChain, cycle } : { longestChain: [], cycle };
}
// #endregion chain

export function summarize(graph: Graph): Summary {
  const named = new Set(graph.edges.map((edge) => edge.to));
  const naming = new Set(graph.edges.map((edge) => edge.from));
  const unreferenced = graph.nodes.filter((node) => !named.has(node.id));
  return {
    countsByType: countsByType(graph.nodes),
    unreferenced,
    isolated: unreferenced.filter((node) => !naming.has(node.id)),
    ...chains(graph),
  };
}
