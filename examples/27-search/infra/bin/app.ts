import { App } from "aws-cdk-lib";

import {
  defaultProfileId,
  isVerifiedProfileId,
  verifiedProfiles,
} from "@aih/example-17-ai/infra/lib/models.ts";

import { SearchStack } from "../lib/search-stack.ts";

const app = new App();

// The model that writes answers. Choose another with `-c modelId=...`, as in chapter 17.
const requested = (app.node.tryGetContext("modelId") as string | undefined) ?? defaultProfileId;
if (!isVerifiedProfileId(requested)) {
  throw new Error(
    `"${requested}" is not in examples/17-ai/infra/lib/models.ts. Checked profiles: ${Object.keys(verifiedProfiles).join(", ")}`,
  );
}

new SearchStack(app, "AihSearch", {
  env: { region: "ap-northeast-1" },
  description:
    "AWS in Your Hands chapter 27: notes found by words and by meaning (DynamoDB Streams, S3 Vectors, Amazon Bedrock)",
  profileId: requested,
});
