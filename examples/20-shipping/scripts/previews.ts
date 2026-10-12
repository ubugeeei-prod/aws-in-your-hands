// vp run ship:preview:list [--open 12,15] [--max-age-days 7]
//   node examples/20-shipping/scripts/previews.ts ...
//
// Lists preview stacks (AihShipApiPr<number>) and how old they are. Reads only:
// deleting one is `vp run ship:cfn:destroy -c stage=pr-<number>`.

import { parseArgs } from "node:util";

import { CloudFormationClient } from "@aws-sdk/client-cloudformation";
import * as v from "valibot";

import { preflight } from "@aih/tools/aws/preflight.ts";

import { listPreviews } from "../src/previews.ts";
import { listLiveStacks } from "../src/stack-info.ts";

const numbers = v.pipe(
  v.string(),
  v.regex(/^\d+(,\d+)*$/),
  v.transform((value) => value.split(",").map(Number)),
);
// The option is a string. It must read as a whole number; 0 is allowed.
const days = v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(0));

try {
  const { values } = parseArgs({
    options: { open: { type: "string" }, "max-age-days": { type: "string", default: "7" } },
  });
  const { target } = await preflight({ access: "observe", action: "list preview stacks" });
  const previews = listPreviews({
    stacks: await listLiveStacks(new CloudFormationClient({ region: target.region })),
    now: new Date(),
    maxAgeDays: v.parse(days, values["max-age-days"]),
    ...(values.open === undefined ? {} : { openPullRequests: v.parse(numbers, values.open) }),
  });

  if (previews.length === 0) {
    console.log(`No preview stacks in ${target.region}.`);
  }
  for (const preview of previews) {
    console.log(`${preview.verdict.padEnd(8)} ${preview.stack}  ${preview.ageDays} day(s) old`);
  }
  const forgotten = previews.filter((preview) => preview.verdict !== "recent");
  if (forgotten.length > 0) {
    console.log(
      `\n${forgotten.length} stack(s) to look at. To delete one: vp run ship:cfn:destroy -c stage=pr-<number>`,
    );
  }
  process.exit(forgotten.length > 0 ? 1 : 0);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(2);
}
