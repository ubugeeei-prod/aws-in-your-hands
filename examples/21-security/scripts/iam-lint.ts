// vp run sec:iam:lint [<cdk.out directory> ...]
//   node examples/21-security/scripts/iam-lint.ts [dir ...]
// Lints the IAM policies in synthesized templates. Local only: it reads the
// *.template.json files that `vp run infra:synth` wrote, and nothing in AWS.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { exceptionSchema, lintTemplate } from "../src/iam-lint.ts";

const exceptions = z
  .record(z.string(), z.array(exceptionSchema))
  .parse(JSON.parse(readFileSync(new URL("../policies/iam-lint-exceptions.json", import.meta.url), "utf8")));

const directories = process.argv.slice(2);
if (directories.length === 0) {
  directories.push(fileURLToPath(new URL("../cdk.out", import.meta.url)));
}

let templates = 0;
let problems = 0;
for (const directory of directories) {
  if (!existsSync(directory)) {
    console.error(`FAIL ${directory} does not exist. Run the synth task for that chapter first.`);
    problems += 1;
    continue;
  }
  for (const file of readdirSync(directory)
    .filter((name) => name.endsWith(".template.json"))
    .toSorted()) {
    templates += 1;
    const stack = basename(file, ".template.json");
    const allowed = exceptions[stack] ?? [];
    const { findings, unusedExceptions } = lintTemplate(
      JSON.parse(readFileSync(join(directory, file), "utf8")),
      allowed,
    );
    const used = allowed.length - unusedExceptions.length;
    console.log(
      `${findings.length + unusedExceptions.length === 0 ? "ok  " : "FAIL"} ${stack}` +
        (used > 0 ? ` (${used} reasoned exceptions)` : ""),
    );
    for (const finding of findings) {
      console.log(`       ${finding.resource}: ${finding.kind}: ${finding.detail}`);
    }
    for (const entry of unusedExceptions) {
      console.log(`       exception for ${entry.action} matches nothing; delete it`);
    }
    problems += findings.length + unusedExceptions.length;
  }
}

if (templates === 0) {
  console.error("FAIL no *.template.json found. A lint that read nothing has not passed.");
  process.exit(1);
}
console.log(`${templates} templates, ${problems} problems`);
process.exit(problems === 0 ? 0 : 1);
