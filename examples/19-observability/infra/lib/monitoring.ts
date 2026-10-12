import { Duration, Stack } from "aws-cdk-lib";
import type * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import type * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import { Construct } from "constructs";

import { errorRateExpressions, errorRateRule, latencyRule } from "../../src/alarm-math.ts";
import { metricFilterPattern } from "../../src/conditions.ts";
import { conflictLines } from "../../src/queries.ts";

export type MonitoringProps = {
  api: apigwv2.HttpApi;
  handler: lambda.IFunction;
  table: dynamodb.Table;
  logGroup: logs.ILogGroup;
  /** Receives alarm mail after confirming the subscription. Without it the topic has no subscriber. */
  alarmEmail?: string | undefined;
};

export const METRIC_NAMESPACE = "AihObservability";

export class Monitoring extends Construct {
  readonly topic: sns.ITopic;
  readonly dashboard: cloudwatch.Dashboard;

  constructor(scope: Construct, id: string, props: MonitoringProps) {
    super(scope, id);
    const { api, handler, table } = props;
    const minute = Duration.minutes(1);

    // #region topic
    const topic = new sns.Topic(this, "Alarms", {
      displayName: "AWS in Your Hands: notes API alarms",
      // Refuses a publish that arrives over plain HTTP.
      enforceSSL: true,
    });
    this.topic = topic;
    // Any topic policy replaces the default one, so the alarms' right to publish is spelled out.
    topic.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "AlarmsOfThisAccount",
        actions: ["sns:Publish"],
        principals: [new iam.ServicePrincipal("cloudwatch.amazonaws.com")],
        resources: [topic.topicArn],
        conditions: { StringEquals: { "aws:SourceAccount": Stack.of(this).account } },
      }),
    );
    if (props.alarmEmail !== undefined) {
      topic.addSubscription(new subscriptions.EmailSubscription(props.alarmEmail));
    }
    // #endregion topic

    // #region error-rate
    const requests = api.metricCount({ period: minute, statistic: "Sum" });
    const errors = api.metricServerError({ period: minute, statistic: "Sum" });
    const errorRate = new cloudwatch.MathExpression({
      expression: errorRateExpressions.errorRate,
      usingMetrics: { errors, requests },
      period: minute,
    });
    const errorRateAlarm = new cloudwatch.Alarm(this, "ServerErrorRate", {
      alarmDescription: `More than ${errorRateRule.threshold}% of requests answered with a 5xx.`,
      metric: new cloudwatch.MathExpression({
        expression: errorRateExpressions.guarded,
        usingMetrics: { requests, errorRate },
        period: minute,
        label: "5xx rate (%)",
      }),
      threshold: errorRateRule.threshold,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: errorRateRule.evaluationPeriods,
      datapointsToAlarm: errorRateRule.datapointsToAlarm,
      // A minute without requests has no data point, and is not an outage.
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    // #endregion error-rate

    // #region latency
    const latencyAlarm = new cloudwatch.Alarm(this, "SlowResponses", {
      alarmDescription: `${latencyRule.statistic} of the time to answer is above ${latencyRule.threshold} ms.`,
      // Measured by API Gateway, so it includes what the function cannot see: cold starts and queueing.
      metric: api.metricLatency({ period: minute, statistic: latencyRule.statistic }),
      threshold: latencyRule.threshold,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: latencyRule.evaluationPeriods,
      datapointsToAlarm: latencyRule.datapointsToAlarm,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    // #endregion latency

    // #region actions
    for (const alarm of [errorRateAlarm, latencyAlarm]) {
      alarm.addAlarmAction(new cwActions.SnsAction(topic));
      // The recovery is news too: it says when the incident ended.
      alarm.addOkAction(new cwActions.SnsAction(topic));
    }
    // #endregion actions

    // #region metric-filter
    // Counts lines that are already written. Costs one custom metric, and no change to the code.
    const conflicts = new logs.MetricFilter(this, "Conflicts", {
      logGroup: props.logGroup,
      filterPattern: logs.FilterPattern.literal(metricFilterPattern(conflictLines)),
      metricNamespace: METRIC_NAMESPACE,
      metricName: "NoteConflicts",
      metricValue: "1",
      // Reports 0 for minutes with log lines and no conflict, so the graph has no holes.
      defaultValue: 0,
      unit: cloudwatch.Unit.COUNT,
    });
    // #endregion metric-filter

    // #region dashboard
    const operations = [
      dynamodb.Operation.GET_ITEM,
      dynamodb.Operation.PUT_ITEM,
      dynamodb.Operation.UPDATE_ITEM,
      dynamodb.Operation.DELETE_ITEM,
      dynamodb.Operation.QUERY,
    ];
    const sum = { period: minute, statistic: "Sum" };
    // Symptoms on top, causes below. Only the top row has alarms.
    this.dashboard = new cloudwatch.Dashboard(this, "Dashboard", {
      widgets: [
        [
          new cloudwatch.GraphWidget({
            title: "API: requests and errors",
            // Requests the stage throttle turns away are 429s: they show up here, and nowhere below.
            left: [
              requests,
              api.metricClientError({ ...sum, label: "4xx (429 when throttled)" }),
              errors,
            ],
            width: 12,
          }),
          new cloudwatch.GraphWidget({
            title: "API: latency (ms)",
            left: [
              api.metricLatency({ period: minute, statistic: "p50" }),
              api.metricLatency({ period: minute, statistic: "p95" }),
              api.metricIntegrationLatency({ period: minute, statistic: "p95" }),
            ],
            width: 12,
          }),
        ],
        [
          new cloudwatch.GraphWidget({
            title: "Lambda: errors and throttles",
            left: [
              handler.metricInvocations(sum),
              handler.metricErrors(sum),
              handler.metricThrottles(sum),
            ],
            width: 12,
          }),
          new cloudwatch.GraphWidget({
            title: "Lambda: duration (ms) and concurrency",
            left: [handler.metricDuration({ period: minute, statistic: "p95" })],
            right: [
              handler.metric("ConcurrentExecutions", { period: minute, statistic: "Maximum" }),
            ],
            width: 12,
          }),
        ],
        [
          new cloudwatch.GraphWidget({
            title: "DynamoDB: throttled requests",
            left: [table.metricThrottledRequestsForOperations({ operations, period: minute })],
            width: 8,
          }),
          new cloudwatch.GraphWidget({
            title: "DynamoDB: server errors",
            left: [table.metricSystemErrorsForOperations({ operations, period: minute })],
            width: 8,
          }),
          new cloudwatch.GraphWidget({
            title: "Notes: update conflicts",
            left: [conflicts.metric(sum), table.metricConditionalCheckFailedRequests(sum)],
            width: 8,
          }),
        ],
      ],
    });
    // #endregion dashboard
  }
}
