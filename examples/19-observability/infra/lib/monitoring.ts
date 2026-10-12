import { Duration } from "aws-cdk-lib";
import type { HttpApi } from "aws-cdk-lib/aws-apigatewayv2";
import {
  Alarm,
  ComparisonOperator,
  Dashboard,
  GraphWidget,
  MathExpression,
  TreatMissingData,
  Unit,
} from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { Operation, type Table } from "aws-cdk-lib/aws-dynamodb";
import type { IFunction } from "aws-cdk-lib/aws-lambda";
import { FilterPattern, type ILogGroup, MetricFilter } from "aws-cdk-lib/aws-logs";
import { Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import { Construct } from "constructs";

import { errorRateExpressions, errorRateRule, latencyRule } from "../../src/alarm-math.ts";
import { metricFilterPattern } from "../../src/conditions.ts";
import { conflictLines } from "../../src/queries.ts";

export type MonitoringProps = {
  api: HttpApi;
  handler: IFunction;
  table: Table;
  logGroup: ILogGroup;
  /** Receives alarm mail after confirming the subscription. Without it the topic has no subscriber. */
  alarmEmail?: string | undefined;
};

export const METRIC_NAMESPACE = "AihObservability";

export class Monitoring extends Construct {
  readonly topic: Topic;
  readonly dashboard: Dashboard;

  constructor(scope: Construct, id: string, props: MonitoringProps) {
    super(scope, id);
    const { api, handler, table } = props;
    const minute = Duration.minutes(1);

    // #region topic
    this.topic = new Topic(this, "Alarms", { displayName: "AWS in Your Hands: notes API alarms" });
    if (props.alarmEmail !== undefined) {
      this.topic.addSubscription(new EmailSubscription(props.alarmEmail));
    }
    // #endregion topic

    // #region error-rate
    const requests = api.metricCount({ period: minute, statistic: "Sum" });
    const errors = api.metricServerError({ period: minute, statistic: "Sum" });
    const errorRate = new MathExpression({
      expression: errorRateExpressions.errorRate,
      usingMetrics: { errors, requests },
      period: minute,
    });
    const errorRateAlarm = new Alarm(this, "ServerErrorRate", {
      alarmDescription: `More than ${errorRateRule.threshold}% of requests answered with a 5xx.`,
      metric: new MathExpression({
        expression: errorRateExpressions.guarded,
        usingMetrics: { requests, errorRate },
        period: minute,
        label: "5xx rate (%)",
      }),
      threshold: errorRateRule.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: errorRateRule.evaluationPeriods,
      datapointsToAlarm: errorRateRule.datapointsToAlarm,
      // A minute without requests has no data point, and is not an outage.
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    // #endregion error-rate

    // #region latency
    const latencyAlarm = new Alarm(this, "SlowResponses", {
      alarmDescription: `${latencyRule.statistic} of the time to answer is above ${latencyRule.threshold} ms.`,
      // Measured by API Gateway, so it includes what the function cannot see: cold starts and queueing.
      metric: api.metricLatency({ period: minute, statistic: latencyRule.statistic }),
      threshold: latencyRule.threshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: latencyRule.evaluationPeriods,
      datapointsToAlarm: latencyRule.datapointsToAlarm,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    // #endregion latency

    // #region actions
    for (const alarm of [errorRateAlarm, latencyAlarm]) {
      alarm.addAlarmAction(new SnsAction(this.topic));
      // The recovery is news too: it says when the incident ended.
      alarm.addOkAction(new SnsAction(this.topic));
    }
    // #endregion actions

    // #region metric-filter
    // Counts lines that are already written. Costs one custom metric, and no change to the code.
    const conflicts = new MetricFilter(this, "Conflicts", {
      logGroup: props.logGroup,
      filterPattern: FilterPattern.literal(metricFilterPattern(conflictLines)),
      metricNamespace: METRIC_NAMESPACE,
      metricName: "NoteConflicts",
      metricValue: "1",
      // Reports 0 for minutes with log lines and no conflict, so the graph has no holes.
      defaultValue: 0,
      unit: Unit.COUNT,
    });
    // #endregion metric-filter

    // #region dashboard
    const operations = [
      Operation.GET_ITEM,
      Operation.PUT_ITEM,
      Operation.UPDATE_ITEM,
      Operation.DELETE_ITEM,
      Operation.QUERY,
    ];
    const sum = { period: minute, statistic: "Sum" };
    // Symptoms on top, causes below. Only the top row has alarms.
    this.dashboard = new Dashboard(this, "Dashboard", {
      widgets: [
        [
          new GraphWidget({
            title: "API: requests and errors",
            left: [requests, api.metricClientError(sum), errors],
            width: 12,
          }),
          new GraphWidget({
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
          new GraphWidget({
            title: "Lambda: errors and throttles",
            left: [
              handler.metricInvocations(sum),
              handler.metricErrors(sum),
              handler.metricThrottles(sum),
            ],
            width: 12,
          }),
          new GraphWidget({
            title: "Lambda: duration (ms) and concurrency",
            left: [handler.metricDuration({ period: minute, statistic: "p95" })],
            right: [
              handler.metric("ConcurrentExecutions", { period: minute, statistic: "Maximum" }),
            ],
            width: 12,
          }),
        ],
        [
          new GraphWidget({
            title: "DynamoDB: throttled requests",
            left: [table.metricThrottledRequestsForOperations({ operations, period: minute })],
            width: 8,
          }),
          new GraphWidget({
            title: "DynamoDB: server errors",
            left: [table.metricSystemErrorsForOperations({ operations, period: minute })],
            width: 8,
          }),
          new GraphWidget({
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
