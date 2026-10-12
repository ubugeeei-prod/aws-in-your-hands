// Figures for the book, drawn at build time from a few lines of text.
//
// A chapter writes what is connected to what:
//
//   ```figure
//   caption: CloudFront reads the private bucket for the reader
//   direction: right
//   node browser: Browser
//   node cf: CloudFront | distribution
//   node s3: S3 bucket | private
//   edge browser -> cf: HTTPS
//   edge cf -> s3: signed request
//   group aws: AWS account = cf, s3
//   ```
//
// and this module lays it out and returns an <svg> in the brand's line and type.
// The grammar is in docs/FIGURES.md. Colours come from CSS, so a figure follows the theme.

export type FigureNode = { id: string; label: string; sub?: string; marked: boolean };
export type FigureEdge = {
  from: string;
  to: string;
  label?: string;
  dashed: boolean;
  failed: boolean;
};
export type FigureGroup = { id: string; label: string; members: string[] };
export type FigureNote = { at: string; label: string };
export type Figure = {
  type: "flow" | "sequence";
  caption: string;
  direction: "down" | "right";
  nodes: FigureNode[];
  edges: FigureEdge[];
  groups: FigureGroup[];
  /** Sequence figures only: edges and notes in the order they happen. */
  steps: ({ kind: "edge"; edge: FigureEdge } | { kind: "note"; note: FigureNote })[];
};

export class FigureError extends Error {}

const ARROW = /^(\S+)\s+(-->|->|-x|--x)\s+(\S+?)(?::\s*(.*))?$/;

export function parseFigure(source: string): Figure {
  const figure: Figure = {
    type: "flow",
    caption: "",
    direction: "down",
    nodes: [],
    edges: [],
    groups: [],
    steps: [],
  };
  const fail = (line: number, message: string): never => {
    throw new FigureError(`figure line ${line}: ${message}`);
  };

  source.split("\n").forEach((raw, index) => {
    const line = raw.trim();
    const at = index + 1;
    if (line === "" || line.startsWith("#")) {
      return;
    }
    const space = line.indexOf(" ");
    const keyword = space === -1 ? line : line.slice(0, space);
    const rest = space === -1 ? "" : line.slice(space + 1).trim();

    if (keyword === "caption:") {
      figure.caption = rest;
    } else if (keyword === "type:") {
      if (rest !== "flow" && rest !== "sequence") {
        fail(at, `type is "flow" or "sequence", not "${rest}"`);
      }
      figure.type = rest as Figure["type"];
    } else if (keyword === "direction:") {
      if (rest !== "down" && rest !== "right") {
        fail(at, `direction is "down" or "right", not "${rest}"`);
      }
      figure.direction = rest as Figure["direction"];
    } else if (keyword === "node" || keyword === "actor") {
      const match = /^(\S+?):\s*(.+)$/.exec(rest) ?? fail(at, `expected "${keyword} id: label"`);
      // Only a bar with a space on each side starts the note: "GET|POST /notes" is one label.
      const [label = "", sub] = (match[2] ?? "").split(/\s\|\s/).map((part) => part.trim());
      figure.nodes.push({ id: match[1] ?? "", label, ...(sub ? { sub } : {}), marked: false });
    } else if (keyword === "edge" || keyword === "step") {
      const match = ARROW.exec(rest) ?? fail(at, `expected "${keyword} a -> b: label"`);
      const arrow = match[2] ?? "->";
      const edge: FigureEdge = {
        from: match[1] ?? "",
        to: match[3] ?? "",
        ...(match[4] ? { label: match[4].trim() } : {}),
        dashed: arrow.startsWith("--"),
        failed: arrow.endsWith("x"),
      };
      figure.edges.push(edge);
      figure.steps.push({ kind: "edge", edge });
    } else if (keyword === "note") {
      const match = /^(\S+?):\s*(.+)$/.exec(rest) ?? fail(at, 'expected "note id: text"');
      figure.steps.push({ kind: "note", note: { at: match[1] ?? "", label: match[2] ?? "" } });
    } else if (keyword === "group") {
      const match =
        /^(\S+?):\s*(.+)\s=\s(.+)$/.exec(rest) ?? fail(at, 'expected "group id: label = a, b"');
      figure.groups.push({
        id: match[1] ?? "",
        label: match[2] ?? "",
        members: (match[3] ?? "").split(",").map((member) => member.trim()),
      });
    } else if (keyword === "mark") {
      const node =
        figure.nodes.find((each) => each.id === rest) ?? fail(at, `mark: no node "${rest}"`);
      node.marked = true;
    } else {
      fail(at, `unknown keyword "${keyword}"`);
    }
  });

  if (figure.caption === "") {
    throw new FigureError("figure: a caption is required. It is also what a screen reader says.");
  }
  if (figure.nodes.length === 0) {
    throw new FigureError("figure: no nodes");
  }
  const known = new Set(figure.nodes.map((node) => node.id));
  if (known.size !== figure.nodes.length) {
    throw new FigureError("figure: two nodes share an id");
  }
  const names = [
    ...figure.edges.flatMap((edge) => [edge.from, edge.to]),
    ...figure.groups.flatMap((group) => group.members),
    ...figure.steps.flatMap((step) => (step.kind === "note" ? [step.note.at] : [])),
  ];
  for (const name of names) {
    if (!known.has(name)) {
      throw new FigureError(`figure: "${name}" is not a node`);
    }
  }
  return figure;
}

// ---- measuring ---------------------------------------------------------------

/** Width of a run of text in em. Full-width characters take 1 em, the rest a little over half. */
export function textWidth(text: string, mono = false): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const wide = code >= 0x2e80 || (code >= 0xff00 && code <= 0xffef);
    width += wide ? 1 : mono ? 0.6 : /[A-Z0-9MWmw@%]/.test(char) ? 0.66 : 0.54;
  }
  return width;
}

const FONT = { label: 14, sub: 11.5, edge: 11.5, caption: 13 } as const;
const NODE = { padX: 18, height: 44, heightWithSub: 58, minWidth: 96, gap: 28 } as const;

type Box = { x: number; y: number; width: number; height: number };
type Placed = FigureNode & Box;

const escape = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const round = (n: number): number => Math.round(n * 10) / 10;

function nodeSize(node: FigureNode): { width: number; height: number } {
  const text = Math.max(
    textWidth(node.label) * FONT.label,
    node.sub === undefined ? 0 : textWidth(node.sub, true) * FONT.sub,
  );
  return {
    width: Math.max(NODE.minWidth, Math.ceil(text + NODE.padX * 2)),
    height: node.sub === undefined ? NODE.height : NODE.heightWithSub,
  };
}

function drawNode(node: Placed): string {
  const cx = round(node.x + node.width / 2);
  const cy = node.y + node.height / 2;
  const label =
    node.sub === undefined
      ? `<text class="aih-figure__label" x="${cx}" y="${round(cy + 5)}">${escape(node.label)}</text>`
      : `<text class="aih-figure__label" x="${cx}" y="${round(cy - 2)}">${escape(node.label)}</text>` +
        `<text class="aih-figure__sub" x="${cx}" y="${round(cy + 15)}">${escape(node.sub)}</text>`;
  // The node the chapter is about is drawn with a heavier outline.
  const classes = node.marked ? "aih-figure__node aih-figure__node--marked" : "aih-figure__node";
  return `<rect class="${classes}" x="${round(node.x)}" y="${round(node.y)}" width="${node.width}" height="${node.height}"/>${label}`;
}

/** A label that sits on a line needs the line cleared behind it. */
function edgeLabel(
  text: string,
  x: number,
  y: number,
  anchor: "middle" | "start",
): { svg: string; box: Box } {
  const width = textWidth(text, true) * FONT.edge + 10;
  const left = anchor === "middle" ? x - width / 2 : x - 5;
  return {
    svg:
      `<rect class="aih-figure__clear" x="${round(left)}" y="${round(y - 12)}" width="${round(width)}" height="17"/>` +
      `<text class="aih-figure__edge-label" x="${round(x)}" y="${round(y)}" text-anchor="${anchor}">${escape(text)}</text>`,
    box: { x: left, y: y - 12, width, height: 17 },
  };
}

function path(edge: FigureEdge, d: string): string {
  const classes = ["aih-figure__edge", edge.dashed ? "aih-figure__edge--dashed" : ""]
    .join(" ")
    .trim();
  const end = edge.failed ? "aih-figure-cross" : "aih-figure-arrow";
  return `<path class="${classes}" d="${d}" marker-end="url(#${end})"/>`;
}

const DEFS =
  "<defs>" +
  '<marker id="aih-figure-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">' +
  '<path class="aih-figure__head" d="M1 1 L9 5 L1 9"/></marker>' +
  '<marker id="aih-figure-cross" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="11" markerHeight="11" orient="auto">' +
  '<path class="aih-figure__head" d="M1.5 1.5 L8.5 8.5 M8.5 1.5 L1.5 8.5"/></marker>' +
  "</defs>";

function frame(figure: Figure, body: string, extent: Box): string {
  const pad = 12;
  const width = Math.ceil(extent.width + pad * 2);
  const height = Math.ceil(extent.height + pad * 2);
  const view = `${round(extent.x - pad)} ${round(extent.y - pad)} ${width} ${height}`;
  return (
    `<figure class="aih-figure aih-figure--${figure.type}">` +
    `<div class="aih-figure__canvas"><svg xmlns="http://www.w3.org/2000/svg" viewBox="${view}" width="${width}" height="${height}" role="img" aria-label="${escape(figure.caption)}">${
      DEFS
    }${body}</svg></div>` +
    `<figcaption>${escape(figure.caption)}</figcaption>` +
    `</figure>`
  );
}

function extentOf(boxes: Box[]): Box {
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

// ---- flow ------------------------------------------------------------------------

/**
 * Each node's rank: one more than the furthest of the nodes that point at it.
 * An edge that points back at an earlier node is drawn, but does not move anything.
 */
export function ranks(figure: Figure): Map<string, number> {
  const order = new Map(figure.nodes.map((node, index) => [node.id, index]));
  const rank = new Map(figure.nodes.map((node) => [node.id, 0]));
  const forward = figure.edges.filter(
    (edge) => (order.get(edge.from) ?? 0) < (order.get(edge.to) ?? 0),
  );
  for (let pass = 0; pass < figure.nodes.length; pass++) {
    for (const edge of forward) {
      rank.set(edge.to, Math.max(rank.get(edge.to) ?? 0, (rank.get(edge.from) ?? 0) + 1));
    }
  }
  return rank;
}

function renderFlow(figure: Figure): string {
  const down = figure.direction === "down";
  const rank = ranks(figure);
  const grouped = figure.groups.length > 0;
  const placed = new Map<string, Placed>();

  // Lay the figure out as if it ran downwards: `main` is along the flow, `cross` is across it.
  const levels: FigureNode[][] = [];
  for (const node of figure.nodes) {
    (levels[rank.get(node.id) ?? 0] ??= []).push(node);
  }
  const size = new Map(figure.nodes.map((node) => [node.id, nodeSize(node)]));
  const across = (id: string): number => (down ? size.get(id)?.width : size.get(id)?.height) ?? 0;
  const along = (id: string): number => (down ? size.get(id)?.height : size.get(id)?.width) ?? 0;

  // Room between two levels: enough for the longest label on an edge that crosses it.
  const labelRoom = (level: number): number => {
    const labels = figure.edges
      .filter((edge) => Math.min(rank.get(edge.from) ?? 0, rank.get(edge.to) ?? 0) === level)
      .filter((edge) => rank.get(edge.from) !== rank.get(edge.to))
      .map((edge) => (edge.label === undefined ? 0 : textWidth(edge.label, true) * FONT.edge));
    const longest = Math.max(0, ...labels);
    return down ? 76 : Math.max(64, longest + 40);
  };

  const centre = new Map<string, number>();
  let main = 0;
  levels.forEach((level, index) => {
    // Under the nodes that point here, if any; otherwise where the level above left off.
    const wanted = level.map((node) => {
      const parents = figure.edges
        .filter((edge) => edge.to === node.id && (rank.get(edge.from) ?? 0) < index)
        .map((edge) => centre.get(edge.from))
        .filter((value) => value !== undefined);
      return parents.length === 0
        ? undefined
        : parents.reduce((sum, value) => sum + value, 0) / parents.length;
    });
    const gap = NODE.gap + (grouped ? 20 : 0);
    // `edge` is the far side of the node placed before this one.
    let edge = -Infinity;
    level.forEach((node, at) => {
      const half = across(node.id) / 2;
      const nearest = edge === -Infinity ? -Infinity : edge + gap + half;
      const position = Math.max(wanted[at] ?? (edge === -Infinity ? 0 : nearest), nearest);
      centre.set(node.id, position);
      edge = position + half;
    });
    const depth = Math.max(...level.map((node) => along(node.id)));
    for (const node of level) {
      const s = size.get(node.id) ?? { width: 0, height: 0 };
      const c = centre.get(node.id) ?? 0;
      const m = main + (depth - along(node.id)) / 2;
      placed.set(node.id, {
        ...node,
        ...s,
        x: down ? c - s.width / 2 : m,
        y: down ? m : c - s.height / 2,
      });
    }
    main += depth + labelRoom(index) + (grouped ? 24 : 0);
  });

  const parts: string[] = [];
  const boxes: Box[] = [...placed.values()];
  // Labels of edges that run inside a group belong inside its border.
  const inside = new Map<string, Box[]>(figure.groups.map((group) => [group.id, []]));
  const groupLabels: string[] = [];

  const drawGroup = (group: FigureGroup): string => {
    const members = group.members.map((id) => placed.get(id)).filter((node) => node !== undefined);
    const inner = extentOf([...members, ...(inside.get(group.id) ?? [])]);
    const box = {
      x: inner.x - 16,
      y: inner.y - 30,
      width: inner.width + 32,
      height: inner.height + 46,
    };
    box.width = Math.max(box.width, textWidth(group.label, true) * FONT.sub + 28);
    boxes.push(box);
    // The name goes on last, over a patch of the group's own fill: an arrow coming in from
    // above passes behind it.
    const width = textWidth(group.label, true) * FONT.sub + 12;
    groupLabels.push(
      `<rect class="aih-figure__group-clear" x="${round(box.x + 6)}" y="${round(box.y + 6)}" width="${round(width)}" height="17"/>` +
        `<text class="aih-figure__group-label" x="${round(box.x + 12)}" y="${round(box.y + 18)}">${escape(group.label)}</text>`,
    );
    return `<rect class="aih-figure__group" x="${round(box.x)}" y="${round(box.y)}" width="${round(box.width)}" height="${round(box.height)}"/>`;
  };

  const outer = extentOf([...placed.values()]);
  let detour = 0;
  const edges: string[] = [];
  for (const edge of figure.edges) {
    const a = placed.get(edge.from);
    const b = placed.get(edge.to);
    if (a === undefined || b === undefined) {
      continue;
    }
    const [ra, rb] = [rank.get(edge.from) ?? 0, rank.get(edge.to) ?? 0];
    const ac = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
    const bc = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    let d: string;
    let label: { x: number; y: number; anchor: "middle" | "start" };

    // Two arrows between the same pair of nodes run side by side, not on top of each other.
    const twins = figure.edges.filter(
      (other) =>
        other.from !== other.to &&
        ((other.from === edge.from && other.to === edge.to) || (other.from === edge.to && other.to === edge.from)),
    );
    const shift = (twins.indexOf(edge) - (twins.length - 1) / 2) * 18;
    if (down !== (ra === rb)) {
      ac.x += shift;
      bc.x += shift;
    } else {
      ac.y += shift;
      bc.y += shift;
    }
    // Several arrows arriving at one node would stack their labels there. Each keeps its label near its own start.
    const arriving = figure.edges.filter(
      (other) => other.to === edge.to && other.from !== other.to && (rank.get(other.from) ?? 0) < rb,
    ).length;

    if (edge.from === edge.to) {
      // Something a node does to itself: a small turn out of its side and back.
      const x = a.x + a.width;
      d = `M${round(x)} ${round(ac.y - 8)} H${round(x + 22)} V${round(ac.y + 8)} H${round(x + 2)}`;
      label = { x: x + 30, y: ac.y + 4, anchor: "start" };
    } else if (ra === rb) {
      // Side by side: a straight line between the facing sides.
      if (down) {
        const leftToRight = ac.x < bc.x;
        const x1 = leftToRight ? a.x + a.width : a.x;
        const x2 = leftToRight ? b.x : b.x + b.width;
        d = `M${round(x1)} ${round(ac.y)} H${round(x2)}`;
        label = { x: (x1 + x2) / 2, y: ac.y - 8, anchor: "middle" };
      } else {
        const topToBottom = ac.y < bc.y;
        const y1 = topToBottom ? a.y + a.height : a.y;
        const y2 = topToBottom ? b.y : b.y + b.height;
        d = `M${round(ac.x)} ${round(y1)} V${round(y2)}`;
        label = { x: ac.x + 10, y: (y1 + y2) / 2 + 4, anchor: "start" };
      }
    } else if (rb > ra) {
      if (down) {
        const [y1, y2] = [a.y + a.height, b.y];
        // The crossbar of a branch sits just above the level below, so labels have the room over it.
        const mid = y2 - 34;
        d =
          Math.abs(ac.x - bc.x) < 1
            ? `M${round(ac.x)} ${round(y1)} V${round(y2)}`
            : `M${round(ac.x)} ${round(y1)} V${round(mid)} H${round(bc.x)} V${round(y2)}`;
        label =
          Math.abs(ac.x - bc.x) < 1
            ? { x: ac.x + 10, y: y1 + 22, anchor: "start" }
            : arriving > 1
              ? { x: ac.x + 10, y: y1 + 22, anchor: "start" }
              : { x: bc.x + 10, y: y2 - 12, anchor: "start" };
      } else {
        const [x1, x2] = [a.x + a.width, b.x];
        const straight = Math.abs(ac.y - bc.y) < 1;
        // One of several arriving: travel along its own row and turn at the end. Otherwise turn at once.
        const mid = arriving > 1 ? x2 - 22 : x1 + 22;
        d = straight
          ? `M${round(x1)} ${round(ac.y)} H${round(x2)}`
          : `M${round(x1)} ${round(ac.y)} H${round(mid)} V${round(bc.y)} H${round(x2)}`;
        label = straight
          ? { x: (x1 + x2) / 2, y: ac.y - 8, anchor: "middle" }
          : arriving > 1
            ? { x: (x1 + mid) / 2, y: ac.y - 8, anchor: "middle" }
            : { x: (mid + x2) / 2, y: bc.y - 8, anchor: "middle" };
      }
    } else {
      // Back to an earlier node: out to the side, around, and in again.
      detour += 1;
      if (down) {
        const x = outer.x + outer.width + 12 + detour * 22;
        d = `M${round(a.x + a.width)} ${round(ac.y)} H${round(x)} V${round(bc.y)} H${round(b.x + b.width)}`;
        label = { x: x + 8, y: (ac.y + bc.y) / 2 + 4, anchor: "start" };
      } else {
        const y = outer.y + outer.height + 12 + detour * 24;
        d = `M${round(ac.x)} ${round(a.y + a.height)} V${round(y)} H${round(bc.x)} V${round(b.y + b.height)}`;
        label = { x: (ac.x + bc.x) / 2, y: y - 6, anchor: "middle" };
      }
    }
    edges.push(path(edge, d));
    if (edge.label !== undefined) {
      const drawn = edgeLabel(edge.label, label.x, label.y, label.anchor);
      edges.push(drawn.svg);
      boxes.push(drawn.box);
      for (const group of figure.groups) {
        if (group.members.includes(edge.from) && group.members.includes(edge.to)) {
          inside.get(group.id)?.push(drawn.box);
        }
      }
    }
    if (rb < ra) {
      boxes.push({
        x: outer.x,
        y: outer.y,
        width: outer.width + 16 + detour * 22,
        height: outer.height + 16 + detour * 24,
      });
    }
  }

  parts.push(
    ...figure.groups.map(drawGroup),
    ...edges,
    ...groupLabels,
    ...[...placed.values()].map(drawNode),
  );
  return frame(figure, parts.join(""), extentOf(boxes));
}

// ---- sequence --------------------------------------------------------------------

function renderSequence(figure: Figure): string {
  const labels = figure.steps.map((step) =>
    step.kind === "edge" ? (step.edge.label ?? "") : step.note.label,
  );
  const longest = Math.max(0, ...labels.map((label) => textWidth(label, true) * FONT.edge));
  const sizes = figure.nodes.map(nodeSize);
  const widest = Math.max(...sizes.map((size) => size.width));
  const spacing = Math.max(widest + 32, Math.min(380, longest + 56));
  const head = Math.max(...sizes.map((size) => size.height));
  const row = 46;

  const x = new Map(figure.nodes.map((node, index) => [node.id, index * spacing]));
  const bottom = head + 26 + figure.steps.length * row;
  const parts: string[] = [];
  const boxes: Box[] = [];

  figure.nodes.forEach((node, index) => {
    const size = sizes[index] ?? { width: 0, height: 0 };
    const cx = x.get(node.id) ?? 0;
    const placed = { ...node, ...size, x: cx - size.width / 2, y: (head - size.height) / 2 };
    parts.push(
      `<path class="aih-figure__lifeline" d="M${round(cx)} ${head} V${bottom}"/>`,
      drawNode(placed),
    );
    boxes.push(placed, { x: cx - 1, y: head, width: 2, height: bottom - head });
  });

  figure.steps.forEach((step, index) => {
    const y = head + 26 + index * row + 22;
    if (step.kind === "note") {
      const cx = x.get(step.note.at) ?? 0;
      const width = textWidth(step.note.label, true) * FONT.edge + 20;
      const box = { x: cx - width / 2, y: y - 15, width, height: 24 };
      parts.push(
        `<rect class="aih-figure__note" x="${round(box.x)}" y="${round(box.y)}" width="${round(width)}" height="24"/>` +
          `<text class="aih-figure__edge-label" x="${round(cx)}" y="${round(y + 1)}" text-anchor="middle">${escape(step.note.label)}</text>`,
      );
      boxes.push(box);
      return;
    }
    const { edge } = step;
    const from = x.get(edge.from) ?? 0;
    const to = x.get(edge.to) ?? 0;
    if (from === to) {
      // Something an actor does on its own: a small turn back to itself.
      parts.push(
        path(
          edge,
          `M${round(from)} ${round(y - 10)} H${round(from + 26)} V${round(y + 6)} H${round(from + 2)}`,
        ),
      );
      if (edge.label !== undefined) {
        const drawn = edgeLabel(edge.label, from + 34, y + 2, "start");
        parts.push(drawn.svg);
        boxes.push(drawn.box);
      }
      return;
    }
    const inset = to > from ? -2 : 2;
    parts.push(path(edge, `M${round(from)} ${round(y)} H${round(to + inset)}`));
    if (edge.label !== undefined) {
      const drawn = edgeLabel(edge.label, (from + to) / 2, y - 7, "middle");
      parts.push(drawn.svg);
      boxes.push(drawn.box);
    }
  });

  return frame(figure, parts.join(""), extentOf(boxes));
}

/** The fenced text of a figure as finished HTML: a <figure> with an inline <svg> and its caption. */
export function renderFigure(source: string): string {
  const figure = parseFigure(source);
  return figure.type === "sequence" ? renderSequence(figure) : renderFlow(figure);
}
