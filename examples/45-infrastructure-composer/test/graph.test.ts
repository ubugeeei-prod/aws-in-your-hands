import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vite-plus/test";

import { references, subNames, templateGraph } from "../src/graph.ts";
import { parseTemplate } from "../src/template.ts";

const fixture = parseTemplate(
  readFileSync(join(import.meta.dirname, "../fixtures/notes-api.template.json"), "utf8"),
);

const template = (resources: Record<string, unknown>, rest: Record<string, unknown> = {}) =>
  parseTemplate(JSON.stringify({ Resources: resources, ...rest }));

describe("the forms that are followed", () => {
  test("Ref, at any depth", () => {
    expect(references({ a: [{ b: { Ref: "Table" } }] })).toEqual([{ name: "Table", via: "Ref" }]);
  });

  test("Fn::GetAtt as a pair and as one string", () => {
    expect(references({ "Fn::GetAtt": ["Role", "Arn"] })).toEqual([
      { name: "Role", via: "Fn::GetAtt" },
    ]);
    expect(references({ "Fn::GetAtt": "Role.Arn" })).toEqual([{ name: "Role", via: "Fn::GetAtt" }]);
  });

  test("a Ref that picks the attribute of an Fn::GetAtt", () => {
    expect(references({ "Fn::GetAtt": ["Role", { Ref: "Which" }] })).toEqual([
      { name: "Role", via: "Fn::GetAtt" },
      { name: "Which", via: "Ref" },
    ]);
  });

  test("Fn::Sub names, with attributes, without literals", () => {
    expect(subNames("${Api}/${Fn.Arn}/${!NotAName}/${AWS::Region}")).toEqual([
      "Api",
      "Fn",
      "AWS::Region",
    ]);
  });

  test("a local name of Fn::Sub hides a resource of the same name", () => {
    const found = references({ "Fn::Sub": ["${Table}/${Local}", { Local: { Ref: "Queue" } }] });
    expect(found).toEqual([
      { name: "Table", via: "Fn::Sub" },
      { name: "Queue", via: "Ref" },
    ]);
    expect(references({ "Fn::Sub": ["${Table}", { Table: "a literal" }] })).toEqual([]);
  });

  test("an object with Ref beside another key is not the function", () => {
    expect(references({ Ref: "Table", Other: 1 })).toEqual([]);
  });
});

describe("what is not followed", () => {
  test("a condition name, an import from another stack, a name in plain text", () => {
    const graph = templateGraph(
      template({
        Table: { Type: "AWS::DynamoDB::Table", Condition: "Table" },
        Fn: {
          Type: "AWS::Lambda::Function",
          Properties: {
            Description: "reads Table",
            Role: { "Fn::ImportValue": "Table" },
            Timeout: { "Fn::If": ["Table", 3, 10] },
          },
        },
      }),
    );
    expect(graph.edges).toEqual([]);
  });
});

describe("the graph of the fixture", () => {
  const graph = templateGraph(fixture);

  test("one node per resource, in template order", () => {
    expect(graph.nodes.map((node) => node.id)).toEqual(Object.keys(fixture.Resources));
    expect(graph.nodes.find((node) => node.id === "NotesFn")?.type).toBe("AWS::Lambda::Function");
  });

  test("every edge, with the form that made it", () => {
    expect(graph.edges.map((edge) => `${edge.from} ${edge.via} ${edge.to}`)).toEqual([
      "FnPolicy Ref FnRole",
      "FnPolicy Fn::GetAtt NotesTable",
      "NotesFn Fn::GetAtt FnRole",
      "NotesFn Ref NotesTable",
      "NotesFn DependsOn FnPolicy",
      "ApiIntegration Ref Api",
      "ApiIntegration Fn::GetAtt NotesFn",
      "ApiRoute Ref Api",
      "ApiRoute Fn::Sub ApiIntegration",
      "InvokePermission Ref NotesFn",
      "InvokePermission Fn::Sub Api",
    ]);
  });

  test("pseudo parameters are neither edges nor missing names", () => {
    expect(graph.unresolved).toEqual([]);
  });

  test("an output is not a node, and says what it reads", () => {
    expect(graph.outputs).toEqual([{ name: "ApiEndpoint", to: ["Api"] }]);
  });
});

describe("names", () => {
  test("a parameter is not a resource and not missing", () => {
    const graph = templateGraph(
      template(
        { Topic: { Type: "AWS::SNS::Topic", Properties: { TopicName: { Ref: "Name" } } } },
        { Parameters: { Name: { Type: "String" } } },
      ),
    );
    expect(graph.edges).toEqual([]);
    expect(graph.unresolved).toEqual([]);
  });

  test("a name the template does not define is reported, not dropped", () => {
    const graph = templateGraph(
      template({
        Fn: {
          Type: "AWS::Lambda::Function",
          DependsOn: "Gone",
          Properties: { Role: { "Fn::GetAtt": ["Rol", "Arn"] } },
        },
      }),
    );
    expect(graph.unresolved).toEqual([
      { from: "Fn", name: "Rol", via: "Fn::GetAtt" },
      { from: "Fn", name: "Gone", via: "DependsOn" },
    ]);
  });

  test("an omitted type takes its references with it, and is listed", () => {
    const graph = templateGraph(
      template({
        Bucket: { Type: "AWS::S3::Bucket" },
        CDKMetadata: { Type: "AWS::CDK::Metadata", Properties: { Analytics: "v2" } },
        Watcher: { Type: "AWS::SNS::Topic", DependsOn: ["CDKMetadata", "Bucket"] },
      }),
      { omitTypes: ["AWS::CDK::Metadata"] },
    );
    expect(graph.nodes.map((node) => node.id)).toEqual(["Bucket", "Watcher"]);
    expect(graph.omitted).toEqual([{ id: "CDKMetadata", type: "AWS::CDK::Metadata" }]);
    expect(graph.edges).toEqual([{ from: "Watcher", to: "Bucket", via: "DependsOn" }]);
    expect(graph.unresolved).toEqual([]);
  });

  test("the same reference twice is one edge", () => {
    const graph = templateGraph(
      template({
        Bucket: { Type: "AWS::S3::Bucket" },
        Policy: {
          Type: "AWS::S3::BucketPolicy",
          Properties: {
            A: { "Fn::GetAtt": ["Bucket", "Arn"] },
            B: { "Fn::GetAtt": ["Bucket", "Arn"] },
          },
        },
      }),
    );
    expect(graph.edges).toHaveLength(1);
  });
});

describe("what is refused at the door", () => {
  test("a resource without a Type", () => {
    expect(() => template({ Bucket: { Properties: {} } })).toThrow();
  });

  test("Fn::ForEach in Resources: the transform is not expanded here", () => {
    expect(() =>
      template({
        "Fn::ForEach::Buckets": ["Id", ["A", "B"], { "Bucket${Id}": { Type: "AWS::S3::Bucket" } }],
      }),
    ).toThrow();
  });

  test("a file that is not a template", () => {
    expect(() => parseTemplate(JSON.stringify({ version: "53.0.0" }))).toThrow();
  });
});
