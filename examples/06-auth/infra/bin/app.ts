import { App } from "aws-cdk-lib";
import { NotesAppStack } from "../lib/notes-app-stack.ts";

const app = new App();

new NotesAppStack(app, "AihNotesApp", {
  env: { region: "ap-northeast-1" },
  description: "AWS in Your Hands chapter 06: notes SPA and API with Cognito sign-in",
});
