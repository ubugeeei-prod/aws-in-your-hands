import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vite-plus/test";

import { templateGraph } from "../src/graph.ts";
import { FIGURE_NODE_LIMIT, renderFigure, renderText } from "../src/render.ts";
import { summarize } from "../src/summary.ts";
import { parseTemplate } from "../src/template.ts";

const here = import.meta.dirname;
const fixture = templateGraph(
  parseTemplate(readFileSync(join(here, "../fixtures/notes-api.template.json"), "utf8")),
);

/** The lines of the first ```figure block of a page, without its caption. */
function figureInPage(language: "ja" | "en"): string[] {
  const page = readFileSync(
    join(here, `../../../book/content/${language}/chapters/45-infrastructure-composer/build.md`),
    "utf8",
  );
  const [, body = ""] = /```figure\n([\s\S]*?)\n```/.exec(page) ?? [];
  return body.split("\n").filter((line) => !line.startsWith("caption:"));
}

describe("text", () => {
  const text = renderText("notes-api", fixture, summarize(fixture));

  test("the head counts resources and connected pairs", () => {
    expect(text.split("\n")[0]).toBe("notes-api: 9 resources, 11 connections");
  });

  test("two forms between one pair are one line", () => {
    const graph = templateGraph(
      parseTemplate(
        JSON.stringify({
          Resources: {
            Bucket: { Type: "AWS::S3::Bucket" },
            Policy: {
              Type: "AWS::S3::BucketPolicy",
              Properties: { Bucket: { Ref: "Bucket" }, Arn: { "Fn::GetAtt": ["Bucket", "Arn"] } },
            },
          },
        }),
      ),
    );
    const lines = renderText("two", graph, summarize(graph)).split("\n");
    expect(lines[0]).toBe("two: 2 resources, 1 connection");
    expect(lines).toContain("  Policy -> Bucket  [Ref, GetAtt]");
  });

  test("an empty section says so instead of vanishing", () => {
    expect(text).toContain("names that are not in the template\n  (none)");
  });
});

describe("figure", () => {
  test("DependsOn alone is a dashed arrow, a value is a solid one", () => {
    const figure = renderFigure("c", fixture) ?? "";
    expect(figure).toContain("edge NotesFn --> FnPolicy: DependsOn");
    expect(figure).toContain("edge ApiRoute -> ApiIntegration: Sub");
  });

  test("a box comes before every box it names, cycle or not", () => {
    const lines = (renderFigure("c", fixture) ?? "").split("\n");
    const at = (id: string) => lines.findIndex((line) => line.startsWith(`node ${id}:`));
    for (const edge of fixture.edges) {
      expect(at(edge.from)).toBeLessThan(at(edge.to));
    }
    const loop = templateGraph(
      parseTemplate(
        JSON.stringify({
          Resources: {
            A: { Type: "T::A", DependsOn: "B" },
            B: { Type: "T::B", DependsOn: "A" },
            C: { Type: "T::C", DependsOn: "A" },
          },
        }),
      ),
    );
    expect((renderFigure("c", loop) ?? "").split("\n").slice(1, 4)).toEqual([
      "node C: C | T::C",
      "node A: A | T::A",
      "node B: B | T::B",
    ]);
  });

  test("more boxes than one figure holds: no figure", () => {
    const resources = Object.fromEntries(
      Array.from({ length: FIGURE_NODE_LIMIT + 1 }, (_, index) => [`R${index}`, { Type: "T::R" }]),
    );
    const graph = templateGraph(parseTemplate(JSON.stringify({ Resources: resources })));
    expect(renderFigure("c", graph)).toBeUndefined();
  });

  test("the figure printed in the book is the one this code prints, in both languages", () => {
    const expected = (renderFigure("c", fixture) ?? "").split("\n").slice(1);
    expect(figureInPage("ja")).toEqual(expected);
    expect(figureInPage("en")).toEqual(expected);
  });
});
