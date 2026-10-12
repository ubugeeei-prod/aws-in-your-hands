import { App } from "aws-cdk-lib";
import * as v from "valibot";

import { MEDIA_REGIONS } from "../../api/src/env.ts";
import { CallsStack } from "../lib/calls-stack.ts";

const app = new App();

// Where the audio and video are hosted. `-c mediaRegion=us-west-2` moves the media, not the API.
const mediaRegion = v.parse(
  v.optional(v.picklist(MEDIA_REGIONS), "ap-northeast-1"),
  app.node.tryGetContext("mediaRegion"),
);

new CallsStack(app, "AihCalls", {
  env: { region: "ap-northeast-1" },
  description:
    "AWS in Your Hands chapter 51: the notes API with rooms backed by Amazon Chime SDK meetings",
  mediaRegion,
});
