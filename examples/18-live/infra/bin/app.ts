import { App } from "aws-cdk-lib";
import { z } from "zod";
import { LiveStack } from "../lib/live-stack.ts";

const app = new App();

// `-c streamKey=off` deploys the channel without a stream key.
const streamKey = z.enum(["on", "off"]).default("on").parse(app.node.tryGetContext("streamKey"));

new LiveStack(app, "AihLive", {
  env: { region: "ap-northeast-1" },
  description: "AWS in Your Hands chapter 18: an IVS low-latency channel and its events",
  streamKey: streamKey === "on",
});
