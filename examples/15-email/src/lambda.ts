import { handleApiGateway } from "@aih/example-04-http-api/src/http/api-gateway.ts";

import { composeApp } from "./compose.ts";

// Once per execution environment. The table owns every record; nothing is kept here.
const { app } = composeApp(process.env);

export const handler = handleApiGateway(app);
