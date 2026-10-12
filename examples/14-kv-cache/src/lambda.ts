import { handleApiGateway } from "@aih/example-04-http-api/src/http/api-gateway.ts";

import { sourceAddressOf } from "./caller.ts";
import { composeApp } from "./compose.ts";

// #region handler
// Once per execution environment. With KV_STORE=memory the counters and the
// cache live right here, and each environment has its own.
const app = composeApp(process.env);

export const handler = handleApiGateway((request, { event }) =>
  app(request, { sourceAddress: sourceAddressOf(event) }),
);
// #endregion handler
