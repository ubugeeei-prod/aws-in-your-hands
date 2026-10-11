import { handle } from "hono/aws-lambda";
import { composeApp } from "./compose.ts";

// Once per execution environment. No notes live here: the table owns the state.
const app = composeApp(process.env);

export const handler = handle(app);
