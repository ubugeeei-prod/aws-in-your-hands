import {
  type CloudFormationClient,
  DescribeStackDriftDetectionStatusCommand,
  DescribeStackResourceDriftsCommand,
  DetectStackDriftCommand,
  ListStackResourcesCommand,
} from "@aws-sdk/client-cloudformation";

import type { CfnDriftApi } from "@aih/tools/drift/cloudformation.ts";

// #region adapter
/** The only place the drift check touches the SDK. Responses go back unparsed: the caller validates them. */
export function cfnDriftApi(client: Pick<CloudFormationClient, "send">): CfnDriftApi {
  return {
    detectStackDrift: (stack) => client.send(new DetectStackDriftCommand({ StackName: stack })),
    describeDetectionStatus: (detectionId) =>
      client.send(
        new DescribeStackDriftDetectionStatusCommand({ StackDriftDetectionId: detectionId }),
      ),
    describeResourceDrifts: (stack, nextToken) =>
      // No status filter: IN_SYNC results are what "checked and matching" is counted from.
      client.send(
        new DescribeStackResourceDriftsCommand({ StackName: stack, NextToken: nextToken }),
      ),
    listStackResources: (stack, nextToken) =>
      client.send(new ListStackResourcesCommand({ StackName: stack, NextToken: nextToken })),
  };
}
// #endregion adapter
