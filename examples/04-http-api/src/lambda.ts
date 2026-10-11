import { handle } from "hono/aws-lambda";
import { composeApp } from "./compose.ts";

// #region handler
// Runs once per execution environment (a "cold start"), not once per request.
// A bad environment variable therefore fails here, on the first invocation.
const app = composeApp(process.env);

// API Gateway HTTP API invokes this with a payload format 2.0 event and
// expects a result object back; the adapter converts both to and from the
// Request and Response that the Hono app works with.
export const handler = handle(app);
// #endregion handler
