import {
  type AthenaClient,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  StartQueryExecutionCommand,
  StopQueryExecutionCommand,
} from "@aws-sdk/client-athena";

import type { AthenaApi } from "./client.ts";

// #region adapter
/** The real service behind the four operations. Responses go back unchecked: runQuery validates them. */
export function athenaApi(client: AthenaClient): AthenaApi {
  return {
    start: (input) => client.send(new StartQueryExecutionCommand(input)),
    get: (QueryExecutionId) => client.send(new GetQueryExecutionCommand({ QueryExecutionId })),
    results: (QueryExecutionId, NextToken) =>
      client.send(new GetQueryResultsCommand({ QueryExecutionId, NextToken })),
    stop: (QueryExecutionId) => client.send(new StopQueryExecutionCommand({ QueryExecutionId })),
  };
}
// #endregion adapter
