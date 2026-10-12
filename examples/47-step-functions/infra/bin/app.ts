import { App } from "aws-cdk-lib";

import { StepFunctionsStack } from "../lib/step-functions-stack.ts";

const app = new App();

new StepFunctionsStack(app, "AihStepFunctions", {
  env: { region: "ap-northeast-1" },
  description:
    "AWS in Your Hands chapter 47: a saga as a Standard workflow, a read as an Express one",
});
