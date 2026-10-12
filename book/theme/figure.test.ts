import { describe, expect, it } from "vite-plus/test";

import { FigureError, parseFigure, ranks, renderFigure, textWidth } from "./figure.ts";

const flow = `
caption: CloudFront reads the private bucket
node browser: Browser
node cf: CloudFront | distribution
node s3: S3 bucket
edge browser -> cf: HTTPS
edge cf -> s3
edge s3 --> browser: 200
group aws: AWS account = cf, s3
mark s3
`;

describe("reading a figure", () => {
  it("keeps what was written: labels, notes under them, groups, and the marked node", () => {
    const figure = parseFigure(flow);
    expect(figure.nodes.map((node) => [node.id, node.label, node.sub, node.marked])).toEqual([
      ["browser", "Browser", undefined, false],
      ["cf", "CloudFront", "distribution", false],
      ["s3", "S3 bucket", undefined, true],
    ]);
    expect(figure.edges[2]).toMatchObject({
      from: "s3",
      to: "browser",
      label: "200",
      dashed: true,
      failed: false,
    });
    expect(figure.groups).toEqual([{ id: "aws", label: "AWS account", members: ["cf", "s3"] }]);
  });

  it("tells a refusal from a call, solid or dashed", () => {
    const figure = parseFigure("caption: c\nnode a: A\nnode b: B\nedge a -x b\nedge a --x b: late");
    expect(figure.edges.map((edge) => [edge.dashed, edge.failed])).toEqual([
      [false, true],
      [true, true],
    ]);
  });

  // A figure with no caption has nothing for a screen reader to say.
  it("refuses a figure without a caption", () => {
    expect(() => parseFigure("node a: A")).toThrow(FigureError);
  });

  it.each([
    [
      "an arrow to a node that was never declared",
      "caption: c\nnode a: A\nedge a -> b",
      '"b" is not a node',
    ],
    ["a word it does not know", "caption: c\nnode a: A\nnodes b: B", "line 3"],
    ["two nodes with one id", "caption: c\nnode a: A\nnode a: B", "share an id"],
    ["a direction that is not one", "caption: c\ndirection: left\nnode a: A", "line 2"],
  ])("refuses %s, and says where", (_what, source, message) => {
    expect(() => parseFigure(source)).toThrow(message);
  });
});

describe("laying a flow out", () => {
  it("puts each node one level after the furthest node that points at it", () => {
    const figure = parseFigure(
      "caption: c\nnode a: A\nnode b: B\nnode c: C\nedge a -> b\nedge b -> c\nedge a -> c",
    );
    expect([...ranks(figure)]).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ]);
  });

  // Otherwise a retry loop would push its own start further and further down.
  it("does not let an arrow back to an earlier node move anything", () => {
    const figure = parseFigure(
      "caption: c\nnode a: A\nnode b: B\nedge a -> b\nedge b --> a: retry",
    );
    expect([...ranks(figure).values()]).toEqual([0, 1]);
  });
});

describe("drawing a figure", () => {
  // Each arrow is one <path>; two that share their endpoints must not share their coordinates.
  it("draws two arrows between the same nodes side by side", () => {
    const html = renderFigure("caption: c\nnode a: A\nnode b: B\nedge a -> b: ask\nedge b --> a: answer");
    const paths = [...html.matchAll(/<path class="aih-figure__edge[^"]*" d="([^"]+)"/g)].map((match) => match[1]);
    expect(paths).toHaveLength(2);
    expect(paths[0]).not.toBe(paths[1]);
  });

  it("gives an arrow from a node to itself a line of its own", () => {
    const html = renderFigure("caption: c\nnode a: A\nedge a -> a: retry");
    expect(html).toMatch(/<path class="aih-figure__edge" d="M[\d.]+ [\d.]+ H[\d.]+ V[\d.]+ H[\d.]+"/);
  });

  it("gives the picture its caption twice: under it, and as its accessible name", () => {
    const html = renderFigure(flow);
    expect(html).toContain('role="img" aria-label="CloudFront reads the private bucket"');
    expect(html).toContain("<figcaption>CloudFront reads the private bucket</figcaption>");
  });

  it("escapes what a chapter wrote, so a label cannot become markup", () => {
    const html = renderFigure('caption: a < b & "c"\nnode a: <script>');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("a &lt; b &amp; &quot;c&quot;");
  });

  it("carries no colours of its own, so it follows the theme", () => {
    expect(renderFigure(flow)).not.toMatch(/#[0-9a-fA-F]{3,6}|fill="|stroke="|rgb\(/);
  });

  it("draws a sequence in the order it was written", () => {
    const html = renderFigure(
      "type: sequence\ncaption: c\nactor a: A\nactor b: B\nstep a -> b: first\nnote b: then\nstep b --> a: last",
    );
    expect(html.indexOf("first")).toBeLessThan(html.indexOf("then"));
    expect(html.indexOf("then")).toBeLessThan(html.indexOf("last"));
  });

  it("counts a full-width character as about two of the others", () => {
    expect(textWidth("雲")).toBe(1);
    expect(textWidth("ab", true)).toBeCloseTo(1.2);
    expect(textWidth("雲ab", true)).toBeCloseTo(2.2);
  });
});
