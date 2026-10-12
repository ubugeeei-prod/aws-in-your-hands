// Two templates that claim to describe the same stack, compared as graphs.

import type { Edge, Graph } from "./graph.ts";

// #region diff
export type GraphDiff = {
  same: boolean;
  addedNodes: string[];
  removedNodes: string[];
  retyped: { id: string; from: string; to: string }[];
  addedEdges: Edge[];
  removedEdges: Edge[];
};

const edgeKey = (edge: Edge): string => `${edge.from} ${edge.via} ${edge.to}`;

/** What `after` has that `before` does not, and the reverse. Property values are not compared. */
export function diffGraphs(before: Graph, after: Graph): GraphDiff {
  const beforeTypes = new Map(before.nodes.map((node) => [node.id, node.type]));
  const afterTypes = new Map(after.nodes.map((node) => [node.id, node.type]));
  const beforeEdges = new Set(before.edges.map(edgeKey));
  const afterEdges = new Set(after.edges.map(edgeKey));

  const diff = {
    addedNodes: after.nodes.filter((node) => !beforeTypes.has(node.id)).map((node) => node.id),
    removedNodes: before.nodes.filter((node) => !afterTypes.has(node.id)).map((node) => node.id),
    retyped: after.nodes.flatMap((node) => {
      const was = beforeTypes.get(node.id);
      return was === undefined || was === node.type
        ? []
        : [{ id: node.id, from: was, to: node.type }];
    }),
    addedEdges: after.edges.filter((edge) => !beforeEdges.has(edgeKey(edge))),
    removedEdges: before.edges.filter((edge) => !afterEdges.has(edgeKey(edge))),
  };
  return { same: Object.values(diff).every((list) => list.length === 0), ...diff };
}
// #endregion diff
