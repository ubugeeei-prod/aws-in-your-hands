import { ChimeSDKMeetingsClient } from "@aws-sdk/client-chime-sdk-meetings";
import * as v from "valibot";

import { handleApiGateway } from "@aih/example-04-http-api/src/http/api-gateway.ts";
import { identityFromApiGateway } from "@aih/example-06-auth/api/src/identity.ts";

import { createChimeMeetings } from "./chime-meetings.ts";
import { composeApp } from "./compose.ts";
import { parseMeetingsEnv } from "./env.ts";

// #region handler
const clientIdMessage = "USER_POOL_CLIENT_ID is required";
const clientId = v.parse(
  v.pipe(v.string(clientIdMessage), v.minLength(1, clientIdMessage)),
  process.env["USER_POOL_CLIENT_ID"],
);
const meetingsEnv = parseMeetingsEnv(process.env);
if (meetingsEnv.MEETINGS !== "chime") {
  throw new Error("A deployment talks to Chime. Set MEETINGS=chime and MEDIA_REGION.");
}

// Created once per execution environment. The client calls the API in this function's
// Region, signed with the execution role. fake-meetings.ts is not imported here.
const meetings = createChimeMeetings(new ChimeSDKMeetingsClient({}), meetingsEnv.MEDIA_REGION);

const app = composeApp(
  process.env,
  async ({ event }) => identityFromApiGateway(event, clientId),
  meetings,
);

export const handler = handleApiGateway(app);
// #endregion handler
