import { App } from "aws-cdk-lib";
import { NotesStack } from "../lib/notes-stack.ts";

const app = new App();

new NotesStack(app, "AihNotes", {
  env: { region: "ap-northeast-1" },
  description: "AWS in Your Hands chapter 05: notes API with a DynamoDB table",
  allowedOrigin: (app.node.tryGetContext("allowedOrigin") as string | undefined) ?? "http://localhost:5173",
});
