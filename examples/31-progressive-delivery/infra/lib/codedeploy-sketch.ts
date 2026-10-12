import type * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as codedeploy from "aws-cdk-lib/aws-codedeploy";
import type * as lambda from "aws-cdk-lib/aws-lambda";
import type { Construct } from "constructs";

// Not part of the deployed app. The pinned cdkd does not read the UpdatePolicy this adds,
// so this is here to be synthesized in a test and read, for the day the stack moves to CloudFormation.

// #region codedeploy
/** Hands the alias to CodeDeploy: CloudFormation then asks CodeDeploy to move it, 10% first. */
export function shiftWithCodeDeploy(
  scope: Construct,
  alias: lambda.Alias,
  alarms: cloudwatch.IAlarm[],
): codedeploy.LambdaDeploymentGroup {
  return new codedeploy.LambdaDeploymentGroup(scope, "LiveDeployment", {
    alias,
    deploymentConfig: codedeploy.LambdaDeploymentConfig.CANARY_10PERCENT_5MINUTES,
    alarms,
    // The default already: a failed deployment, or one of the alarms, sends the alias back.
    autoRollback: { failedDeployment: true, deploymentInAlarm: true },
  });
}
// #endregion codedeploy
