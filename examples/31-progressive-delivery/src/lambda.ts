import { handleApiGateway } from "@aih/example-04-http-api/src/http/api-gateway.ts";

import { composeRollout } from "./compose.ts";

// #region handler
const app = composeRollout(process.env);

export const handler = handleApiGateway(app);
// #endregion handler
