import { describe, expect, it } from "vite-plus/test";

import { lintGroups } from "./lint-groups.ts";

describe("CI lint groups", () => {
  it("keeps chapters separate without dropping root, hidden, or new files", () => {
    const paths = [
      "vite.config.ts",
      ".github/workflows/check.yml",
      "book/infra/lib/book-site-stack.ts",
      "book/theme/theme.ts",
      "tools/src/checks/check.ts",
      "examples/03-spa/infra/app.ts",
      "examples/03-spa/src/app.ts",
      "examples/70-new/a file.ts",
      "examples/README.md",
    ];
    const groups = lintGroups(paths);
    expect(groups.flatMap((group) => group.paths).toSorted()).toEqual(paths.toSorted());
    expect(groups.find((group) => group.name === "examples/03-spa")?.paths).toEqual([
      "examples/03-spa/infra/app.ts",
      "examples/03-spa/src/app.ts",
    ]);
    expect(groups.find((group) => group.name === "examples/70-new")?.paths).toEqual([
      "examples/70-new/a file.ts",
    ]);
  });

  it("does not lint the same file twice", () => {
    expect(lintGroups(["vite.config.ts", "vite.config.ts"])).toEqual([
      { name: ".", paths: ["vite.config.ts"] },
    ]);
  });
});
