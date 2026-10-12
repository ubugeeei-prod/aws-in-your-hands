import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { CLAIM_MS } from "../../src/ledger.ts";
import { DELIVERIES, patternsFor } from "../../src/watch.ts";
import {
  HANDLER_TIMEOUT_SECONDS,
  HealthStack,
  type HealthStackProps,
} from "../lib/health-stack.ts";

const [tokyo, global] = DELIVERIES;
const CHAPTER_19_TOPIC = "arn:aws:sns:ap-northeast-1:111122223333:AihObservability-Alarms";

const synth = (props: Partial<HealthStackProps> = {}) => {
  const delivery = props.delivery ?? tokyo;
  return Template.fromStack(
    new HealthStack(new App(), delivery.stack, {
      env: { region: delivery.region },
      delivery,
      ...props,
    }),
  );
};

// Synthesized once each: every synth bundles the function with esbuild.
const template = synth();
const inVirginia = synth({ delivery: global });
const withEmail = synth({ alarmEmail: "oncall@example.com" });
const withTopic = synth({ alarmTopicArn: CHAPTER_19_TOPIC, alarmEmail: "oncall@example.com" });

type Statement = {
  Effect: string;
  Action: string | string[];
  Resource: unknown;
  Principal?: unknown;
  Condition?: unknown;
};
const statementsOf = (subject: Template, type: string) =>
  Object.values(subject.findResources(type)).flatMap(
    (resource) => resource["Properties"].PolicyDocument.Statement as Statement[],
  );

describe("rules", () => {
  for (const [subject, delivery] of [
    [template, tokyo],
    [inVirginia, global],
  ] as const) {
    it(`deploys in ${delivery.region} exactly the patterns the tests match fixtures against`, () => {
      const deployed = Object.values(subject.findResources("AWS::Events::Rule")).map(
        (rule) => rule["Properties"].EventPattern as unknown,
      );
      expect(deployed).toEqual(patternsFor(delivery).map(({ pattern }) => pattern));
    });
  }

  it("listens on the default event bus, enabled, with the function as the only target", () => {
    template.resourceCountIs("AWS::Events::Rule", 2);
    template.allResourcesProperties("AWS::Events::Rule", {
      EventBusName: Match.absent(),
      State: "ENABLED",
      Targets: [
        { Arn: { "Fn::GetAtt": [Match.stringLikeRegexp("^Handler"), "Arn"] }, Id: "Target0" },
      ],
    });
  });

  it("lets each rule, and nothing else, invoke the function", () => {
    template.resourceCountIs("AWS::Lambda::Permission", 2);
    template.allResourcesProperties("AWS::Lambda::Permission", {
      Action: "lambda:InvokeFunction",
      Principal: "events.amazonaws.com",
      SourceArn: { "Fn::GetAtt": [Match.stringLikeRegexp("^Health(Events|Abuse)"), "Arn"] },
    });
    template.resourceCountIs("AWS::Lambda::Url", 0);
  });

  it("drops backup copies only where copies arrive", () => {
    expect(JSON.stringify(template.findResources("AWS::Events::Rule"))).not.toContain(
      "backupEvent",
    );
    expect(JSON.stringify(inVirginia.findResources("AWS::Events::Rule"))).toContain(
      '"backupEvent":["false"]',
    );
  });
});

describe("permissions", () => {
  for (const [name, subject] of [
    ["with its own topic", template],
    ["with chapter 19's topic", withTopic],
  ] as const) {
    it(`names every action and every resource, ${name}`, () => {
      const statements = statementsOf(subject, "AWS::IAM::Policy");
      const actions = statements.flatMap((statement) => [statement.Action].flat()).toSorted();
      expect(actions).toEqual([
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "sns:Publish",
        "sqs:SendMessage",
      ]);
      for (const statement of statements) {
        expect(statement.Effect).toBe("Allow");
        expect(JSON.stringify(statement.Resource)).not.toContain("*");
      }
      subject.hasResourceProperties("AWS::IAM::Role", { ManagedPolicyArns: Match.absent() });
    });
  }

  it("may publish to the given topic and to no other", () => {
    const publish = statementsOf(withTopic, "AWS::IAM::Policy").find(
      (statement) => statement.Action === "sns:Publish",
    );
    expect(publish?.Resource).toBe(CHAPTER_19_TOPIC);
    withTopic.hasResourceProperties("AWS::Lambda::Function", {
      Environment: { Variables: { TOPIC_ARN: CHAPTER_19_TOPIC } },
    });
  });
});

describe("notification topic", () => {
  it("is open to nobody: the only policy statement refuses plain HTTP", () => {
    template.resourceCountIs("AWS::SNS::Topic", 1);
    const statements = statementsOf(template, "AWS::SNS::TopicPolicy");
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatchObject({
      Effect: "Deny",
      Action: "sns:Publish",
      Condition: { Bool: { "aws:SecureTransport": "false" } },
    });
    expect(statements.filter((statement) => statement.Effect === "Allow")).toEqual([]);
  });

  it("subscribes an address only when one is given", () => {
    template.resourceCountIs("AWS::SNS::Subscription", 0);
    withEmail.hasResourceProperties("AWS::SNS::Subscription", {
      Protocol: "email",
      Endpoint: "oncall@example.com",
    });
  });

  it("creates no topic and no subscription when it is given chapter 19's", () => {
    withTopic.resourceCountIs("AWS::SNS::Topic", 0);
    withTopic.resourceCountIs("AWS::SNS::TopicPolicy", 0);
    withTopic.resourceCountIs("AWS::SNS::Subscription", 0);
  });
});

describe("the function", () => {
  it("sends what failed three times to an encrypted queue that keeps it for 14 days", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      DeadLetterConfig: {
        TargetArn: { "Fn::GetAtt": [Match.stringLikeRegexp("^DeadLetters"), "Arn"] },
      },
    });
    template.hasResourceProperties("AWS::SQS::Queue", {
      MessageRetentionPeriod: 1_209_600,
      SqsManagedSseEnabled: true,
    });
    // Lambda's default for asynchronous invocations is kept: two retries.
    template.resourceCountIs("AWS::Lambda::EventInvokeConfig", 0);
  });

  it("times out well inside the time a claim is left alone", () => {
    template.hasResourceProperties("AWS::Lambda::Function", { Timeout: HANDLER_TIMEOUT_SECONDS });
    expect(HANDLER_TIMEOUT_SECONDS * 1000).toBeLessThan(CLAIM_MS);
    // Lambda waits a minute before the first retry of an asynchronous invocation.
    expect(CLAIM_MS).toBeLessThan(60_000);
  });

  it("keeps its log for three months and deletes it with the stack", () => {
    template.hasResource("AWS::Logs::LogGroup", {
      Properties: { RetentionInDays: 90 },
      DeletionPolicy: "Delete",
      UpdateReplacePolicy: "Delete",
    });
  });
});

describe("cost while no event arrives", () => {
  it("reserves no capacity in the ledger, and lets entries expire", () => {
    template.hasResource("AWS::DynamoDB::Table", {
      Properties: {
        BillingMode: "PAY_PER_REQUEST",
        TimeToLiveSpecification: { AttributeName: "expiresAt", Enabled: true },
      },
      DeletionPolicy: "Delete",
      UpdateReplacePolicy: "Delete",
    });
  });

  it("has no alarm, no schedule, no provisioned concurrency: nothing billed by the hour or month", () => {
    for (const type of [
      "AWS::CloudWatch::Alarm",
      "AWS::Scheduler::Schedule",
      "AWS::Lambda::Version",
      "AWS::Lambda::Alias",
      "AWS::KMS::Key",
      "AWS::Events::EventBus",
    ]) {
      template.resourceCountIs(type, 0);
    }
    template.hasResourceProperties("AWS::Lambda::Function", {
      ReservedConcurrentExecutions: Match.absent(),
    });
  });
});

describe("the stack as a whole", () => {
  it("uses only resource types that were checked against the pinned cdkd", () => {
    const types = (subject: Template) => {
      const resources = subject.toJSON()["Resources"] as Record<string, { Type: string }>;
      return [...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted();
    };
    // Every one has its own provider in cdkd 0.296.28's register-providers.ts.
    const base = [
      "AWS::DynamoDB::Table",
      "AWS::Events::Rule",
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
      "AWS::Lambda::Function",
      "AWS::Lambda::Permission",
      "AWS::Logs::LogGroup",
      "AWS::SNS::Topic",
      "AWS::SNS::TopicPolicy",
      "AWS::SQS::Queue",
      "AWS::SQS::QueuePolicy",
    ];
    expect(types(template)).toEqual(base);
    expect(types(inVirginia)).toEqual(base);
    expect(types(withEmail)).toEqual([...base, "AWS::SNS::Subscription"].toSorted());
    expect(types(withTopic)).toEqual(
      base.filter((type) => type !== "AWS::SNS::Topic" && type !== "AWS::SNS::TopicPolicy"),
    );
  });

  it("pins the Region and nothing else", () => {
    for (const delivery of DELIVERIES) {
      const stack = new HealthStack(new App(), delivery.stack, {
        env: { region: delivery.region },
        delivery,
      });
      expect(stack.region).toBe(delivery.region);
      expect(JSON.stringify(Template.fromStack(stack).toJSON())).not.toMatch(
        /(?<![0-9a-f])\d{12}(?![0-9a-f])/,
      );
    }
  });
});
