import { App } from "aws-cdk-lib";
import * as v from "valibot";

import { GrafanaStack } from "../lib/grafana-stack.ts";

const REGION = "ap-northeast-1";

// #region context
// Values given with `-c name=value`. They come from outside the code, so they are checked.
const contextSchema = v.object({
  // No default: choosing how people sign in is what turns the workspace, and its bill, on.
  authentication: v.optional(v.picklist(["AWS_SSO", "SAML"])),
  // Comma-separated IDs of managed prefix lists, at most five.
  prefixListIds: v.optional(
    v.pipe(
      v.string(),
      v.transform((text) => text.split(",")),
      v.array(v.pipe(v.string(), v.regex(/^pl-[0-9a-f]+$/))),
      v.maxLength(5),
    ),
  ),
  grafanaVersion: v.optional(v.pipe(v.string(), v.regex(/^\d+(\.\d+)?$/))),
});
// #endregion context

const app = new App();
const context = v.parse(contextSchema, {
  authentication: app.node.tryGetContext("authentication"),
  prefixListIds: app.node.tryGetContext("prefixListIds"),
  grafanaVersion: app.node.tryGetContext("grafanaVersion"),
});

new GrafanaStack(app, "AihGrafana", {
  env: { region: REGION },
  description:
    "AWS in Your Hands chapter 55: a role for Amazon Managed Grafana, and optionally a workspace",
  ...context,
});
