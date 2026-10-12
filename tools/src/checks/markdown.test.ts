import { describe, expect, it } from "vite-plus/test";

import { hasRegion, parsePage } from "./markdown.ts";

const page = parsePage(
  [
    "---",
    'title: "Example"',
    "revision: 3",
    "---",
    "# Title",
    "<!-- section: 03.bucket -->",
    "See [chapter 2](/ja/chapters/02-toolchain.md#drift).",
    "```text",
    "Browser -> CloudFront",
    "```",
    "<<< @/examples/03-spa/infra/lib/spa-stack.ts{bucket}",
    "<<< @/flake.nix",
    "````md",
    "```text",
    "not a diagram of this page",
    "```",
    "<!-- section: 99.inside-a-code-block -->",
    "````",
  ].join("\n"),
);

describe("markdown structure", () => {
  it("reads the frontmatter", () => {
    expect(page.frontmatter).toEqual({ title: "Example", revision: "3" });
  });

  it("finds sections, imports, diagrams, and links", () => {
    expect(page.sections).toEqual(["03.bucket"]);
    expect(page.imports).toEqual([
      { path: "examples/03-spa/infra/lib/spa-stack.ts", region: "bucket" },
      { path: "flake.nix", region: undefined },
    ]);
    expect(page.diagrams).toEqual(["Browser -> CloudFront"]);
    expect(page.links).toEqual(["/ja/chapters/02-toolchain.md"]);
  });

  it("ignores markers inside a code block", () => {
    expect(page.sections).not.toContain("99.inside-a-code-block");
    expect(page.codeBlocks).toBe(2);
  });

  it("needs the region marker, not a mention of its name", () => {
    expect(hasRegion("// #region bucket\nconst a = 1;\n// #endregion bucket", "bucket")).toBe(true);
    expect(hasRegion("const bucket = 1; // region bucket", "bucket")).toBe(false);
  });
});
