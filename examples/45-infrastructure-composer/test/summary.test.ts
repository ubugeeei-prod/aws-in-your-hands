import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vite-plus/test";

import { templateGraph } from "../src/graph.ts";
import { summarize } from "../src/summary.ts";
import { parseTemplate } from "../src/template.ts";

const graphOf = (resources: Record<string, unknown>) =>
  templateGraph(parseTemplate(JSON.stringify({ Resources: resources })));

const fixture = templateGraph(
  parseTemplate(
    readFileSync(join(import.meta.dirname, "../fixtures/notes-api.template.json"), "utf8"),
  ),
);

describe("the summary of the fixture", () => {
  const summary = summarize(fixture);

  test("counts by type, the most common first", () => {
    expect(summary.countsByType).toHaveLength(9);
    expect(summary.countsByType.every(({ count }) => count === 1)).toBe(true);
    expect(summary.countsByType[0]?.type).toBe("AWS::ApiGatewayV2::Api");
  });

  test("the entry points and the leftover are the resources nothing names", () => {
    expect(summary.unreferenced.map((node) => node.id)).toEqual([
      "ApiRoute",
      "InvokePermission",
      "LeftoverQueue",
    ]);
  });

  test("only the leftover has no connection at all", () => {
    expect(summary.isolated.map((node) => node.id)).toEqual(["LeftoverQueue"]);
  });

  test("the longest chain runs from the route to the role", () => {
    expect(summary.longestChain).toEqual([
      "ApiRoute",
      "ApiIntegration",
      "NotesFn",
      "FnPolicy",
      "FnRole",
    ]);
    expect(summary.cycle).toBeUndefined();
  });
});

describe("chains", () => {
  test("a shortcut does not shorten the chain", () => {
    const summary = summarize(
      graphOf({
        A: { Type: "T::A", DependsOn: ["C", "B"] },
        B: { Type: "T::B", DependsOn: "C" },
        C: { Type: "T::C" },
      }),
    );
    expect(summary.longestChain).toEqual(["A", "B", "C"]);
  });

  test("a cycle is reported and no chain is claimed", () => {
    const summary = summarize(
      graphOf({
        Entry: { Type: "T::E", DependsOn: "A" },
        A: { Type: "T::A", DependsOn: "B" },
        B: { Type: "T::B", DependsOn: "A" },
      }),
    );
    expect(summary.cycle).toEqual(["A", "B", "A"]);
    expect(summary.longestChain).toEqual([]);
  });

  test("a resource that names itself is a cycle of one", () => {
    expect(summarize(graphOf({ A: { Type: "T::A", DependsOn: "A" } })).cycle).toEqual(["A", "A"]);
  });

  test("an empty template has nothing to report", () => {
    expect(summarize(graphOf({}))).toEqual({
      countsByType: [],
      unreferenced: [],
      isolated: [],
      longestChain: [],
      cycle: undefined,
    });
  });

  test("a deep template does not make the walk quadratic in what it revisits", () => {
    const resources: Record<string, unknown> = {};
    for (let index = 0; index < 500; index += 1) {
      resources[`R${index}`] = {
        Type: "T::R",
        ...(index === 499 ? {} : { DependsOn: [`R${index + 1}`, `R${Math.min(index + 2, 499)}`] }),
      };
    }
    expect(summarize(graphOf(resources)).longestChain).toHaveLength(500);
  });
});
