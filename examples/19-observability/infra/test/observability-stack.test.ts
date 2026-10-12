import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { errorRateRule, latencyRule } from "../../src/alarm-math.ts";
import {
  ObservabilityStack,
  type ObservabilityStackProps,
  TABLE_CAP,
  THROTTLE,
} from "../lib/observability-stack.ts";

const LAYER = "arn:aws:lambda:ap-northeast-1:111122223333:layer:ExampleOtelLayer:1";

const synth = (props: Partial<ObservabilityStackProps> = {}) =>
  Template.fromStack(
    new ObservabilityStack(new App(), "AihObservability", {
      env: { region: "ap-northeast-1" },
      allowedOrigin: "https://d111.cloudfront.net",
      ...props,
    }),
  );

// Synthesized once each: every synth bundles the function with esbuild.
const template = synth();
const withLayer = synth({ otelLayerArn: LAYER, alarmEmail: "oncall@example.com" });

type Statement = { Effect: string; Action: string | string[]; Resource: unknown };
type MetricQuery = {
  Id: string;
  Expression?: string;
  ReturnData?: boolean;
  MetricStat?: { Metric: unknown };
};

const alarm = (description: string) => {
  const found = Object.values(template.findResources("AWS::CloudWatch::Alarm")).find((resource) =>
    (resource["Properties"].AlarmDescription as string).includes(description),
  );
  if (found === undefined) {
    throw new Error(`no alarm described as "${description}"`);
  }
  return found["Properties"] as Record<string, unknown> & { Metrics?: MetricQuery[] };
};

describe("alarms", () => {
  it("watches the 5xx rate with the tested rule", () => {
    const properties = alarm("5xx");
    expect(properties).toMatchObject({
      Threshold: errorRateRule.threshold,
      ComparisonOperator: "GreaterThanThreshold",
      EvaluationPeriods: errorRateRule.evaluationPeriods,
      DatapointsToAlarm: errorRateRule.datapointsToAlarm,
      TreatMissingData: errorRateRule.treatMissingData,
    });
    const expressions = (properties.Metrics ?? []).filter(
      (query) => query.Expression !== undefined,
    );
    expect(
      expressions.map((query) => [query.Id, query.Expression, query.ReturnData ?? true]),
    ).toEqual([
      ["expr_1", "IF(requests >= 20, errorRate, 0)", true],
      ["errorRate", "100 * errors / requests", false],
    ]);
    const metrics = (properties.Metrics ?? []).filter((query) => query.MetricStat !== undefined);
    expect(metrics.map((query) => query.Id).toSorted()).toEqual(["errors", "requests"]);
    expect(JSON.stringify(metrics)).toContain('"MetricName":"5xx"');
    expect(JSON.stringify(metrics)).toContain('"Period":60');
  });

  it("watches p95 latency as API Gateway measures it", () => {
    expect(alarm("time to answer")).toMatchObject({
      Namespace: "AWS/ApiGateway",
      MetricName: "Latency",
      ExtendedStatistic: latencyRule.statistic,
      Period: latencyRule.periodSeconds,
      Threshold: latencyRule.threshold,
      EvaluationPeriods: latencyRule.evaluationPeriods,
      DatapointsToAlarm: latencyRule.datapointsToAlarm,
      TreatMissingData: "notBreaching",
    });
  });

  it("notifies the topic when an alarm fires and when it recovers", () => {
    const topic = { Ref: Match.stringLikeRegexp("^MonitoringAlarms") };
    template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
    template.allResourcesProperties("AWS::CloudWatch::Alarm", {
      AlarmActions: [topic],
      OKActions: [topic],
    });
  });
});

describe("notification topic", () => {
  it("lets only this account's alarms publish, and only over TLS", () => {
    template.resourceCountIs("AWS::SNS::Topic", 1);
    const [policy] = Object.values(template.findResources("AWS::SNS::TopicPolicy"));
    const statements = policy?.["Properties"].PolicyDocument.Statement as (Statement & {
      Principal: unknown;
      Condition: unknown;
    })[];

    const allows = statements.filter((statement) => statement.Effect === "Allow");
    expect(allows).toHaveLength(1);
    expect(allows[0]).toMatchObject({
      Action: "sns:Publish",
      Principal: { Service: "cloudwatch.amazonaws.com" },
      Condition: { StringEquals: { "aws:SourceAccount": { Ref: "AWS::AccountId" } } },
    });

    // The statement `enforceSSL` adds. Without it, plain HTTP would be accepted.
    const denies = statements.filter((statement) => statement.Effect === "Deny");
    expect(denies).toHaveLength(1);
    expect(denies[0]).toMatchObject({
      Action: "sns:Publish",
      Condition: { Bool: { "aws:SecureTransport": "false" } },
    });
  });

  it("subscribes an address only when one is given", () => {
    template.resourceCountIs("AWS::SNS::Subscription", 0);
    withLayer.hasResourceProperties("AWS::SNS::Subscription", {
      Protocol: "email",
      Endpoint: "oncall@example.com",
    });
  });
});

describe("logs", () => {
  it("expires log events after a week and deletes the group with the stack", () => {
    template.hasResource("AWS::Logs::LogGroup", {
      Properties: { RetentionInDays: 7 },
      DeletionPolicy: "Delete",
      UpdateReplacePolicy: "Delete",
    });
  });

  it("counts conflicts with a JSON pattern on the function's own log group", () => {
    template.hasResourceProperties("AWS::Logs::MetricFilter", {
      FilterPattern: '{ ($.message = "request") && ($.status = 409) }',
      LogGroupName: { Ref: Match.stringLikeRegexp("^HandlerLogs") },
      MetricTransformations: [
        {
          MetricNamespace: "AihObservability",
          MetricName: "NoteConflicts",
          MetricValue: "1",
          DefaultValue: 0,
        },
      ],
    });
  });

  it("makes each log event a JSON object, which that pattern needs", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      LoggingConfig: {
        LogFormat: "JSON",
        LogGroup: { Ref: Match.stringLikeRegexp("^HandlerLogs") },
      },
    });
  });
});

describe("tracing", () => {
  it("turns on active tracing and, by default, attaches no layer", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      TracingConfig: { Mode: "Active" },
      Layers: Match.absent(),
      Environment: { Variables: { AWS_LAMBDA_EXEC_WRAPPER: Match.absent() } },
    });
  });

  it("attaches the given layer with its wrapper, traces only", () => {
    withLayer.hasResourceProperties("AWS::Lambda::Function", {
      Layers: [LAYER],
      Environment: {
        Variables: {
          AWS_LAMBDA_EXEC_WRAPPER: "/opt/otel-instrument",
          OTEL_AWS_APPLICATION_SIGNALS_ENABLED: "false",
        },
      },
    });
  });
});

describe("permissions", () => {
  for (const [name, subject] of [
    ["without the layer", template],
    ["with the layer", withLayer],
  ] as const) {
    it(`allows "*" only for the two X-Ray write actions, ${name}`, () => {
      const statements = Object.values(subject.findResources("AWS::IAM::Policy")).flatMap(
        (policy) => policy["Properties"].PolicyDocument.Statement as Statement[],
      );
      const wildcard = statements.filter(
        (statement) => JSON.stringify(statement.Resource) === '"*"',
      );

      expect(wildcard).toHaveLength(1);
      expect([wildcard[0]?.Action].flat().toSorted()).toEqual([
        "xray:PutTelemetryRecords",
        "xray:PutTraceSegments",
      ]);
      for (const statement of statements) {
        for (const action of [statement.Action].flat()) {
          expect(action).not.toContain("*");
        }
      }
      subject.hasResourceProperties("AWS::IAM::Role", { ManagedPolicyArns: Match.absent() });
    });
  }
});

describe("bounds on a flood", () => {
  it("throttles every route of the default stage", () => {
    template.resourceCountIs("AWS::ApiGatewayV2::Stage", 1);
    template.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      StageName: "$default",
      DefaultRouteSettings: { ThrottlingRateLimit: 10, ThrottlingBurstLimit: 20 },
    });
    expect(THROTTLE).toEqual({ rate: 10, burst: 20 });
  });

  it("caps what the on-demand table accepts per second", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      BillingMode: "PAY_PER_REQUEST",
      OnDemandThroughput: { MaxReadRequestUnits: 150, MaxWriteRequestUnits: 40 },
    });
    expect(TABLE_CAP).toEqual({ read: 150, write: 40 });
  });

  it("labels the 4xx line so a throttled flood can be read off the dashboard", () => {
    const [dashboard] = Object.values(template.findResources("AWS::CloudWatch::Dashboard"));
    expect(JSON.stringify(dashboard?.["Properties"].DashboardBody)).toContain(
      "4xx (429 when throttled)",
    );
  });
});

describe("dashboard", () => {
  it("stays within the 50 metrics of a free dashboard", () => {
    const [dashboard] = Object.values(template.findResources("AWS::CloudWatch::Dashboard"));
    const body = JSON.stringify(dashboard?.["Properties"].DashboardBody);
    const metrics = body.match(/AWS\/(ApiGateway|Lambda|DynamoDB)|AihObservability/g) ?? [];

    expect(metrics.length).toBeGreaterThan(10);
    expect(metrics.length).toBeLessThanOrEqual(50);
    expect(body).toContain("NoteConflicts");
  });
});

describe("the stack as a whole", () => {
  it("deletes the practice table with the stack", () => {
    template.hasResource("AWS::DynamoDB::Table", {
      DeletionPolicy: "Delete",
      UpdateReplacePolicy: "Delete",
    });
  });

  it("uses only resource types that were checked against the pinned cdkd", () => {
    const types = (subject: Template) => {
      const resources = subject.toJSON()["Resources"] as Record<string, { Type: string }>;
      return [...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted();
    };
    const base = [
      "AWS::ApiGatewayV2::Api",
      "AWS::ApiGatewayV2::Integration",
      "AWS::ApiGatewayV2::Route",
      "AWS::ApiGatewayV2::Stage",
      "AWS::CloudWatch::Alarm",
      // Cloud Control API in cdkd 0.296.28
      "AWS::CloudWatch::Dashboard",
      "AWS::DynamoDB::Table",
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
      "AWS::Lambda::Function",
      "AWS::Lambda::Permission",
      "AWS::Logs::LogGroup",
      // Cloud Control API in cdkd 0.296.28
      "AWS::Logs::MetricFilter",
      "AWS::SNS::Topic",
      "AWS::SNS::TopicPolicy",
    ];
    expect(types(template)).toEqual(base);
    expect(types(withLayer)).toEqual([...base, "AWS::SNS::Subscription"].toSorted());
  });
});
