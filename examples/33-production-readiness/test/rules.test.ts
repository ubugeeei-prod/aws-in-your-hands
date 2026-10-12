import { describe, expect, it } from "vite-plus/test";

import { bucketPublic, STATEFUL_TYPES, statefulDelete, tablePitr } from "../src/rules/data.ts";
import { apiThrottle, functionUrlAuth, queueDlq } from "../src/rules/doors.ts";
import { type Problem, RULE_IDS, RULES } from "../src/rules/rule.ts";
import { alarmRecipient, functionAlarm, logRetention } from "../src/rules/watching.ts";
import { readTemplate, type Template } from "../src/template.ts";

type Entry = { Type: string; Properties?: Record<string, unknown>; [attribute: string]: unknown };
const template = (resources: Record<string, Entry>): Template =>
  readTemplate({ Resources: resources });
const run = (rule: (template: Template) => Problem[], resources: Record<string, Entry>) =>
  rule(template(resources)).map((problem) => `${problem.resource}: ${problem.detail}`);

const CLOSED = {
  BlockPublicAcls: true,
  BlockPublicPolicy: true,
  IgnorePublicAcls: true,
  RestrictPublicBuckets: true,
};
const bucket = (properties: Record<string, unknown>): Record<string, Entry> => ({
  Bucket: { Type: "AWS::S3::Bucket", Properties: properties },
});
const bucketPolicy = (statement: unknown): Record<string, Entry> => ({
  Policy: {
    Type: "AWS::S3::BucketPolicy",
    Properties: { Bucket: { Ref: "Bucket" }, PolicyDocument: { Statement: statement } },
  },
});

describe("bucket-public", () => {
  it("passes a bucket with all four blocks on", () => {
    expect(run(bucketPublic, bucket({ PublicAccessBlockConfiguration: CLOSED }))).toEqual([]);
  });

  it("reports a bucket that says nothing about public access", () => {
    expect(run(bucketPublic, bucket({}))).toEqual([
      "Bucket: no PublicAccessBlockConfiguration: the template does not block public access",
    ]);
  });

  it.each([
    ["switched off", false],
    ["left out", undefined],
    ["decided at deploy time", { Ref: "Block" }],
    ['the string "true"', "true"],
  ])("reports a block that is %s", (_name, value) => {
    const block = { ...CLOSED, RestrictPublicBuckets: value };
    expect(run(bucketPublic, bucket({ PublicAccessBlockConfiguration: block }))).toEqual([
      "Bucket: PublicAccessBlockConfiguration.RestrictPublicBuckets is not true",
    ]);
  });

  it("reports a public canned ACL", () => {
    expect(
      run(
        bucketPublic,
        bucket({ PublicAccessBlockConfiguration: CLOSED, AccessControl: "PublicRead" }),
      ),
    ).toEqual(["Bucket: AccessControl is PublicRead"]);
  });

  it.each([
    ['Principal "*"', "*"],
    ['Principal AWS "*"', { AWS: "*" }],
    ['"*" among other principals', { AWS: ["arn:aws:iam::111122223333:root", "*"] }],
  ])("reports a policy that allows %s without a condition", (_name, principal) => {
    const statement = { Effect: "Allow", Principal: principal, Action: "s3:GetObject" };
    const found = ["Policy: allows s3:GetObject to everyone, with no condition"];
    // One statement on its own, and the list CDK writes.
    expect(run(bucketPublic, bucketPolicy(statement))).toEqual(found);
    expect(
      run(
        bucketPublic,
        bucketPolicy([{ Effect: "Deny", Principal: "*", Action: "s3:*" }, statement]),
      ),
    ).toEqual(found);
  });

  it.each([
    [
      "a service principal",
      {
        Effect: "Allow",
        Principal: { Service: "cloudfront.amazonaws.com" },
        Action: "s3:GetObject",
      },
    ],
    [
      "everyone, denied (the TLS-only statement)",
      { Effect: "Deny", Principal: { AWS: "*" }, Action: "s3:*" },
    ],
    [
      "everyone, under a condition it does not evaluate",
      {
        Effect: "Allow",
        Principal: "*",
        Action: "s3:GetObject",
        Condition: { StringEquals: { "aws:SourceVpce": "vpce-1a2b3c4d" } },
      },
    ],
  ])("passes a policy for %s", (_name, statement) => {
    expect(run(bucketPublic, bucketPolicy([statement]))).toEqual([]);
  });

  it("reports a policy it cannot read, instead of passing it", () => {
    expect(run(bucketPublic, bucketPolicy("Allow everything"))).toEqual([
      "Policy: the bucket policy could not be read",
    ]);
  });
});

describe("table-pitr", () => {
  const table = (properties: Record<string, unknown>): Record<string, Entry> => ({
    Notes: { Type: "AWS::DynamoDB::Table", Properties: properties },
  });

  it("passes a table with point-in-time recovery on", () => {
    expect(
      run(
        tablePitr,
        table({ PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true } }),
      ),
    ).toEqual([]);
  });

  it.each([
    ["no specification", {}],
    [
      "recovery switched off",
      { PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: false } },
    ],
    ["only a recovery period", { PointInTimeRecoverySpecification: { RecoveryPeriodInDays: 35 } }],
    [
      "a value decided at deploy time",
      { PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: { Ref: "Pitr" } } },
    ],
  ])("reports a table with %s", (_name, properties) => {
    expect(run(tablePitr, table(properties))).toEqual([
      "Notes: point-in-time recovery is not enabled",
    ]);
  });

  it("looks at every replica of a global table", () => {
    const on = { PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true } };
    expect(
      run(tablePitr, {
        Notes: {
          Type: "AWS::DynamoDB::GlobalTable",
          Properties: {
            Replicas: [{ Region: "ap-northeast-1", ...on }, { Region: "ap-northeast-3" }],
          },
        },
      }),
    ).toEqual(["Notes: point-in-time recovery is not enabled for the replica in ap-northeast-3"]);
  });
});

describe("stateful-delete", () => {
  const KEEP = { DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain" };

  it.each(STATEFUL_TYPES)("reports %s when the template deletes it", (type) => {
    expect(
      run(statefulDelete, {
        Thing: { Type: type, DeletionPolicy: "Delete", UpdateReplacePolicy: "Delete" },
      }),
    ).toEqual(["Thing: DeletionPolicy is Delete; UpdateReplacePolicy is Delete"]);
    expect(run(statefulDelete, { Thing: { Type: type, ...KEEP } })).toEqual([]);
  });

  it("treats a missing DeletionPolicy as a delete, because CloudFormation does", () => {
    expect(run(statefulDelete, { Notes: { Type: "AWS::DynamoDB::Table" } })).toEqual([
      "Notes: no DeletionPolicy (CloudFormation deletes); no UpdateReplacePolicy (a replacement deletes the old one)",
    ]);
  });

  it("reports a resource kept on destroy and lost on replacement", () => {
    expect(
      run(statefulDelete, { Notes: { Type: "AWS::DynamoDB::Table", DeletionPolicy: "Retain" } }),
    ).toEqual(["Notes: no UpdateReplacePolicy (a replacement deletes the old one)"]);
  });

  it("accepts a snapshot, and RetainExceptOnCreate", () => {
    expect(
      run(statefulDelete, {
        Volume: {
          Type: "AWS::EC2::Volume",
          DeletionPolicy: "Snapshot",
          UpdateReplacePolicy: "Snapshot",
        },
        Notes: {
          Type: "AWS::DynamoDB::Table",
          DeletionPolicy: "RetainExceptOnCreate",
          UpdateReplacePolicy: "Retain",
        },
      }),
    ).toEqual([]);
  });

  it("knows the two types CloudFormation snapshots when no DeletionPolicy is given", () => {
    const keepOnReplace = { UpdateReplacePolicy: "Snapshot" };
    expect(
      run(statefulDelete, {
        Cluster: { Type: "AWS::RDS::DBCluster", ...keepOnReplace },
        Alone: { Type: "AWS::RDS::DBInstance", ...keepOnReplace },
        Member: {
          Type: "AWS::RDS::DBInstance",
          Properties: { DBClusterIdentifier: { Ref: "Cluster" } },
          ...keepOnReplace,
        },
      }),
    ).toEqual(["Member: no DeletionPolicy (CloudFormation deletes)"]);
  });

  it("does not vouch for a policy decided at deploy time", () => {
    expect(
      run(statefulDelete, {
        Notes: {
          Type: "AWS::DynamoDB::Table",
          DeletionPolicy: { "Fn::If": ["IsProd", "Retain", "Delete"] },
          UpdateReplacePolicy: "Retain",
        },
      }),
    ).toEqual(["Notes: DeletionPolicy is decided at deploy time"]);
  });

  it("leaves resources alone that hold nothing", () => {
    expect(
      run(statefulDelete, {
        Handler: { Type: "AWS::Lambda::Function", DeletionPolicy: "Delete" },
        Queue: { Type: "AWS::SQS::Queue" },
      }),
    ).toEqual([]);
  });
});

describe("log-retention", () => {
  it("passes a log group with a retention and a function that uses it", () => {
    expect(
      run(logRetention, {
        Logs: { Type: "AWS::Logs::LogGroup", Properties: { RetentionInDays: 30 } },
        Handler: {
          Type: "AWS::Lambda::Function",
          Properties: { LoggingConfig: { LogGroup: { Ref: "Logs" } } },
        },
      }),
    ).toEqual([]);
  });

  it("reports a log group that never expires, and one whose retention it cannot see", () => {
    expect(
      run(logRetention, {
        Forever: { Type: "AWS::Logs::LogGroup" },
        Later: { Type: "AWS::Logs::LogGroup", Properties: { RetentionInDays: { Ref: "Days" } } },
      }),
    ).toEqual([
      "Forever: no RetentionInDays: log events never expire",
      "Later: RetentionInDays is decided at deploy time",
    ]);
  });

  it("reports a function that leaves its log group to Lambda", () => {
    expect(
      run(logRetention, {
        Handler: {
          Type: "AWS::Lambda::Function",
          Properties: { LoggingConfig: { LogFormat: "JSON" } },
        },
      }),
    ).toEqual([
      "Handler: no LoggingConfig.LogGroup: Lambda writes to a log group this template does not configure",
    ]);
  });
});

const fn = (properties: Record<string, unknown> = {}): Entry => ({
  Type: "AWS::Lambda::Function",
  Properties: properties,
});
const alarmOn = (dimension: unknown, extra: Record<string, unknown> = {}): Entry => ({
  Type: "AWS::CloudWatch::Alarm",
  Properties: { Dimensions: [{ Name: "Thing", Value: dimension }], ...extra },
});
const NOT_WATCHED =
  "no alarm watches the function, an API in front of it, or a queue that feeds it";

describe("function-alarm", () => {
  const api: Record<string, Entry> = {
    Api: { Type: "AWS::ApiGatewayV2::Api" },
    Integration: {
      Type: "AWS::ApiGatewayV2::Integration",
      Properties: { ApiId: { Ref: "Api" }, IntegrationUri: { "Fn::GetAtt": ["Handler", "Arn"] } },
    },
  };
  const queue: Record<string, Entry> = {
    DeadLetters: { Type: "AWS::SQS::Queue" },
    Jobs: {
      Type: "AWS::SQS::Queue",
      Properties: {
        RedrivePolicy: { deadLetterTargetArn: { "Fn::GetAtt": ["DeadLetters", "Arn"] } },
      },
    },
    Source: {
      Type: "AWS::Lambda::EventSourceMapping",
      Properties: {
        EventSourceArn: { "Fn::GetAtt": ["Jobs", "Arn"] },
        FunctionName: { Ref: "Handler" },
      },
    },
  };

  it("reports a function nothing watches", () => {
    expect(run(functionAlarm, { Handler: fn() })).toEqual([`Handler: ${NOT_WATCHED}`]);
  });

  it("is not satisfied by an alarm on something else", () => {
    expect(
      run(functionAlarm, { Handler: fn(), Other: fn(), Alarm: alarmOn({ Ref: "Other" }) }),
    ).toEqual([`Handler: ${NOT_WATCHED}`]);
  });

  it("accepts an alarm on the function itself", () => {
    expect(run(functionAlarm, { Handler: fn(), Alarm: alarmOn({ Ref: "Handler" }) })).toEqual([]);
  });

  it("accepts an alarm on the API in front, also when it is written as metric math", () => {
    const math: Entry = {
      Type: "AWS::CloudWatch::Alarm",
      Properties: {
        Metrics: [
          { Id: "rate", Expression: "100 * errors / requests" },
          {
            Id: "errors",
            MetricStat: { Metric: { Dimensions: [{ Name: "ApiId", Value: { Ref: "Api" } }] } },
          },
        ],
      },
    };
    expect(run(functionAlarm, { Handler: fn(), ...api, Alarm: alarmOn({ Ref: "Api" }) })).toEqual(
      [],
    );
    expect(run(functionAlarm, { Handler: fn(), ...api, Alarm: math })).toEqual([]);
  });

  it("follows an integration that names an alias of the function", () => {
    expect(
      run(functionAlarm, {
        Handler: fn(),
        Version: { Type: "AWS::Lambda::Version", Properties: { FunctionName: { Ref: "Handler" } } },
        Live: {
          Type: "AWS::Lambda::Alias",
          Properties: { FunctionName: { Ref: "Handler" }, Name: "live" },
        },
        Api: { Type: "AWS::ApiGatewayV2::Api" },
        Integration: {
          Type: "AWS::ApiGatewayV2::Integration",
          Properties: { ApiId: { Ref: "Api" }, IntegrationUri: { Ref: "Live" } },
        },
        Alarm: alarmOn({ Ref: "Api" }),
      }),
    ).toEqual([]);
  });

  it.each(["Jobs", "DeadLetters"])("accepts an alarm on the queue %s that feeds it", (id) => {
    expect(
      run(functionAlarm, {
        Handler: fn(),
        ...queue,
        Alarm: alarmOn({ "Fn::GetAtt": [id, "QueueName"] }),
      }),
    ).toEqual([]);
  });

  it("does not let one API's alarm cover a function behind another API", () => {
    expect(
      run(functionAlarm, {
        Handler: fn(),
        ...api,
        Admin: fn(),
        AdminApi: { Type: "AWS::ApiGatewayV2::Api" },
        AdminIntegration: {
          Type: "AWS::ApiGatewayV2::Integration",
          Properties: {
            ApiId: { Ref: "AdminApi" },
            IntegrationUri: { "Fn::GetAtt": ["Admin", "Arn"] },
          },
        },
        Alarm: alarmOn({ Ref: "Api" }),
      }),
    ).toEqual([`Admin: ${NOT_WATCHED}`]);
  });

  it("does not follow a schedule: the function behind it needs an alarm of its own", () => {
    expect(
      run(functionAlarm, {
        Handler: fn(),
        Nightly: {
          Type: "AWS::Scheduler::Schedule",
          Properties: { Target: { Arn: { "Fn::GetAtt": ["Handler", "Arn"] } } },
        },
        Alarm: alarmOn({ Ref: "Nightly" }),
      }),
    ).toEqual([`Handler: ${NOT_WATCHED}`]);
  });
});

describe("alarm-recipient", () => {
  const topic: Record<string, Entry> = { Topic: { Type: "AWS::SNS::Topic" } };
  const subscription: Record<string, Entry> = {
    OnCall: {
      Type: "AWS::SNS::Subscription",
      Properties: { TopicArn: { Ref: "Topic" }, Protocol: "email", Endpoint: "oncall@example.com" },
    },
  };
  const notifying = alarmOn({ Ref: "Api" }, { AlarmActions: [{ Ref: "Topic" }] });

  it("passes an alarm whose topic someone subscribed to", () => {
    expect(run(alarmRecipient, { ...topic, ...subscription, Alarm: notifying })).toEqual([]);
    expect(
      run(alarmRecipient, {
        Topic: {
          Type: "AWS::SNS::Topic",
          Properties: { Subscription: [{ Protocol: "email", Endpoint: "oncall@example.com" }] },
        },
        Alarm: notifying,
      }),
    ).toEqual([]);
  });

  it("reports an alarm with no action", () => {
    expect(run(alarmRecipient, { Alarm: alarmOn({ Ref: "Api" }) })).toEqual([
      "Alarm: no AlarmActions: nobody is told",
    ]);
    expect(run(alarmRecipient, { Alarm: alarmOn({ Ref: "Api" }, { AlarmActions: [] }) })).toEqual([
      "Alarm: no AlarmActions: nobody is told",
    ]);
  });

  it("is not satisfied by an action for the way back to OK only", () => {
    expect(
      run(alarmRecipient, {
        ...topic,
        ...subscription,
        Alarm: alarmOn({ Ref: "Api" }, { OKActions: [{ Ref: "Topic" }] }),
      }),
    ).toEqual(["Alarm: no AlarmActions: nobody is told"]);
  });

  it("reports actions that are switched off", () => {
    expect(
      run(alarmRecipient, {
        ...topic,
        ...subscription,
        Alarm: alarmOn({ Ref: "Api" }, { AlarmActions: [{ Ref: "Topic" }], ActionsEnabled: false }),
      }),
    ).toEqual(["Alarm: ActionsEnabled is false"]);
  });

  it("reports a topic nobody subscribed to", () => {
    expect(run(alarmRecipient, { ...topic, Alarm: notifying })).toEqual([
      "Alarm: notifies Topic, which has no subscription in this template",
    ]);
  });

  it("does not count a subscription to another topic", () => {
    expect(
      run(alarmRecipient, {
        ...topic,
        Other: { Type: "AWS::SNS::Topic" },
        OnCall: {
          Type: "AWS::SNS::Subscription",
          Properties: {
            TopicArn: { Ref: "Other" },
            Protocol: "email",
            Endpoint: "oncall@example.com",
          },
        },
        Alarm: notifying,
      }),
    ).toEqual(["Alarm: notifies Topic, which has no subscription in this template"]);
  });

  it("says nothing about a topic outside the template: it cannot see who listens", () => {
    const outside = { "Fn::ImportValue": "SharedAlarmTopicArn" };
    expect(
      run(alarmRecipient, { Alarm: alarmOn({ Ref: "Api" }, { AlarmActions: [outside] }) }),
    ).toEqual([]);
    expect(
      run(alarmRecipient, {
        Alarm: alarmOn(
          { Ref: "Api" },
          { AlarmActions: ["arn:aws:sns:ap-northeast-1:111122223333:alarms"] },
        ),
      }),
    ).toEqual([]);
  });
});

describe("api-throttle", () => {
  const stage = (properties: Record<string, unknown>): Record<string, Entry> => ({
    Stage: { Type: "AWS::ApiGatewayV2::Stage", Properties: properties },
  });
  const MISSING =
    "Stage: DefaultRouteSettings sets no ThrottlingRateLimit and ThrottlingBurstLimit";

  it("passes a stage with both limits", () => {
    expect(
      run(
        apiThrottle,
        stage({ DefaultRouteSettings: { ThrottlingRateLimit: 10, ThrottlingBurstLimit: 20 } }),
      ),
    ).toEqual([]);
  });

  it.each([
    ["no settings", {}],
    ["only a rate", { DefaultRouteSettings: { ThrottlingRateLimit: 10 } }],
    ["only a burst", { DefaultRouteSettings: { ThrottlingBurstLimit: 20 } }],
    [
      "a limit decided at deploy time",
      { DefaultRouteSettings: { ThrottlingRateLimit: { Ref: "Rate" }, ThrottlingBurstLimit: 20 } },
    ],
  ])("reports a stage with %s", (_name, properties) => {
    expect(run(apiThrottle, stage(properties))).toEqual([MISSING]);
  });
});

describe("function-url-auth", () => {
  const url = (properties: Record<string, unknown>): Record<string, Entry> => ({
    Url: { Type: "AWS::Lambda::Url", Properties: properties },
  });

  it("passes AWS_IAM and reports NONE", () => {
    expect(run(functionUrlAuth, url({ AuthType: "AWS_IAM" }))).toEqual([]);
    expect(run(functionUrlAuth, url({ AuthType: "NONE" }))).toEqual(["Url: AuthType is NONE"]);
  });

  it("does not vouch for an AuthType decided at deploy time", () => {
    expect(run(functionUrlAuth, url({ AuthType: { Ref: "Auth" } }))).toEqual([
      "Url: AuthType is not a literal AWS_IAM",
    ]);
  });
});

describe("queue-dlq", () => {
  const mapping: Entry = {
    Type: "AWS::Lambda::EventSourceMapping",
    Properties: {
      EventSourceArn: { "Fn::GetAtt": ["Jobs", "Arn"] },
      FunctionName: { Ref: "Worker" },
    },
  };

  it("reports a consumed queue with no dead-letter queue", () => {
    expect(run(queueDlq, { Jobs: { Type: "AWS::SQS::Queue" }, Source: mapping })).toEqual([
      "Jobs: consumed by a function, and has no RedrivePolicy.deadLetterTargetArn",
    ]);
  });

  it("passes a consumed queue that has one, and leaves the dead-letter queue itself alone", () => {
    expect(
      run(queueDlq, {
        DeadLetters: { Type: "AWS::SQS::Queue" },
        Jobs: {
          Type: "AWS::SQS::Queue",
          Properties: {
            RedrivePolicy: { deadLetterTargetArn: { "Fn::GetAtt": ["DeadLetters", "Arn"] } },
          },
        },
        Source: mapping,
      }),
    ).toEqual([]);
  });
});

describe("iam-wildcard", () => {
  it("reports what chapter 21's lint reports, under its own kinds", () => {
    const role: Entry = {
      Type: "AWS::IAM::Role",
      Properties: {
        AssumeRolePolicyDocument: {
          Statement: [
            {
              Effect: "Allow",
              Principal: { Service: "lambda.amazonaws.com" },
              Action: "sts:AssumeRole",
            },
          ],
        },
        Policies: [
          {
            PolicyName: "p",
            PolicyDocument: {
              Statement: [{ Effect: "Allow", Action: "s3:GetObject", Resource: "*" }],
            },
          },
        ],
      },
    };
    expect(run(RULES["iam-wildcard"].check, { Role: role })).toEqual([
      'Role: wildcard-resource: s3:GetObject on Resource "*"',
    ]);
  });
});

describe("the list of rules", () => {
  it("names a chapter and a consequence for every rule", () => {
    for (const id of RULE_IDS) {
      expect(RULES[id].chapter).toMatch(/^\d{2}$/);
      expect(RULES[id].breaks.length).toBeGreaterThan(20);
    }
    expect(Object.keys(RULES).toSorted()).toEqual([...RULE_IDS].toSorted());
  });
});
