import { App, Aspects } from "aws-cdk-lib";
import * as v from "valibot";

import { ObservabilityStack } from "@aih/example-19-observability/infra/lib/observability-stack.ts";

import { ProductionSettings } from "../lib/production-settings.ts";

const REGION = "ap-northeast-1";

const contextSchema = v.object({
  allowedOrigin: v.optional(
    v.pipe(v.string(), v.url(), v.regex(/^https:\/\//, "Must be an https URL.")),
    "https://notes.example.com",
  ),
  // example.com is reserved and receives nothing. These stacks are synthesized to be read, not deployed.
  alarmEmail: v.optional(v.pipe(v.string(), v.email()), "oncall@example.com"),
});

const app = new App();
const context = v.parse(contextSchema, {
  allowedOrigin: app.node.tryGetContext("allowedOrigin"),
  alarmEmail: app.node.tryGetContext("alarmEmail"),
});

// #region twins
// The notes API of chapter 19, exactly as that chapter wrote it.
new ObservabilityStack(app, "AihReadyPractice", {
  env: { region: REGION },
  description: "AWS in Your Hands chapter 33: the notes API with its practice settings",
  allowedOrigin: context.allowedOrigin,
});

// The same stack class, with the settings this chapter's review asks for.
const production = new ObservabilityStack(app, "AihReadyProduction", {
  env: { region: REGION },
  description: "AWS in Your Hands chapter 33: the notes API with its production settings",
  ...context,
});
Aspects.of(production).add(new ProductionSettings());
// #endregion twins
