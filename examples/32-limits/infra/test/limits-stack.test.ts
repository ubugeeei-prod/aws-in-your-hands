import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { worstCaseWaitMs } from "../../src/backoff.ts";
import { COST_TAGS } from "../../src/cost.ts";
import { SDK_2026_THROTTLING_BACKOFF, TABLE_CLIENT_RETRY } from "../../src/sdk-retry.ts";
import {
  CREATE_THROTTLE,
  FUNCTION_TIMEOUT_SECONDS,
  LimitsStack,
  type LimitsStackProps,
  STAGE_THROTTLE,
  TABLE_CAP,
} from "../lib/limits-stack.ts";

const TOPIC = "arn:aws:sns:ap-northeast-1:111122223333:AihObservability-Alarms";

const synth = (props: Partial<LimitsStackProps> = {}) =>
  Template.fromStack(
    new LimitsStack(new App(), "AihLimits", {
      env: { region: "ap-northeast-1" },
      allowedOrigin: "https://d111.cloudfront.net",
      monthlyBudgetUsd: 5,
      ...props,
    }),
  );

// Synthesized once each: every synth bundles the function with esbuild.
const template = synth();
const full = synth({
  reservedConcurrency: 5,
  budgetEmail: "owner@example.com",
  alarmTopicArn: TOPIC,
});

type Statement = { Effect: string; Action: string | string[]; Resource: unknown };
type Tag = { Key: string; Value: string };

describe("the limits the stack sets for itself", () => {
  it("throttles every route, and the route that writes more tightly", () => {
    template.resourceCountIs("AWS::ApiGatewayV2::Stage", 1);
    template.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      StageName: "$default",
      DefaultRouteSettings: { ThrottlingRateLimit: 10, ThrottlingBurstLimit: 20 },
      RouteSettings: { "POST /notes": { ThrottlingRateLimit: 2, ThrottlingBurstLimit: 4 } },
    });
    expect(STAGE_THROTTLE).toEqual({ rate: 10, burst: 20 });
    expect(CREATE_THROTTLE.rate).toBeLessThan(STAGE_THROTTLE.rate);
  });

  it("names in the stage's settings a route that exists, and waits for it", () => {
    const routes = template.findResources("AWS::ApiGatewayV2::Route", {
      Properties: { RouteKey: "POST /notes" },
    });
    expect(Object.keys(routes)).toHaveLength(1);
    const [stage] = Object.values(template.findResources("AWS::ApiGatewayV2::Stage"));
    expect(stage?.["DependsOn"]).toEqual(expect.arrayContaining(Object.keys(routes)));
  });

  it("caps what the on-demand table accepts per second", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      BillingMode: "PAY_PER_REQUEST",
      OnDemandThroughput: { MaxReadRequestUnits: 150, MaxWriteRequestUnits: 40 },
    });
    expect(TABLE_CAP).toEqual({ read: 150, write: 40 });
  });

  it("reserves no concurrency unless asked, so a new account can still deploy", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      ReservedConcurrentExecutions: Match.absent(),
    });
    full.hasResourceProperties("AWS::Lambda::Function", { ReservedConcurrentExecutions: 5 });
  });

  it("gives the function time for the SDK's retries, and less than API Gateway waits", () => {
    template.hasResourceProperties("AWS::Lambda::Function", { Timeout: FUNCTION_TIMEOUT_SECONDS });
    const worstWaitSeconds =
      worstCaseWaitMs(SDK_2026_THROTTLING_BACKOFF, TABLE_CLIENT_RETRY.maxAttempts) / 1000;
    expect(FUNCTION_TIMEOUT_SECONDS).toBeGreaterThan(worstWaitSeconds * 2);
    // HTTP API's maximum integration timeout.
    expect(FUNCTION_TIMEOUT_SECONDS).toBeLessThan(30);
  });
});

describe("the alarm on Lambda's own refusals", () => {
  it("fires when the function is throttled in two of three minutes", () => {
    template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      Namespace: "AWS/Lambda",
      MetricName: "Throttles",
      Statistic: "Sum",
      Period: 60,
      Threshold: 0,
      ComparisonOperator: "GreaterThanThreshold",
      EvaluationPeriods: 3,
      DatapointsToAlarm: 2,
      TreatMissingData: "notBreaching",
    });
  });

  it("notifies a topic only when one is given, and creates none itself", () => {
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmActions: Match.absent(),
    });
    full.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmActions: [TOPIC],
      OKActions: [TOPIC],
    });
    full.resourceCountIs("AWS::SNS::Topic", 0);
  });
});

describe("cost allocation", () => {
  const tagsOf = (type: string): Tag[] => {
    const [resource] = Object.values(template.findResources(type));
    return (resource?.["Properties"].Tags ?? []) as Tag[];
  };

  it("tags what is billed: the table, the function, the log group", () => {
    for (const type of ["AWS::DynamoDB::Table", "AWS::Lambda::Function", "AWS::Logs::LogGroup"]) {
      expect(tagsOf(type), type).toEqual(
        expect.arrayContaining([
          { Key: "project", Value: COST_TAGS.project },
          { Key: "chapter", Value: COST_TAGS.chapter },
        ]),
      );
    }
  });

  it("tags the API and its stage, where tags are a map", () => {
    for (const type of ["AWS::ApiGatewayV2::Api", "AWS::ApiGatewayV2::Stage"]) {
      const [resource] = Object.values(template.findResources(type));
      expect(resource?.["Properties"].Tags, type).toMatchObject(COST_TAGS);
    }
  });

  it("budgets the month for the project tag only", () => {
    template.resourceCountIs("AWS::Budgets::Budget", 1);
    template.hasResourceProperties("AWS::Budgets::Budget", {
      Budget: {
        BudgetType: "COST",
        TimeUnit: "MONTHLY",
        BudgetLimit: { Amount: 5, Unit: "USD" },
        FilterExpression: {
          Tags: { Key: "project", Values: ["aih-notes"], MatchOptions: ["EQUALS"] },
        },
      },
    });
  });

  it("tells nobody unless an address is given, and then at 80% spent and 100% forecast", () => {
    template.hasResourceProperties("AWS::Budgets::Budget", {
      NotificationsWithSubscribers: Match.absent(),
    });
    const subscribers = [{ SubscriptionType: "EMAIL", Address: "owner@example.com" }];
    full.hasResourceProperties("AWS::Budgets::Budget", {
      NotificationsWithSubscribers: [
        {
          Notification: {
            NotificationType: "ACTUAL",
            Threshold: 80,
            ThresholdType: "PERCENTAGE",
            ComparisonOperator: "GREATER_THAN",
          },
          Subscribers: subscribers,
        },
        {
          Notification: {
            NotificationType: "FORECASTED",
            Threshold: 100,
            ThresholdType: "PERCENTAGE",
            ComparisonOperator: "GREATER_THAN",
          },
          Subscribers: subscribers,
        },
      ],
    });
  });
});

describe("permissions", () => {
  it("names the table and the log group, and uses no wildcard", () => {
    const statements = Object.values(full.findResources("AWS::IAM::Policy")).flatMap(
      (policy) => policy["Properties"].PolicyDocument.Statement as Statement[],
    );

    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      expect(JSON.stringify(statement.Resource)).not.toBe('"*"');
      for (const action of [statement.Action].flat()) {
        expect(action).not.toContain("*");
      }
    }
    full.hasResourceProperties("AWS::IAM::Role", { ManagedPolicyArns: Match.absent() });
  });

  it("lets only this API invoke the function", () => {
    const permissions = Object.values(template.findResources("AWS::Lambda::Permission"));
    expect(permissions.length).toBeGreaterThan(0);
    for (const permission of permissions) {
      expect(permission["Properties"]).toMatchObject({
        Action: "lambda:InvokeFunction",
        Principal: "apigateway.amazonaws.com",
      });
      expect(JSON.stringify(permission["Properties"].SourceArn)).toContain("execute-api");
    }
    template.resourceCountIs("AWS::Lambda::Url", 0);
  });
});

describe("the stack as a whole", () => {
  it("deletes the practice table and logs with the stack", () => {
    for (const type of ["AWS::DynamoDB::Table", "AWS::Logs::LogGroup"]) {
      template.hasResource(type, { DeletionPolicy: "Delete", UpdateReplacePolicy: "Delete" });
    }
    template.hasResourceProperties("AWS::Logs::LogGroup", { RetentionInDays: 7 });
  });

  it("asks no account or lookup of AWS at synth", () => {
    expect(JSON.stringify(template.toJSON())).not.toMatch(/\d{12}/);
  });

  it("uses only resource types the pinned cdkd has its own provider for", () => {
    const types = (subject: Template) => {
      const resources = subject.toJSON()["Resources"] as Record<string, { Type: string }>;
      return [...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted();
    };
    const expected = [
      "AWS::ApiGatewayV2::Api",
      "AWS::ApiGatewayV2::Integration",
      "AWS::ApiGatewayV2::Route",
      "AWS::ApiGatewayV2::Stage",
      "AWS::Budgets::Budget",
      "AWS::CloudWatch::Alarm",
      "AWS::DynamoDB::Table",
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
      "AWS::Lambda::Function",
      "AWS::Lambda::Permission",
      "AWS::Logs::LogGroup",
    ];
    expect(types(template)).toEqual(expected);
    expect(types(full)).toEqual(expected);
  });
});
