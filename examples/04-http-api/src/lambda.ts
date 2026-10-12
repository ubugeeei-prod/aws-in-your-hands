import { composeApp } from "./compose.ts";
import { handleApiGateway } from "./http/api-gateway.ts";

// #region handler
// Runs once per execution environment (a cold start), not once per request.
const app = composeApp(process.env);

export const handler = handleApiGateway(app);
// #endregion handler
