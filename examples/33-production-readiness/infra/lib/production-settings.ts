import { type IAspect, RemovalPolicy } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as logs from "aws-cdk-lib/aws-logs";
import type { IConstruct } from "constructs";

// How far back an investigation may need to look. A chosen value, not a recommendation.
export const LOG_RETENTION = logs.RetentionDays.THREE_MONTHS;

// #region aspect
/**
 * Visits every construct of a stack and turns the practice settings of the earlier chapters
 * into the ones real data wants. A table added to the stack later gets them too.
 */
export class ProductionSettings implements IAspect {
  visit(node: IConstruct): void {
    if (node instanceof dynamodb.CfnTable) {
      node.pointInTimeRecoverySpecification = { pointInTimeRecoveryEnabled: true };
      // Refuses DeleteTable. The items inside are what point-in-time recovery protects.
      node.deletionProtectionEnabled = true;
      // Sets DeletionPolicy and UpdateReplacePolicy: a destroy and a replacing update both leave it.
      node.applyRemovalPolicy(RemovalPolicy.RETAIN);
    }
    if (node instanceof logs.CfnLogGroup) {
      node.retentionInDays = LOG_RETENTION;
      // The logs of the last hour before a stack was destroyed are the ones somebody will ask for.
      node.applyRemovalPolicy(RemovalPolicy.RETAIN);
    }
  }
}
// #endregion aspect
