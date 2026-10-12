// vp run shield:origins          every synthesized stack of the book, as a report
// vp run shield:origins:gate     this chapter's stack, which has to be closed
//   node examples/46-shield/scripts/origins.ts [--gate <stack>]... [<cdk.out directory> ...]
// Local only: reads the *.template.json files the synth tasks wrote, and nothing in AWS.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { checkOrigins, type Finding, notClosed } from "../src/origins.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

const { values, positionals } = parseArgs({
  options: { gate: { type: "string", multiple: true, default: [] } },
  allowPositionals: true,
});
const gates = values.gate;

const examples = join(repoRoot, "examples");
const directories =
  positionals.length > 0
    ? positionals
    : readdirSync(examples)
        .toSorted()
        .map((name) => join(examples, name, "cdk.out"))
        .filter((directory) => existsSync(directory));

const seen = new Set<string>();
const failed: string[] = [];
let unreadable = 0;
let examined = 0;
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
    let findings: Finding[];
    try {
      findings = checkOrigins(JSON.parse(readFileSync(join(directory, file), "utf8")));
    } catch (error) {
      // A file this code cannot read is not a file it can vouch for.
      console.error(
        `FAIL ${relative(repoRoot, join(directory, file))}: ${error instanceof Error ? error.message : String(error)}`,
      );
      unreadable += 1;
      continue;
    }
    seen.add(stack);
    examined += findings.length;
    const open = notClosed(findings);
    if (findings.length === 0) {
      continue;
    }
    console.log(`${stack}  (${relative(repoRoot, directory)})`);
    for (const finding of findings) {
      console.log(`  ${finding.exposure.padEnd(11)}${finding.id}  ${finding.type}`);
      console.log(`             ${finding.reason}`);
    }
    if (gates.includes(stack) && open.length > 0) {
      failed.push(stack);
    }
  }
}

if (seen.size === 0) {
  console.error("FAIL no *.template.json was read. A check that read nothing has not passed.");
  process.exit(1);
}
const missing = gates.filter((stack) => !seen.has(stack));
for (const stack of missing) {
  console.error(`FAIL ${stack} was asked to pass, and no template of that name was read.`);
}

console.log(
  `\n${seen.size} templates, ${examined} function URLs, load balancers and APIs looked at.`,
);
if (gates.length === 0) {
  console.log("report only: no stack was asked to be closed (--gate <stack>)");
} else {
  console.log(
    failed.length === 0 && missing.length === 0
      ? `gate passed: ${gates.join(", ")}`
      : `gate FAILED: ${[...failed, ...missing].join(", ")}`,
  );
}
process.exit(failed.length > 0 || missing.length > 0 || unreadable > 0 ? 1 : 0);
