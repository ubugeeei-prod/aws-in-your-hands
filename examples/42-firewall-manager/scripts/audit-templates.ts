// vp run fwm:audit:templates
//   node examples/42-firewall-manager/scripts/audit-templates.ts [<cdk.out directory> ...]
// Local and read-only: applies this chapter's audit rule to the security groups in the
// templates that the book's synth tasks wrote. It reads no account and changes no file.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { AUDIT_ALLOWED } from "../src/policies.ts";
import { auditGroup, ingressByGroup } from "../src/security-group-audit.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function allCdkOut(): string[] {
  const examples = join(repoRoot, "examples");
  return readdirSync(examples)
    .toSorted()
    .map((name) => join(examples, name, "cdk.out"))
    .filter((directory) => existsSync(directory));
}

const directories = process.argv.length > 2 ? process.argv.slice(2) : allCdkOut();
const counts = { compliant: 0, noncompliant: 0, incomplete: 0 };
let templates = 0;

for (const directory of directories) {
  if (!existsSync(directory)) {
    console.error(`FAIL ${directory} does not exist. Run the synth task for that chapter first.`);
    process.exitCode = 1;
    continue;
  }
  for (const file of readdirSync(directory)
    .filter((name) => name.endsWith(".template.json"))
    .toSorted()) {
    templates += 1;
    const groups = ingressByGroup(JSON.parse(readFileSync(join(directory, file), "utf8")));
    for (const [id, rules] of groups) {
      const audit = auditGroup(id, rules, AUDIT_ALLOWED);
      counts[audit.status] += 1;
      console.log(
        `${audit.status.padEnd(12)} ${basename(file, ".template.json")} ${id} (${relative(repoRoot, directory)})`,
      );
      for (const { verdict } of audit.rules) {
        if (verdict.status !== "compliant") {
          console.log(`             ${verdict.status}: ${verdict.reason}`);
        }
      }
    }
  }
}

console.log(
  `\n${templates} templates, ${counts.compliant} groups compliant, ${counts.noncompliant} noncompliant, ` +
    `${counts.incomplete} with a rule this model does not evaluate.`,
);
// A report, not a gate: the practice stacks are not in any organization this policy covers.
