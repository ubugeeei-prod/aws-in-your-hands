import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { COLUMNS } from "@aih/example-26-analytics/src/record.ts";

import { contractBlock, sparkColumns, withContract } from "../src/contract.ts";

const script = readFileSync(new URL("../glue/curate.py", import.meta.url), "utf8");

describe("what the Spark script takes from TypeScript", () => {
  it("is up to date in the script", () => {
    // Stale after a change to the columns or the rules: run `vp run glue:contract`.
    expect(withContract(script)).toBe(script);
    expect(script).toContain(contractBlock());
  });

  it("names every column of the record, in the table's order", () => {
    expect(
      sparkColumns()
        .split(", ")
        .map((column) => column.split(" ")[0]),
    ).toEqual(COLUMNS.map((column) => column.name));
    expect(sparkColumns()).toContain("duration_ms BIGINT");
  });

  it("changes nothing outside its markers", () => {
    const rewritten = withContract("before\n# contract:begin\nOLD = 1\n# contract:end\nafter\n");
    expect(rewritten.startsWith("before\n# contract:begin")).toBe(true);
    expect(rewritten.endsWith("# contract:end\nafter\n")).toBe(true);
    expect(rewritten).not.toContain("OLD");
  });

  it("refuses a script without the markers", () => {
    expect(() => withContract("print('hello')\n")).toThrow();
  });
});
