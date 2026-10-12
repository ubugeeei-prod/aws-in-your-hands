// vp run ecr:scan:gate --digest sha256:... [--fail-on HIGH]
//   node scripts/scan-gate.ts --digest sha256:... [--fail-on HIGH] [--repository-name name]
//
// Waits for the basic scan of one image and exits non-zero unless the image
// may be deployed. Reads AWS; changes nothing. In CI, pass --repository-name:
// the push role cannot read cdkd's state.

import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

import * as v from "valibot";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { ECR_STACK } from "../src/config.ts";
import { digestSchema } from "../src/reference.ts";
import { decide, scanReportSchema, SEVERITIES } from "../src/scan.ts";

const { values } = parseArgs({
  options: {
    digest: { type: "string" },
    "fail-on": { type: "string", default: "HIGH" },
    "repository-name": { type: "string" },
  },
});

try {
  const digest = v.parse(digestSchema, values.digest);
  const failOn = v.parse(v.picklist(SEVERITIES), values["fail-on"]);
  const { target } = await preflight({
    access: "observe",
    action: `read the scan result of ${digest}`,
    stack: ECR_STACK,
  });
  const name =
    values["repository-name"] ??
    requireOutput(
      await readStackOutputs(process.cwd(), ECR_STACK, target.region),
      "RepositoryName",
    );
  const image = [
    "--repository-name",
    name,
    "--image-id",
    `imageDigest=${digest}`,
    "--region",
    target.region,
  ];

  // Polls every 5 seconds, up to 60 times; fails if the scan fails.
  const waited = spawnSync("aws", ["ecr", "wait", "image-scan-complete", ...image], {
    stdio: "inherit",
  });
  if (waited.status !== 0) {
    throw new Error("the scan did not complete");
  }
  const described = spawnSync(
    "aws",
    // One raw page: the counts are on every page, and the findings themselves are not needed.
    [
      "ecr",
      "describe-image-scan-findings",
      ...image,
      "--no-paginate",
      "--max-results",
      "1",
      "--output",
      "json",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  if (described.status !== 0) {
    throw new Error(`aws ecr describe-image-scan-findings exited with ${described.status}`);
  }
  const verdict = decide(v.parse(scanReportSchema, JSON.parse(described.stdout)), digest, failOn);
  if (!verdict.deploy) {
    throw new Error(`do not deploy ${digest}: ${verdict.reason}`);
  }
  console.log(`${digest}: nothing at ${failOn} or above`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
