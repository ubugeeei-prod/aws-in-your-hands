// vp run tune:bundle
//   node scripts/bundle.ts [--runs 15] [--top 6]
//
// Bundles the function four ways, writes each to dist/<variant>/index.mjs, and prints the
// bytes, where they come from, and how long a fresh Node.js process takes to import each.
// Local only. The times are this machine's, not Lambda's.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import * as v from "valibot";

import { BUDGET, overBudget } from "../src/bundle/budget.ts";
import { buildVariant } from "../src/bundle/build.ts";
import { loadTimes, median } from "../src/bundle/measure.ts";
import { DEPLOYED, variantNames, variants } from "../src/bundle/variants.ts";

// A flag's value is text. "15" becomes 15; "many" becomes NaN, which v.number() refuses.
const count = v.pipe(v.string(), v.transform(Number), v.number(), v.integer(), v.minValue(1));
const argsSchema = v.object({
  runs: v.optional(v.pipe(count, v.maxValue(200)), "15"),
  top: v.optional(v.pipe(count, v.maxValue(50)), "6"),
});

const root = fileURLToPath(new URL("..", import.meta.url));
const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KiB`.padStart(12);

try {
  const { values } = parseArgs({ options: { runs: { type: "string" }, top: { type: "string" } } });
  const args = v.parse(argsSchema, values);

  console.log(
    `node ${process.version}, ${process.platform} ${process.arch}, ${args.runs} loads each\n`,
  );
  console.log(
    `${"variant".padEnd(20)}${"bytes".padStart(12)}${"gzip".padStart(12)}${"load, median".padStart(15)}${"fastest".padStart(11)}`,
  );

  const built = [];
  for (const name of variantNames) {
    const bundle = await buildVariant(name, root);
    // Under this package, so the variant that leaves the SDK out finds it in node_modules.
    const directory = join(root, "dist", name);
    mkdirSync(directory, { recursive: true });
    const file = join(directory, "index.mjs");
    writeFileSync(file, bundle.code);
    built.push({ ...bundle, file, times: [] as number[] });
  }
  // One load of each in turn, so whatever else the machine is doing falls on all of them alike.
  for (let run = 0; run < args.runs; run++) {
    for (const bundle of built) {
      bundle.times.push(...loadTimes(bundle.file, 1));
    }
  }
  const ms = (value: number) => `${value.toFixed(1)} ms`;
  for (const bundle of built) {
    console.log(
      `${bundle.name.padEnd(20)}${kb(bundle.bytes)}${kb(bundle.gzipBytes)}${ms(median(bundle.times)).padStart(15)}${ms(Math.min(...bundle.times)).padStart(11)}`,
    );
  }

  for (const bundle of built) {
    console.log(`\n${bundle.name}: ${variants[bundle.name].what}`);
    for (const owner of bundle.packages.slice(0, args.top)) {
      console.log(`  ${kb(owner.bytes)}  ${owner.name}`);
    }
    const rest = bundle.packages.slice(args.top);
    if (rest.length > 0) {
      const bytes = rest.reduce((sum, owner) => sum + owner.bytes, 0);
      console.log(`  ${kb(bytes)}  ${rest.length} more packages`);
    }
  }

  const deployed = built.find((bundle) => bundle.name === DEPLOYED);
  const problems = deployed === undefined ? [`${DEPLOYED} was not built`] : overBudget(deployed);
  console.log(
    `\nbudget for ${DEPLOYED}: ${BUDGET.bytes} bytes, ${BUDGET.gzipBytes} gzipped: ${
      problems.length === 0 ? "within" : problems.join("; ")
    }`,
  );
  process.exit(problems.length === 0 ? 0 : 1);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
