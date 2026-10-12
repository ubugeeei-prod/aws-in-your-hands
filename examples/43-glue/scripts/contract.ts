// vp run glue:contract    rewrites the generated block of glue/curate.py
//   node scripts/contract.ts
//
// The column list and the data quality rules are written once, in TypeScript.
// This copies them into the Spark script. Local only.

import { readFileSync, writeFileSync } from "node:fs";

import { withContract } from "../src/contract.ts";

const path = new URL("../glue/curate.py", import.meta.url);
const before = readFileSync(path, "utf8");
const after = withContract(before);
writeFileSync(path, after);
console.log(before === after ? "glue/curate.py was up to date" : "glue/curate.py was rewritten");
