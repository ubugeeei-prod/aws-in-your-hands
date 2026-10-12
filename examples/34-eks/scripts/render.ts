// vp run eks:render            prints nothing; fails if k8s/ is out of date
// vp run eks:render --write    rewrites k8s/ from the generators
//   node scripts/render.ts [--write]
//
// k8s/ holds the manifests as the example values produce them. Touches no cluster.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

import { referenceProblems, schedulingProblems } from "../src/k8s/check.ts";
import { parseList } from "../src/k8s/schema.ts";
import { renderedFiles, toJson } from "../src/rendered.ts";

const write = process.argv.includes("--write");
const files = renderedFiles();

const everything = Object.values(files).flatMap((list) => parseList(list).items);
const problems = [...referenceProblems(everything), ...schedulingProblems(everything)];
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}

let stale = 0;
for (const [name, list] of Object.entries(files)) {
  const path = `k8s/${name}`;
  // Compared as data, so that the formatter may lay the file out as it likes.
  if (existsSync(path) && isDeepStrictEqual(JSON.parse(readFileSync(path, "utf8")), list)) {
    continue;
  }
  if (write) {
    writeFileSync(path, toJson(list));
    console.log(`wrote ${path}`);
  } else {
    console.error(`${path} is out of date. Run: vp run eks:render --write`);
    stale += 1;
  }
}
process.exit(stale === 0 ? 0 : 1);
