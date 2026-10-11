// vp run ec2:render            prints nothing; fails if deploy/ is out of date
// vp run ec2:render --write    rewrites deploy/ from the generators
//   node scripts/render.ts [--write]
//
// deploy/ holds the files exactly as the default settings produce them, so
// they can be read (and reviewed in a diff) without running anything.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { renderedFiles } from "../src/rendered.ts";

const write = process.argv.includes("--write");
let stale = 0;
for (const [name, content] of Object.entries(renderedFiles())) {
  const path = `deploy/${name}`;
  if (existsSync(path) && readFileSync(path, "utf8") === content) {
    continue;
  }
  if (write) {
    writeFileSync(path, content);
    console.log(`wrote ${path}`);
  } else {
    console.error(`${path} is out of date. Run: vp run ec2:render --write`);
    stale += 1;
  }
}
process.exit(stale === 0 ? 0 : 1);
