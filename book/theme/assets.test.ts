import { describe, expect, it } from "vite-plus/test";

import { brandFiles } from "./assets.ts";
import { colors } from "./theme.ts";

describe("the files served under /brand/", () => {
  const files = brandFiles();
  const scripts = [...files].filter(([name]) => name.endsWith(".js"));

  it("ships every script the cover imports, under the name it is imported by", () => {
    expect(scripts.length).toBeGreaterThan(0);
    for (const [name, file] of scripts) {
      for (const [, imported] of file.body.matchAll(/from\s+"\.\/([\w.-]+)"/g)) {
        expect(files.has(imported ?? ""), `${name} imports ${imported}`).toBe(true);
      }
      // A leftover ".ts" would be a 404 in the browser.
      expect(file.body).not.toMatch(/from\s+"[^"]+\.ts"/);
    }
  });

  it("gives the header a mark for each theme, in the two colours text may have", () => {
    expect(files.get("mark-navy.svg")?.body).toContain(colors.navy);
    expect(files.get("mark-white.svg")?.body).toContain(colors.white);
    expect(files.get("mark.svg")?.body).toContain("currentColor");
  });
});
