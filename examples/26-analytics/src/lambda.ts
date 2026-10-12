import { FirehoseClient } from "@aws-sdk/client-firehose";
import * as v from "valibot";

import { handleApiGateway } from "@aih/example-04-http-api/src/http/api-gateway.ts";

import { composeMeasuredApp } from "./compose.ts";
import { firehoseSink } from "./sink.ts";

// #region handler
const streamName = v.parse(
  v.pipe(v.string(), v.regex(/^[a-zA-Z0-9_.-]{1,64}$/)),
  process.env["DELIVERY_STREAM_NAME"],
);

// One client for the life of the execution environment, so later requests reuse its connection.
const app = composeMeasuredApp(process.env, firehoseSink(new FirehoseClient({}), streamName));

export const handler = handleApiGateway(app);
// #endregion handler
