import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { BILLED_WHILE_IDLE, renderLeft, stateRefs, stateSchema, summarize } from "../src/stacks.ts";
import { stateKeys, states } from "./support/fixtures.ts";

const summaries = () =>
  stateRefs(stateKeys).map((ref) => summarize(ref, v.parse(stateSchema, states[ref.key])));

describe("the keys in cdkd's state bucket", () => {
  it("name a stack only where there is a state.json", () => {
    expect(stateRefs(stateKeys).map((ref) => [ref.stack, ref.region])).toEqual([
      ["AihEc2", undefined],
      ["AihHello", "ap-northeast-1"],
      ["AihNetwork", "ap-northeast-1"],
    ]);
  });

  it("are an empty list when the prefix holds nothing", () => {
    expect(stateRefs(null)).toEqual([]);
  });

  it("are not read from a key outside the cdkd prefix", () => {
    expect(stateRefs(["other/AihHello/ap-northeast-1/state.json", "cdkd/state.json"])).toEqual([]);
  });
});

describe("what a state records", () => {
  it("flags an interface endpoint and a NAT gateway, and not a gateway endpoint", () => {
    const network = summaries().find((summary) => summary.stack === "AihNetwork");
    expect(network?.resources).toBe(5);
    expect(network?.idle.map((item) => item.logicalId)).toEqual([
      "Nat",
      "NatAddress",
      "SqsEndpoint",
    ]);
  });

  it("flags nothing in a stack that holds one bucket, and names the bucket", () => {
    const hello = summaries().find((summary) => summary.stack === "AihHello");
    expect(hello?.idle).toEqual([]);
    expect(hello?.buckets).toEqual(["aihhello-practicebucket-example"]);
    expect(renderLeft("cdkd-state-111111111111", summaries())).toContain(
      "  bucket: aihhello-practicebucket-example",
    );
  });

  it("takes the Region from the key when the body has none, and says so when neither has", () => {
    const lines = renderLeft("cdkd-state-111111111111", summaries());
    expect(lines).toContain("AihEc2 (region not recorded): 2 resources");
    expect(lines).toContain("AihNetwork (ap-northeast-1): 5 resources");
    expect(lines).toContain(
      "  billed while idle (chapter 23): AWS::EC2::Instance i-0123456789abcdef0",
    );
  });

  it("ends by saying it read a record, not the resources", () => {
    expect(renderLeft("cdkd-state-111111111111", summaries()).at(-1)).toMatch(/cdkd's record/);
    expect(renderLeft("cdkd-state-111111111111", [])).toEqual([
      "cdkd-state-111111111111 records no stack.",
    ]);
  });

  it("refuses a state without resources rather than reporting an empty stack", () => {
    expect(v.safeParse(stateSchema, { stackName: "AihHello" }).success).toBe(false);
  });
});

describe("the list of resource types billed while idle", () => {
  const examples = fileURLToPath(new URL("../..", import.meta.url));
  const sourcesOf = (chapter: string): string => {
    const directory = readdirSync(examples).find((name) => name.startsWith(`${chapter}-`));
    if (directory === undefined) {
      throw new Error(`no example for chapter ${chapter}`);
    }
    return readdirSync(join(examples, directory), { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".ts") && !/node_modules|cdk\.out|dist/.test(file))
      .map((file) => readFileSync(join(examples, directory, file), "utf8"))
      .join("\n");
  };

  it("names only types that the chapter it points at really uses", () => {
    const cache = new Map<string, string>();
    for (const [type, chapter] of Object.entries(BILLED_WHILE_IDLE)) {
      const sources = cache.get(chapter) ?? sourcesOf(chapter);
      cache.set(chapter, sources);
      expect(sources.includes(type), `${type} in chapter ${chapter}`).toBe(true);
    }
  });
});
