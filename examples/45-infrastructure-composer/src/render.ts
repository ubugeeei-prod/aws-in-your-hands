// A graph as text for the terminal, and as the source of a ```figure block for the book.

import type { GraphDiff } from "./diff.ts";
import type { Edge, Graph, Node, Via } from "./graph.ts";
import type { Summary } from "./summary.ts";

/** docs/FIGURES.md: a figure with more than nine boxes should be two figures. */
export const FIGURE_NODE_LIMIT = 9;

const shortVia: Record<Via, string> = {
  Ref: "Ref",
  "Fn::GetAtt": "GetAtt",
  "Fn::Sub": "Sub",
  DependsOn: "DependsOn",
};

type Pair = { from: string; to: string; vias: Via[] };

/** One line per pair of resources, however many ways the first names the second. */
function pairs(edges: readonly Edge[]): Pair[] {
  const byPair = new Map<string, Pair>();
  for (const { from, to, via } of edges) {
    const key = `${from} ${to}`;
    const pair = byPair.get(key) ?? { from, to, vias: [] };
    pair.vias.push(via);
    byPair.set(key, pair);
  }
  return [...byPair.values()];
}

const label = (vias: readonly Via[]): string => vias.map((via) => shortVia[via]).join(", ");
const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;
const block = (title: string, lines: readonly string[]): string[] => [
  "",
  title,
  ...(lines.length === 0 ? ["  (none)"] : lines.map((line) => `  ${line}`)),
];

// #region text
export function renderText(name: string, graph: Graph, summary: Summary): string {
  const width = Math.max(0, ...summary.countsByType.map(({ count }) => String(count).length));
  const lines = [
    `${name}: ${plural(graph.nodes.length, "resource")}, ${plural(pairs(graph.edges).length, "connection")}`,
    ...graph.omitted.map((node) => `left out: ${node.id} (${node.type})`),
    ...block(
      "types",
      summary.countsByType.map(({ type, count }) => `${String(count).padStart(width)}  ${type}`),
    ),
    ...block(
      "connections (from names to)",
      pairs(graph.edges).map(({ from, to, vias }) => `${from} -> ${to}  [${label(vias)}]`),
    ),
    ...block(
      "no resource names these",
      summary.unreferenced.map((node) => `${node.id}  ${node.type}`),
    ),
    ...block(
      "no connection at all",
      summary.isolated.map((node) => `${node.id}  ${node.type}`),
    ),
    ...(summary.cycle === undefined
      ? block(`longest chain (${summary.longestChain.length})`, [summary.longestChain.join(" -> ")])
      : block("cycle", [summary.cycle.join(" -> ")])),
    ...block(
      "outputs",
      graph.outputs.map(
        ({ name: output, to }) => `${output} -> ${to.join(", ") || "(no resource)"}`,
      ),
    ),
    ...block(
      "names that are not in the template",
      graph.unresolved.map(
        ({ from, name: missing, via }) => `${from} -> ${missing}  [${shortVia[via]}]`,
      ),
    ),
  ];
  return lines.join("\n");
}
// #endregion text

/**
 * The nodes with every resource before the ones it names, so the figure's arrows run downwards:
 * the layout ranks boxes by arrows, and an arrow back to an earlier box does not move it.
 */
function namersFirst(graph: Graph): Node[] {
  const waiting = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (const { from, to } of pairs(graph.edges)) {
    if (from !== to) {
      waiting.set(to, (waiting.get(to) ?? 0) + 1);
    }
  }
  const ordered: Node[] = [];
  let ready = graph.nodes.filter((node) => waiting.get(node.id) === 0);
  while (ready.length > 0) {
    ordered.push(...ready);
    const released = new Set<string>();
    for (const { from, to } of pairs(graph.edges)) {
      if (from !== to && ready.some((node) => node.id === from)) {
        const left = (waiting.get(to) ?? 0) - 1;
        waiting.set(to, left);
        if (left === 0) {
          released.add(to);
        }
      }
    }
    ready = graph.nodes.filter((node) => released.has(node.id));
  }
  // What a cycle keeps waiting goes last, in template order.
  return [...ordered, ...graph.nodes.filter((node) => !ordered.includes(node))];
}

// #region figure
/**
 * The source of a ```figure block, or undefined when the graph has too many boxes for one.
 * A dashed arrow is a pair joined by DependsOn alone: an order, with no value passed.
 */
export function renderFigure(caption: string, graph: Graph): string | undefined {
  if (graph.nodes.length === 0 || graph.nodes.length > FIGURE_NODE_LIMIT) {
    return undefined;
  }
  return [
    `caption: ${caption}`,
    ...namersFirst(graph).map((node) => `node ${node.id}: ${node.id} | ${node.type}`),
    ...pairs(graph.edges).map(({ from, to, vias }) => {
      const arrow = vias.every((via) => via === "DependsOn") ? "-->" : "->";
      return `edge ${from} ${arrow} ${to}: ${label(vias)}`;
    }),
  ].join("\n");
}
// #endregion figure

const edgeLine = (edge: Edge): string => `${edge.from} -> ${edge.to}  [${shortVia[edge.via]}]`;

export function renderDiff(diff: GraphDiff): string {
  if (diff.same) {
    return "same resources, same types, same connections (property values are not compared)";
  }
  return [
    ...diff.addedNodes.map((id) => `+ resource    ${id}`),
    ...diff.removedNodes.map((id) => `- resource    ${id}`),
    ...diff.retyped.map(({ id, from, to }) => `~ type        ${id}: ${from} -> ${to}`),
    ...diff.addedEdges.map((edge) => `+ connection  ${edgeLine(edge)}`),
    ...diff.removedEdges.map((edge) => `- connection  ${edgeLine(edge)}`),
  ].join("\n");
}
