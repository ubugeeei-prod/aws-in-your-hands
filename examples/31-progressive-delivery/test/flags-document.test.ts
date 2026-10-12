import { readFileSync } from "node:fs";

import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import {
  checkDocument,
  type FlagDocument,
  flagDocumentSchema,
  parseDocument,
  toRetrieved,
} from "../src/flags/document.ts";
import { flagsSchema, knownFlags } from "../src/flags/evaluate.ts";

const file = readFileSync(new URL("../flags/flags.json", import.meta.url), "utf8");
const committed = (): FlagDocument => structuredClone(parseDocument(file, knownFlags));
const problems = (change: (document: FlagDocument) => void) => {
  const document = committed();
  change(document);
  return checkDocument(document, knownFlags);
};

describe("the committed flag file", () => {
  it("is valid, and defines exactly the flags the code reads", () => {
    expect(Object.keys(committed().flags).toSorted()).toEqual(knownFlags.toSorted());
  });

  it("ships with everything off", () => {
    expect(toRetrieved(committed())).toEqual({
      readOnly: { enabled: false },
      noteStats: { enabled: false },
    });
  });

  it("becomes something the application's own schema accepts", () => {
    expect(v.safeParse(flagsSchema, toRetrieved(committed())).success).toBe(true);
  });
});

describe("toRetrieved", () => {
  it("drops the attributes of a flag that is off, and keeps them when it is on", () => {
    const document = committed();
    document.values["noteStats"] = { enabled: true, rolloutPercent: 25 };
    expect(toRetrieved(document)["noteStats"]).toEqual({ enabled: true, rolloutPercent: 25 });
    document.values["noteStats"] = { enabled: false, rolloutPercent: 25 };
    expect(toRetrieved(document)["noteStats"]).toEqual({ enabled: false });
  });
});

describe("checkDocument", () => {
  it("refuses a value outside its declared range", () => {
    expect(
      problems((d) => void (d.values["noteStats"] = { enabled: true, rolloutPercent: 101 })),
    ).toEqual(["noteStats.rolloutPercent: 101 is above the maximum 100"]);
    expect(
      problems((d) => void (d.values["noteStats"] = { enabled: true, rolloutPercent: -1 })),
    ).toEqual(["noteStats.rolloutPercent: -1 is below the minimum 0"]);
  });

  it("refuses a value of the wrong type, a missing required one, and an undeclared one", () => {
    expect(
      problems((d) => void (d.values["noteStats"] = { enabled: true, rolloutPercent: "10" })),
    ).toEqual(['noteStats.rolloutPercent: must be a number, got "10"']);
    expect(problems((d) => void (d.values["noteStats"] = { enabled: true }))).toEqual([
      "noteStats.rolloutPercent: required, and missing",
    ]);
    expect(problems((d) => void (d.values["readOnly"] = { enabled: true, until: "noon" }))).toEqual(
      ["readOnly.until: has a value and no definition"],
    );
  });

  it("refuses a flag the code does not read, and one the code reads that is gone", () => {
    expect(
      problems((d) => {
        d.flags["darkMode"] = { attributes: {} };
        d.values["darkMode"] = { enabled: true };
      }),
    ).toEqual(["darkMode: defined, and no code reads it"]);
    expect(
      problems((d) => {
        delete d.flags["readOnly"];
        delete d.values["readOnly"];
      }),
    ).toEqual(["readOnly: the code reads this flag, and the file does not define it"]);
  });

  it("refuses a flag without a value and a value without a flag", () => {
    expect(problems((d) => void delete d.values["readOnly"])).toEqual(["readOnly: has no value"]);
    expect(problems((d) => void (d.values["ghost"] = { enabled: true }))).toEqual([
      "ghost: has a value and no definition",
    ]);
  });
});

describe("the document schema", () => {
  const parse = (change: (json: Record<string, unknown>) => void) => {
    const json = JSON.parse(file) as Record<string, unknown>;
    change(json);
    return v.safeParse(flagDocumentSchema, json).success;
  };

  it("refuses keys it does not know, another version, and an enabled that is not a boolean", () => {
    expect(parse(() => {})).toBe(true);
    expect(parse((json) => void (json["extra"] = 1))).toBe(false);
    expect(parse((json) => void (json["version"] = "2"))).toBe(false);
    expect(parse((json) => void (json["values"] = { readOnly: { enabled: "false" } }))).toBe(false);
  });

  it("refuses an array where a map belongs", () => {
    expect(parse((json) => void (json["flags"] = []))).toBe(false);
    expect(parse((json) => void (json["values"] = []))).toBe(false);
  });

  it("refuses a flag named constructor instead of dropping it silently", () => {
    const text = file.replace(
      '"readOnly": { "enabled": false }',
      '"constructor": { "enabled": true }',
    );
    expect(text).not.toBe(file);
    expect(v.safeParse(flagDocumentSchema, JSON.parse(text)).success).toBe(false);
  });

  it("refuses a key AppConfig's own pattern would refuse", () => {
    expect(parse((json) => void (json["values"] = { ReadOnly: { enabled: false } }))).toBe(false);
  });
});

describe("parseDocument", () => {
  it("names every problem at once", () => {
    const text = file.replace('"rolloutPercent": 0 }', '"rolloutPercent": 500, "extra": true }');
    expect(() => parseDocument(text, knownFlags)).toThrow(
      /noteStats\.extra: has a value and no definition\n\s+noteStats\.rolloutPercent: 500 is above/,
    );
    expect(() => parseDocument("{", knownFlags)).toThrow("not JSON");
  });
});
