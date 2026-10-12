import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as ses from "aws-cdk-lib/aws-ses";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import type { Construct } from "constructs";

export type EmailStackProps = StackProps & {
  /** The From address of every mail this stack sends. */
  fromAddress: string;
  /** What SES verifies: that address, or the domain it belongs to. */
  senderIdentity: string;
  /** Links in the mail point here. */
  appOrigin: string;
  /** Optional subdomain for the envelope sender, such as bounce.example.com. Domain identities only. */
  mailFromDomain?: string | undefined;
};

// Requests per second the API accepts, and how far a burst may go past it. Beyond that: 429.
const THROTTLE = { rate: 10, burst: 20 } as const;

export class EmailStack extends Stack {
  constructor(scope: Construct, id: string, props: EmailStackProps) {
    super(scope, id, props);
    const isDomain = !props.senderIdentity.includes("@");

    // #region table
    const table = new dynamodb.Table(this, "Mail", {
      // NOTIFICATION#<id> and SUPPRESSION#<address>: every read is by exact key.
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      // Notification records carry expiresAt and are deleted after it. Suppressions carry none.
      timeToLiveAttribute: "expiresAt",
      // Exercise data. A real suppression list wants RETAIN and point-in-time recovery.
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion table

    // #region configuration-set
    const configurationSet = new ses.ConfigurationSet(this, "Notifications", {
      // Stated here, so SES's own suppression list applies whatever the account-level setting is.
      suppressionReasons: ses.SuppressionReasons.BOUNCES_AND_COMPLAINTS,
    });

    const events = new sns.Topic(this, "MailEvents", { enforceSSL: true });
    // Also adds the topic policy that lets SES, for this configuration set only, publish.
    configurationSet.addEventDestination("ToSns", {
      destination: ses.EventDestination.snsTopic(events),
      events: [
        ses.EmailSendingEvent.BOUNCE,
        ses.EmailSendingEvent.COMPLAINT,
        ses.EmailSendingEvent.DELIVERY,
      ],
    });
    // #endregion configuration-set

    // #region identity
    // Creating this starts verification; it does not finish it. An address gets a
    // confirmation mail to click, a domain gets DKIM records to publish by hand.
    const identity = new ses.EmailIdentity(this, "Sender", {
      identity: isDomain
        ? ses.Identity.domain(props.senderIdentity)
        : ses.Identity.email(props.senderIdentity),
      configurationSet,
      ...(isDomain && props.mailFromDomain !== undefined
        ? {
            mailFromDomain: props.mailFromDomain,
            // Until the MX record exists, fall back to amazonses.com rather than refuse to send.
            mailFromBehaviorOnMxFailure: ses.MailFromBehaviorOnMxFailure.USE_DEFAULT_VALUE,
          }
        : {}),
    });
    // #endregion identity

    const apiLogs = new logs.LogGroup(this, "ApiLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const eventLogs = new logs.LogGroup(this, "EventLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // #region send-role
    const apiRole = new iam.Role(this, "ApiRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    apiLogs.grantWrite(apiRole);
    apiRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"],
        resources: [table.tableArn],
      }),
    );
    apiRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ses:SendEmail"],
        // This identity, through this configuration set, and nothing else in the account.
        resources: [
          identity.emailIdentityArn,
          this.formatArn({
            service: "ses",
            resource: "configuration-set",
            resourceName: configurationSet.configurationSetName,
          }),
        ],
        // A verified domain would allow any address in it. Only this one may be the sender.
        conditions: { StringEquals: { "ses:FromAddress": props.fromAddress } },
      }),
    );
    // #endregion send-role

    // #region events-role
    // Records what SES reports. It cannot send mail and cannot read the table.
    const eventsRole = new iam.Role(this, "EventsRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    eventLogs.grantWrite(eventsRole);
    eventsRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:PutItem", "dynamodb:UpdateItem"],
        resources: [table.tableArn],
      }),
    );
    // #endregion events-role

    const functionDefaults = {
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      // The bundled AWS SDK still calls require(); an ESM bundle has none unless we provide it.
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: "node24",
        minify: false,
        sourceMap: false,
        externalModules: [],
        banner:
          "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
    };

    const apiHandler = new nodejs.NodejsFunction(this, "ApiHandler", {
      ...functionDefaults,
      entry: fileURLToPath(new URL("../../src/lambda.ts", import.meta.url)),
      role: apiRole,
      logGroup: apiLogs,
      environment: {
        MAIL_MODE: "aws",
        LOG_LEVEL: "info",
        STAGE: "dev",
        FROM_ADDRESS: props.fromAddress,
        APP_ORIGIN: props.appOrigin,
        TABLE_NAME: table.tableName,
        CONFIGURATION_SET_NAME: configurationSet.configurationSetName,
      },
    });

    const eventsHandler = new nodejs.NodejsFunction(this, "EventsHandler", {
      ...functionDefaults,
      entry: fileURLToPath(new URL("../../src/events-lambda.ts", import.meta.url)),
      role: eventsRole,
      logGroup: eventLogs,
      environment: { LOG_LEVEL: "info", TABLE_NAME: table.tableName },
    });
    events.addSubscription(new subscriptions.LambdaSubscription(eventsHandler));

    // #region api
    // An API that sends mail is not left open: every route wants a SigV4-signed
    // request from an IAM identity allowed to invoke it. No CORS, no browsers.
    const api = new apigwv2.HttpApi(this, "Api", { description: "Share notification mail API" });
    const integration = new integrations.HttpLambdaIntegration("Mail", apiHandler);
    const authorizer = new authorizers.HttpIamAuthorizer();
    api.addRoutes({ path: "/health", methods: [apigwv2.HttpMethod.GET], integration, authorizer });
    api.addRoutes({
      path: "/share-notifications",
      methods: [apigwv2.HttpMethod.POST],
      integration,
      authorizer,
    });
    api.addRoutes({
      path: "/share-notifications/{id}",
      methods: [apigwv2.HttpMethod.GET],
      integration,
      authorizer,
    });
    // A signed caller stuck in a loop is still a loop. This is what stops it short of SES.
    const stage = api.defaultStage?.node.defaultChild as apigwv2.CfnStage;
    stage.defaultRouteSettings = {
      throttlingRateLimit: THROTTLE.rate,
      throttlingBurstLimit: THROTTLE.burst,
    };
    // #endregion api

    new CfnOutput(this, "ApiUrl", { value: api.apiEndpoint });
    new CfnOutput(this, "TableName", { value: table.tableName });
    new CfnOutput(this, "ConfigurationSetName", { value: configurationSet.configurationSetName });
    new CfnOutput(this, "SenderIdentity", { value: props.senderIdentity });
    new CfnOutput(this, "ApiLogGroupName", { value: apiLogs.logGroupName });
    new CfnOutput(this, "EventLogGroupName", { value: eventLogs.logGroupName });
    if (isDomain) {
      // Read by `vp run mail:dns`, which prints the records to publish.
      identity.dkimRecords.forEach((record, index) => {
        new CfnOutput(this, `DkimName${index + 1}`, { value: record.name });
        new CfnOutput(this, `DkimValue${index + 1}`, { value: record.value });
      });
      if (props.mailFromDomain !== undefined) {
        new CfnOutput(this, "MailFromDomain", { value: props.mailFromDomain });
      }
    }
  }
}
