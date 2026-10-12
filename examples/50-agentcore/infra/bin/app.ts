import { App } from "aws-cdk-lib";

import {
  defaultProfileId,
  isVerifiedProfileId,
  verifiedProfiles,
} from "@aih/example-17-ai/infra/lib/models.ts";

import { AgentCoreStack } from "../lib/agentcore-stack.ts";

const app = new App();

// Choose another profile with `-c modelId=jp.anthropic.claude-haiku-4-5-20251001-v1:0`.
const requested = (app.node.tryGetContext("modelId") as string | undefined) ?? defaultProfileId;
if (!isVerifiedProfileId(requested)) {
  throw new Error(
    `"${requested}" is not a checked profile. Checked: ${Object.keys(verifiedProfiles).join(", ")}`,
  );
}

new AgentCoreStack(app, "AihAgentCore", {
  env: { region: "ap-northeast-1" },
  description:
    "AWS in Your Hands chapter 50: the notes agent on Amazon Bedrock AgentCore Runtime, with AgentCore Memory",
  profileId: requested,
});
