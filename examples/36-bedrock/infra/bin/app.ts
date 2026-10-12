import { App } from "aws-cdk-lib";

import {
  defaultProfileId,
  isVerifiedProfileId,
  verifiedProfiles,
} from "@aih/example-17-ai/infra/lib/models.ts";

import { BedrockStack } from "../lib/bedrock-stack.ts";
import { isPromptAttackFilter } from "../lib/guardrail.ts";

const app = new App();

// Choose another profile with `-c modelId=jp.anthropic.claude-haiku-4-5-20251001-v1:0`.
const requested = (app.node.tryGetContext("modelId") as string | undefined) ?? defaultProfileId;
if (!isVerifiedProfileId(requested)) {
  throw new Error(
    `"${requested}" is not a checked profile. Checked: ${Object.keys(verifiedProfiles).join(", ")}`,
  );
}

// `-c promptAttackFilter=standard` turns the filter on. Read what that does to where text goes first.
const filter = (app.node.tryGetContext("promptAttackFilter") as string | undefined) ?? "off";
if (!isPromptAttackFilter(filter)) {
  throw new Error(`promptAttackFilter must be "off" or "standard", not "${filter}"`);
}

new BedrockStack(app, "AihBedrock", {
  env: { region: "ap-northeast-1" },
  description:
    "AWS in Your Hands chapter 36: a notes assistant with tools, a guardrail and a per-user budget (Lambda function URL + Amazon Bedrock)",
  profileId: requested,
  promptAttackFilter: filter,
});
