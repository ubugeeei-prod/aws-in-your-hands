import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as sqs from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";

import { type Delivery, patternsFor } from "../../src/watch.ts";

export type HealthStackProps = StackProps & {
  delivery: Delivery;
  /** Subscribed to the topic this stack creates. Ignored when a topic is given. */
  alarmEmail?: string | undefined;
  /** An existing topic in this account, such as chapter 19's AlarmTopicArn. Without it, the stack makes one. */
  alarmTopicArn?: string | undefined;
};

export const HANDLER_TIMEOUT_SECONDS = 10;

export class HealthStack extends Stack {
  constructor(scope: Construct, id: string, props: HealthStackProps) {
    super(scope, id, props);
    const { delivery } = props;

    // #region ledger
    const ledger = new dynamodb.Table(this, "Ledger", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      // Nothing is billed while no event arrives: no capacity is reserved.
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expiresAt",
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion ledger

    // #region topic
    let topic: sns.ITopic;
    if (props.alarmTopicArn === undefined) {
      const own = new sns.Topic(this, "Notices", {
        displayName: "AWS in Your Hands: AWS Health",
        // Refuses a publish that arrives over plain HTTP. The policy allows nobody else in.
        enforceSSL: true,
      });
      if (props.alarmEmail !== undefined) {
        own.addSubscription(new subscriptions.EmailSubscription(props.alarmEmail));
      }
      topic = own;
    } else {
      topic = sns.Topic.fromTopicArn(this, "Notices", props.alarmTopicArn);
    }
    // #endregion topic

    // #region function
    const deadLetters = new sqs.Queue(this, "DeadLetters", {
      // Long enough for someone to come back from a long weekend and find it.
      retentionPeriod: Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const logGroup = new logs.LogGroup(this, "HandlerLogs", {
      // As long as the Health Dashboard keeps an event: what was ignored, and why, stays readable.
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const role = new iam.Role(this, "HandlerRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    logGroup.grants.write(role);
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:GetItem", "dynamodb:PutItem"],
        resources: [ledger.tableArn],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({ actions: ["sns:Publish"], resources: [topic.topicArn] }),
    );

    const handler = new nodejs.NodejsFunction(this, "Handler", {
      entry: fileURLToPath(new URL("../../src/lambda.ts", import.meta.url)),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(HANDLER_TIMEOUT_SECONDS),
      role,
      logGroup,
      loggingFormat: lambda.LoggingFormat.JSON,
      // Where an event goes after the third failed attempt. Adds sqs:SendMessage to the role.
      deadLetterQueue: deadLetters,
      environment: {
        TABLE_NAME: ledger.tableName,
        TOPIC_ARN: topic.topicArn,
      },
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: "node24",
        minify: false,
        sourceMap: false,
        externalModules: [],
        // The bundled AWS SDK still calls require(); an ESM bundle has none unless we provide it.
        banner:
          "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
    });
    // #endregion function

    // #region rules
    // On the default event bus of this stack's Region: AWS services publish nowhere else.
    for (const { name, description, pattern } of patternsFor(delivery)) {
      const { source, "detail-type": detailType, detail } = pattern;
      new events.Rule(this, `Health${name}`, {
        description,
        eventPattern: {
          source: source as string[],
          detailType: detailType as string[],
          ...(detail === undefined ? {} : { detail: detail as Record<string, string[]> }),
        },
        targets: [new targets.LambdaFunction(handler)],
      });
    }
    // #endregion rules

    new CfnOutput(this, "TopicArn", { value: topic.topicArn });
    new CfnOutput(this, "LedgerTableName", { value: ledger.tableName });
    new CfnOutput(this, "DeadLetterQueueUrl", { value: deadLetters.queueUrl });
    new CfnOutput(this, "HandlerLogGroupName", { value: logGroup.logGroupName });
  }
}
