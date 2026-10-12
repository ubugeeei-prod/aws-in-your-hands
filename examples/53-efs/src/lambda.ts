import { handleApiGateway } from "@aih/example-04-http-api/src/http/api-gateway.ts";

import { composeApp } from "./compose.ts";

// #region handler
// Once per execution environment. Lambda has mounted the file system before this line runs.
const app = await composeApp(process.env);

export const handler = handleApiGateway(app);
// #endregion handler
