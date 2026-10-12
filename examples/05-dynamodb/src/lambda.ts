import { handleApiGateway } from "@aih/example-04-http-api/src/http/api-gateway.ts";

import { composeApp } from "./compose.ts";

// Once per execution environment. No notes live here: the table owns the state.
const app = composeApp(process.env);

export const handler = handleApiGateway(app);
