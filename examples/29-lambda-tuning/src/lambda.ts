import type { APIGatewayProxyEventV2, Context } from "aws-lambda";

import { handleApiGateway } from "@aih/example-04-http-api/src/http/api-gateway.ts";

import { composeTunedApp } from "./compose.ts";
import { budgetMs, withDeadline } from "./deadline.ts";
import { ANSWER_MARGIN_MS } from "./timeouts.ts";

// #region init
// Everything above the handler runs in the Init phase, once per execution environment.
const respond = handleApiGateway(composeTunedApp(process.env));
// #endregion init

// #region handler
// The Invoke phase. Lambda says how long is left; the handler stops a little before that.
export const handler = (event: APIGatewayProxyEventV2, context: Context) =>
  withDeadline(
    AbortSignal.timeout(budgetMs(context.getRemainingTimeInMillis(), ANSWER_MARGIN_MS)),
    () => respond(event),
  );
// #endregion handler
