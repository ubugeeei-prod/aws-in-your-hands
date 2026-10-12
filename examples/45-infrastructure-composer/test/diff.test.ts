// The invariant of the chapter: one source of truth per stack. These tests break it the way a
// template saved from a visual editor would, and check that the difference is seen.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vite-plus/test";

import { diffGraphs } from "../src/diff.ts";
import { templateGraph } from "../src/graph.ts";
import { renderDiff } from "../src/render.ts";
import { parseTemplate } from "../src/template.ts";

const text = readFileSync(join(import.meta.dirname, "../fixtures/notes-api.template.json"), "utf8");
const synthesized = templateGraph(parseTemplate(text));

type RawResource = { Type: string; DependsOn?: string[]; Properties: Record<string, unknown> };
type Raw = { Resources: Record<string, RawResource> };

function resource(raw: Raw, id: string): RawResource {
  const found = raw.Resources[id];
  if (found === undefined) {
    throw new Error(`the fixture has no ${id}`);
  }
  return found;
}

/** The fixture after someone changed it by hand, away from the code that generates it. */
function edited(change: (raw: Raw) => void) {
  const raw: Raw = JSON.parse(text);
  change(raw);
  return templateGraph(parseTemplate(JSON.stringify(raw)));
}

describe("a second copy of the template", () => {
  test("an untouched copy is the same graph", () => {
    expect(
      diffGraphs(
        synthesized,
        edited(() => {}),
      ).same,
    ).toBe(true);
  });

  test("a resource drawn on the canvas", () => {
    const diff = diffGraphs(
      synthesized,
      edited((raw) => {
        raw.Resources["Alarm"] = {
          Type: "AWS::CloudWatch::Alarm",
          Properties: { Dimensions: [{ Name: "FunctionName", Value: { Ref: "NotesFn" } }] },
        };
      }),
    );
    expect(diff.same).toBe(false);
    expect(diff.addedNodes).toEqual(["Alarm"]);
    expect(diff.addedEdges).toEqual([{ from: "Alarm", to: "NotesFn", via: "Ref" }]);
  });

  test("a resource deleted from the canvas takes its connections with it", () => {
    const diff = diffGraphs(
      synthesized,
      edited((raw) => {
        delete raw.Resources["InvokePermission"];
      }),
    );
    expect(diff.removedNodes).toEqual(["InvokePermission"]);
    expect(diff.removedEdges.map((edge) => edge.to)).toEqual(["NotesFn", "Api"]);
  });

  test("a connection redrawn: same resources, another reference", () => {
    const diff = diffGraphs(
      synthesized,
      edited((raw) => {
        resource(raw, "NotesFn").Properties["Environment"] = { Variables: { TABLE_NAME: "notes" } };
      }),
    );
    expect(diff.addedNodes).toEqual([]);
    expect(diff.removedEdges).toEqual([{ from: "NotesFn", to: "NotesTable", via: "Ref" }]);
    expect(renderDiff(diff)).toBe("- connection  NotesFn -> NotesTable  [Ref]");
  });

  test("an ordering removed is seen although no value changed", () => {
    const diff = diffGraphs(
      synthesized,
      edited((raw) => {
        delete resource(raw, "NotesFn").DependsOn;
      }),
    );
    expect(diff.removedEdges).toEqual([{ from: "NotesFn", to: "FnPolicy", via: "DependsOn" }]);
  });

  test("a logical ID kept, the type changed", () => {
    const diff = diffGraphs(
      synthesized,
      edited((raw) => {
        resource(raw, "LeftoverQueue").Type = "AWS::SNS::Topic";
      }),
    );
    expect(diff.retyped).toEqual([
      { id: "LeftoverQueue", from: "AWS::SQS::Queue", to: "AWS::SNS::Topic" },
    ]);
  });

  test("a changed property value is NOT seen: this compares shapes, not templates", () => {
    const diff = diffGraphs(
      synthesized,
      edited((raw) => {
        resource(raw, "NotesTable").Properties["BillingMode"] = "PROVISIONED";
      }),
    );
    expect(diff.same).toBe(true);
  });
});
