import { App } from "aws-cdk-lib";

import { EventsStack } from "../lib/events-stack.ts";

const app = new App();

new EventsStack(app, "AihEvents", {
  env: { region: "ap-northeast-1" },
  description:
    "AWS in Your Hands chapter 25: the notes table's changes as events, with EventBridge, Pipes, and SNS",
});
