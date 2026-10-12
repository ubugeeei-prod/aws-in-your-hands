// vp run ready:check            every synthesized stack of the book, as a report
// vp run ready:gate             this chapter's two stacks; the production one has to pass
//   node examples/33-production-readiness/scripts/check.ts [--gate <stack>]... [<cdk.out directory> ...]
// Local only: reads the *.template.json files that the synth tasks wrote, and nothing in AWS.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import * as v from "valibot";

import { exceptionSchema } from "@aih/example-21-security/src/iam-lint.ts";
import { jsonEntries } from "@aih/example-21-security/src/json-object.ts";

import { checkTemplate, fromIamExceptions, type Waiver, waiverSchema } from "../src/check.ts";
import { render, type StackResult, verdict } from "../src/report.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const readJson = (url: URL): unknown => JSON.parse(readFileSync(url, "utf8"));

// #region waivers
// Stack name to its waivers: this chapter's file, plus the exceptions chapter 21 already reasoned.
const waivers = new Map<string, Waiver[]>(
  v.parse(
    jsonEntries(v.array(waiverSchema)),
    readJson(new URL("../readiness/waivers.json", import.meta.url)),
  ),
);
for (const [stack, exceptions] of v.parse(
  jsonEntries(v.array(exceptionSchema)),
  readJson(
    new URL(import.meta.resolve("@aih/example-21-security/policies/iam-lint-exceptions.json")),
  ),
)) {
  waivers.set(stack, [...(waivers.get(stack) ?? []), ...fromIamExceptions(exceptions)]);
}
// #endregion waivers

const { values, positionals } = parseArgs({
  options: { gate: { type: "string", multiple: true, default: [] } },
  allowPositionals: true,
});
const gates = values.gate;

/** Every cdk.out the synth tasks write: one per example, and the book's own site. */
function allCdkOut(): string[] {
  const examples = join(repoRoot, "examples");
  return [
    ...readdirSync(examples)
      .toSorted()
      .map((name) => join(examples, name, "cdk.out")),
    join(repoRoot, "book", "infra", "cdk.out"),
  ].filter((directory) => existsSync(directory));
}

const directories = positionals.length > 0 ? positionals : allCdkOut();
const stacks: StackResult[] = [];
let unreadable = 0;
for (const directory of directories) {
  if (!existsSync(directory)) {
    console.error(`FAIL ${directory} does not exist. Run the synth task for that chapter first.`);
    unreadable += 1;
    continue;
  }
  for (const file of readdirSync(directory)
    .filter((name) => name.endsWith(".template.json"))
    .toSorted()) {
    const stack = basename(file, ".template.json");
    try {
      const result = checkTemplate(
        JSON.parse(readFileSync(join(directory, file), "utf8")),
        waivers.get(stack) ?? [],
      );
      stacks.push({ stack, gated: gates.includes(stack), result });
    } catch (error) {
      // A file this code cannot read is not a file it can vouch for.
      console.error(
        `FAIL ${relative(repoRoot, join(directory, file))}: ${error instanceof Error ? error.message : String(error)}`,
      );
      unreadable += 1;
    }
  }
}

if (stacks.length === 0) {
  console.error("FAIL no *.template.json was read. A check that read nothing has not passed.");
  process.exit(1);
}

console.log(render(stacks, gates).join("\n"));
const { failedGates } = verdict(stacks, gates);
if (gates.length === 0) {
  console.log("report only: no stack was asked to pass (--gate <stack>)");
} else {
  console.log(
    failedGates.length === 0
      ? `gate passed: ${gates.join(", ")}`
      : `gate FAILED: ${failedGates.join(", ")}`,
  );
}
process.exit(failedGates.length > 0 || unreadable > 0 ? 1 : 0);
