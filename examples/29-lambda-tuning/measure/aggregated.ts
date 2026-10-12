// What not to deploy. `DynamoDB` and `DynamoDBDocument` carry a method for every operation,
// so a bundler cannot drop the ones this app never calls. Built only by `vp run tune:bundle`
// and the tests, to show the difference in bytes.

import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

import { handleApiGateway } from "@aih/example-04-http-api/src/http/api-gateway.ts";

import { composeTunedApp } from "../src/compose.ts";

const respond = handleApiGateway(
  composeTunedApp(process.env, (config) => DynamoDBDocument.from(new DynamoDB(config))),
);

export const handler = respond;
