// vp run ready:review
//   node examples/33-production-readiness/scripts/review.ts [area]
// Prints the review of chapter 33 as a list to go through. Reads nothing but this checkout.

import { AREAS, type Area, REVIEW } from "../src/review.ts";
import { RULES } from "../src/rules/rule.ts";

const wanted = process.argv[2];
if (wanted !== undefined && !AREAS.includes(wanted as Area)) {
  console.error(`unknown area "${wanted}". One of: ${AREAS.join(", ")}`);
  process.exit(64);
}

for (const area of AREAS.filter((name) => wanted === undefined || name === wanted)) {
  console.log(`\n${area}`);
  for (const item of REVIEW.filter((entry) => entry.area === area)) {
    console.log(`  [ ] ${item.must}`);
    console.log(`      without it: ${item.without}`);
    for (const rule of item.rules) {
      console.log(
        `      template:   ${rule} (ready:check; the work is in chapter ${RULES[rule].chapter})`,
      );
    }
    for (const task of item.tasks) {
      console.log(`      task:       vp run ${task}`);
    }
    console.log(`      ask:        ${item.ask}`);
    console.log(`      chapters:   ${item.chapters.join(", ")}`);
  }
}
const withRule = REVIEW.filter((item) => item.rules.length > 0).length;
console.log(
  `\n${REVIEW.length} items. The template check looks at part of ${withRule}; every one of them ends with a question for a person.`,
);
