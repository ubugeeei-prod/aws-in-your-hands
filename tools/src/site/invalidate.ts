// Recovery only. A normal publish needs no invalidation.
import { resolve } from "node:path";
import {
  CloudFrontClient,
  CreateInvalidationCommand,
  waitUntilInvalidationCompleted,
} from "@aws-sdk/client-cloudfront";
import { preflight } from "../aws/preflight.ts";
import { readStackOutputs, requireOutput } from "../infra/outputs.ts";

const [appDir, stack, ...paths] = process.argv.slice(2);
if (appDir === undefined || stack === undefined) {
  console.error("usage: invalidate.ts <appDir> <stack> [path ...]   (default path: /*)");
  process.exit(64);
}

try {
  const { target } = await preflight({ access: "mutate", action: "invalidate CloudFront cache", stack });
  const distributionId = requireOutput(await readStackOutputs(resolve(appDir), stack, target.region), "DistributionId");
  // CloudFront's control plane is global and served from us-east-1.
  const cloudfront = new CloudFrontClient({ region: "us-east-1" });
  // "/*" counts as one path toward the 1,000 free paths per month.
  const items = paths.length > 0 ? paths : ["/*"];
  const created = await cloudfront.send(
    new CreateInvalidationCommand({
      DistributionId: distributionId,
      InvalidationBatch: { CallerReference: `aih-${Date.now()}`, Paths: { Quantity: items.length, Items: items } },
    }),
  );
  const id = created.Invalidation?.Id;
  if (id === undefined) {
    throw new Error("CloudFront returned no invalidation ID");
  }
  console.log(`invalidation ${id} created for ${items.join(" ")}; waiting for it to complete`);
  await waitUntilInvalidationCompleted(
    { client: cloudfront, maxWaitTime: 900 },
    { DistributionId: distributionId, Id: id },
  );
  console.log("invalidation completed");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
