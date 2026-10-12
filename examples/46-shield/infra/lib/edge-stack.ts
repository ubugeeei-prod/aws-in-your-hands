import { CfnOutput, Duration, Stack, type StackProps, Token } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as shield from "aws-cdk-lib/aws-shield";
import * as sns from "aws-cdk-lib/aws-sns";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import type { Construct } from "constructs";

import { RATE_RULE } from "../../src/defences.ts";
import { EDGE_REGION } from "./config.ts";

export type EdgeStackProps = StackProps & {
  alarmTopicArn?: string | undefined;
  /** Set only for an account subscribed to Shield Advanced. Adds the protection and its alarm. */
  protectedDistributionArn?: string | undefined;
};

const WEB_ACL_METRIC = "AihShieldWebAcl";
const RATE_RULE_METRIC = "RateLimitPerIp";

/** Everything of this chapter that has to live in us-east-1. Billed by the month once deployed. */
export class EdgeStack extends Stack {
  constructor(scope: Construct, id: string, props: EdgeStackProps) {
    super(scope, id, props);
    if (Token.isUnresolved(this.region) || this.region !== EDGE_REGION) {
      throw new Error(`This stack must be created in ${EDGE_REGION}, not ${this.region}.`);
    }

    const visibility = (metricName: string) => ({
      cloudWatchMetricsEnabled: true,
      sampledRequestsEnabled: true,
      metricName,
    });

    // #region web-acl
    const webAcl = new wafv2.CfnWebACL(this, "WebAcl", {
      scope: "CLOUDFRONT",
      description: "AWS in Your Hands chapter 46: one rate-based rule in front of the notes API",
      defaultAction: { allow: {} },
      visibilityConfig: visibility(WEB_ACL_METRIC),
      rules: [
        {
          name: RATE_RULE_METRIC,
          priority: 0,
          statement: {
            rateBasedStatement: {
              limit: RATE_RULE.limit,
              evaluationWindowSec: RATE_RULE.windowSeconds,
              aggregateKeyType: "IP",
            },
          },
          // Block, not count: Shield Advanced's cost protection asks for exactly this.
          action: { block: {} },
          visibilityConfig: visibility(RATE_RULE_METRIC),
        },
      ],
    });
    // #endregion web-acl

    const topic =
      props.alarmTopicArn === undefined
        ? undefined
        : sns.Topic.fromTopicArn(this, "AlarmTopic", props.alarmTopicArn);
    const tell = (alarm: cloudwatch.Alarm) => {
      if (topic !== undefined) {
        alarm.addAlarmAction(new cwActions.SnsAction(topic));
      }
    };

    // #region alarm
    // Somebody is over the limit. Often a script gone wrong; sometimes the first minute of a flood.
    tell(
      new cloudwatch.Alarm(this, "RateRuleBlocking", {
        alarmDescription:
          "The rate-based rule is blocking. Open the runbook of chapter 46 and look at who.",
        metric: new cloudwatch.Metric({
          namespace: "AWS/WAFV2",
          metricName: "BlockedRequests",
          // A web ACL for CloudFront has no Region dimension.
          dimensionsMap: { WebACL: WEB_ACL_METRIC, Rule: RATE_RULE_METRIC },
          statistic: "Sum",
          period: Duration.minutes(1),
        }),
        threshold: 0,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 3,
        datapointsToAlarm: 2,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
    );
    // #endregion alarm

    // #region advanced
    if (props.protectedDistributionArn !== undefined) {
      // Fails to deploy unless the account is subscribed. Subscribing is done by hand:
      // USD 3,000 a month for a year, whatever this stack does afterwards.
      new shield.CfnProtection(this, "DistributionProtection", {
        name: "AihShieldDistribution",
        resourceArn: props.protectedDistributionArn,
      });
      tell(
        new cloudwatch.Alarm(this, "DdosDetected", {
          alarmDescription:
            "Shield Advanced reports an event on the distribution. Not always an attack: look.",
          metric: new cloudwatch.Metric({
            namespace: "AWS/DDoSProtection",
            metricName: "DDoSDetected",
            dimensionsMap: { ResourceArn: props.protectedDistributionArn },
            statistic: "Sum",
            period: Duration.minutes(1),
          }),
          threshold: 0,
          comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
          evaluationPeriods: 1,
          treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        }),
      );
    }
    // #endregion advanced

    new CfnOutput(this, "WebAclArn", { value: webAcl.attrArn });
  }
}
