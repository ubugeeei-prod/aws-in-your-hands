import { describe, expect, it } from "vite-plus/test";

import { readTemplate, references, setting } from "../src/template.ts";

describe("what counts as a template", () => {
  it.each([
    ["an array", []],
    ["an object without Resources", {}],
    ["Resources as an array", { Resources: [] }],
    ["a resource without a Type", { Resources: { Table: { Properties: {} } } }],
    ["a resource that is an array", { Resources: { Table: [] } }],
    [
      "Properties as an array",
      { Resources: { Table: { Type: "AWS::DynamoDB::Table", Properties: [] } } },
    ],
  ])("refuses %s", (_name, input) => {
    expect(() => readTemplate(input)).toThrow();
  });

  it("skips no logical ID, whatever its name", () => {
    const input = JSON.parse(
      '{"Resources":{"constructor":{"Type":"AWS::S3::Bucket"},"__proto__":{"Type":"AWS::S3::Bucket"}}}',
    );
    expect(readTemplate(input).resources.map((resource) => resource.id)).toEqual([
      "constructor",
      "__proto__",
    ]);
  });
});

describe("references", () => {
  it("follows Ref, both spellings of Fn::GetAtt, and Fn::Sub", () => {
    expect(
      references({
        a: { Ref: "Api" },
        b: [{ "Fn::GetAtt": ["Handler", "Arn"] }, { "Fn::GetAtt": "Queue.Arn" }],
        c: { "Fn::Sub": "arn:${AWS::Partition}:s3:::${Bucket}/${Table.Arn}" },
        d: { "Fn::Sub": ["${Name}-${Topic}", { Name: { Ref: "Alias" } }] },
        e: { "Fn::Join": ["", ["x", { Ref: "Deep" }]] },
      }).toSorted(),
    ).toEqual(["Alias", "Api", "Bucket", "Deep", "Handler", "Name", "Queue", "Table", "Topic"]);
  });

  it("does not take a plain string for a reference", () => {
    expect(references({ Value: "Handler", Other: ["Ref", "Api"] })).toEqual([]);
  });
});

describe("a setting read from a template", () => {
  it("keeps a literal, an intrinsic and an absence apart", () => {
    expect(setting(false)).toEqual({ value: false });
    expect(setting(0)).toEqual({ value: 0 });
    expect(setting(undefined)).toBe("absent");
    expect(setting({ Ref: "RetentionDays" })).toBe("intrinsic");
    expect(setting({ "Fn::If": ["IsProd", true, false] })).toBe("intrinsic");
  });
});
