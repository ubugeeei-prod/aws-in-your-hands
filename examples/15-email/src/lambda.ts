import { handle } from "hono/aws-lambda";
import { composeApp } from "./compose.ts";

// Once per execution environment. The table owns every record; nothing is kept here.
const { app } = composeApp(process.env);

export const handler = handle(app);
