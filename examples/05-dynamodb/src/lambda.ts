import { handle } from "hono/aws-lambda";
import { composeApp } from "./compose.ts";

// The SDK client is created here, once per execution environment, and reused
// by every invocation that environment serves. Unlike the notes Map of
// chapter 04, nothing a later request needs lives in this process: the table
// is the owner of the state, and any execution environment reads the same one.
const app = composeApp(process.env);

export const handler = handle(app);
