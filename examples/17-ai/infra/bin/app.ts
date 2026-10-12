import { App } from "aws-cdk-lib";

import { AiStack } from "../lib/ai-stack.ts";
import { defaultProfileId, isVerifiedProfileId, verifiedProfiles } from "../lib/models.ts";

const app = new App();

// Choose another profile with `-c modelId=global.amazon.nova-2-lite-v1:0`.
const requested = (app.node.tryGetContext("modelId") as string | undefined) ?? defaultProfileId;
if (!isVerifiedProfileId(requested)) {
  // An unknown ID would need IAM resources nobody has checked. Add it to models.ts first.
  throw new Error(
    `"${requested}" is not in infra/lib/models.ts. Checked profiles: ${Object.keys(verifiedProfiles).join(", ")}`,
  );
}

new AiStack(app, "AihAi", {
  env: { region: "ap-northeast-1" },
  description:
    "AWS in Your Hands chapter 17: streaming note summaries (Lambda function URL + Amazon Bedrock)",
  profileId: requested,
});
