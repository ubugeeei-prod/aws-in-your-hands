import { fileURLToPath } from "node:url";

import {
  AssetHashType,
  CfnOutput,
  DockerImage,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from "aws-cdk-lib";
import * as bedrockagentcore from "aws-cdk-lib/aws-bedrockagentcore";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3assets from "aws-cdk-lib/aws-s3-assets";
import type { Construct } from "constructs";

import { modelArns, type VerifiedProfileId } from "@aih/example-17-ai/infra/lib/models.ts";

import { bundleAgent, ENTRY_FILE } from "./bundle.ts";

export type AgentCoreStackProps = StackProps & { profileId: VerifiedProfileId };

/** A session with nothing to do ends after this long. Its memory is billed until then. */
export const IDLE_SESSION_TIMEOUT = Duration.minutes(5);
/** However busy, a session's microVM is replaced after this long. */
export const MAX_SESSION_LIFETIME = Duration.hours(1);
/** How long AgentCore Memory keeps an exchange. */
export const EVENT_EXPIRY_DAYS = 30;

export const INFERENCE_TIMEOUT = Duration.seconds(60);
export const MAX_OUTPUT_TOKENS = 600;
export const MAX_TURNS = 4;
export const MAX_TOTAL_TOKENS = 20_000;

export class AgentCoreStack extends Stack {
  constructor(scope: Construct, id: string, props: AgentCoreStackProps) {
    super(scope, id, props);

    // The table of chapter 05, and the notes the tools read.
    const notes = new dynamodb.Table(this, "Notes", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // #region users
    const users = new cognito.UserPool(this, "Users", {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      passwordPolicy: {
        minLength: 12,
        requireDigits: true,
        requireLowercase: true,
        requireUppercase: false,
        requireSymbols: false,
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const client = users.addClient("Cli", {
      generateSecret: false,
      // No authorization code flow, no hosted sign-in page: this client is not for a browser.
      disableOAuth: true,
      // Only an IAM identity of this account can sign a user in (AdminInitiateAuth). There
      // is no sign-in page and no password API open to the internet. A real app would
      // name chapter 06's client here instead.
      authFlows: { adminUserPassword: true, userSrp: false, userPassword: false, custom: false },
      accessTokenValidity: Duration.hours(1),
    });
    const issuer = `https://cognito-idp.${this.region}.amazonaws.com/${users.userPoolId}`;
    // #endregion users

    // #region memory
    // Short-term memory only: no strategy, so nothing is extracted and no model is called.
    const memory = new bedrockagentcore.CfnMemory(this, "Memory", {
      name: "AihAgentCoreSessions",
      description: "The exchanges of each session of the notes agent.",
      eventExpiryDuration: EVENT_EXPIRY_DAYS,
    });
    // #endregion memory

    // #region code
    const code = new s3assets.Asset(this, "AgentCode", {
      path: fileURLToPath(new URL("../../src", import.meta.url)),
      // The archive is named after what is in it, not after the sources it was built from.
      assetHashType: AssetHashType.OUTPUT,
      bundling: {
        // Never pulled: `tryBundle` always succeeds, so no container is started.
        image: DockerImage.fromRegistry("unused"),
        local: {
          tryBundle(outputDir) {
            bundleAgent(outputDir);
            return true;
          },
        },
      },
    });
    // #endregion code

    // #region role
    const role = new iam.Role(this, "AgentRole", {
      // Only AgentCore, and only for a resource of this account in this Region.
      assumedBy: new iam.ServicePrincipal("bedrock-agentcore.amazonaws.com", {
        conditions: {
          StringEquals: { "aws:SourceAccount": this.account },
          ArnLike: {
            "aws:SourceArn": `arn:${this.partition}:bedrock-agentcore:${this.region}:${this.account}:*`,
          },
        },
      }),
    });
    const runtimeLogs = `arn:${this.partition}:logs:${this.region}:${this.account}:log-group:/aws/bedrock-agentcore/runtimes/*`;
    // The statements the Runtime guide lists for an execution role, kept as narrow as it gives them.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["logs:CreateLogGroup", "logs:DescribeLogStreams"],
        resources: [runtimeLogs],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
        resources: [`${runtimeLogs}:log-stream:*`],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["logs:DescribeLogGroups"],
        resources: [`arn:${this.partition}:logs:${this.region}:${this.account}:log-group:*`],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["cloudwatch:PutMetricData"],
        // PutMetricData has no resource to name. The namespace is what narrows it.
        resources: ["*"],
        conditions: { StringEquals: { "cloudwatch:namespace": "bedrock-agentcore" } },
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [`arn:${this.partition}:s3:::${code.s3BucketName}/${code.s3ObjectKey}`],
      }),
    );

    const arns = modelArns(props.profileId, {
      partition: this.partition,
      region: this.region,
      account: this.account,
    });
    // As in chapters 17 and 36: one profile, and its models only by way of that profile.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModelWithResponseStream"],
        resources: [arns.profileArn],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModelWithResponseStream"],
        resources: arns.modelArns,
        conditions: { StringLike: { "bedrock:InferenceProfileArn": arns.profileArn } },
      }),
    );
    // Every session of every user runs as this one role. It can read any owner's notes and
    // any actor's events: which owner and which actor is decided in the agent's code.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:GetItem", "dynamodb:Query"],
        resources: [notes.tableArn],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["bedrock-agentcore:CreateEvent", "bedrock-agentcore:ListEvents"],
        resources: [memory.attrMemoryArn],
      }),
    );
    // #endregion role

    // #region runtime
    const runtime = new bedrockagentcore.CfnRuntime(this, "Runtime", {
      agentRuntimeName: "AihNotesAgent",
      description: "AWS in Your Hands chapter 50: chapter 36's loop behind the HTTP contract.",
      roleArn: role.roleArn,
      agentRuntimeArtifact: {
        codeConfiguration: {
          code: { s3: { bucket: code.s3BucketName, prefix: code.s3ObjectKey } },
          runtime: "NODE_22",
          entryPoint: [ENTRY_FILE],
        },
      },
      protocolConfiguration: "HTTP",
      // PUBLIC is about where the agent can call out to. Calling in still needs a token.
      networkConfiguration: { networkMode: "PUBLIC" },
      // A JWT from this user pool, issued to this client. Without this block the runtime
      // would take SigV4 instead, and the agent would not learn which user is asking.
      authorizerConfiguration: {
        customJwtAuthorizer: {
          discoveryUrl: `${issuer}/.well-known/openid-configuration`,
          allowedClients: [client.userPoolClientId],
        },
      },
      // The verified token is passed on, so the agent can read whose it is.
      requestHeaderConfiguration: { requestHeaderAllowlist: ["Authorization"] },
      lifecycleConfiguration: {
        idleRuntimeSessionTimeout: IDLE_SESSION_TIMEOUT.toSeconds(),
        maxLifetime: MAX_SESSION_LIFETIME.toSeconds(),
      },
      environmentVariables: {
        AI_BACKEND: "bedrock",
        BEDROCK_MODEL_ID: props.profileId,
        AGENT_REGION: this.region,
        NOTES_TABLE_NAME: notes.tableName,
        MEMORY_ID: memory.attrMemoryId,
        JWT_ISSUER: issuer,
        JWT_CLIENT_ID: client.userPoolClientId,
        MAX_OUTPUT_TOKENS: String(MAX_OUTPUT_TOKENS),
        MAX_TURNS: String(MAX_TURNS),
        MAX_TOTAL_TOKENS: String(MAX_TOTAL_TOKENS),
        INFERENCE_TIMEOUT_MS: String(INFERENCE_TIMEOUT.toMilliseconds()),
        LOG_LEVEL: "info",
      },
    });
    // The runtime is created with the role already able to do its work.
    runtime.node.addDependency(role);
    // #endregion runtime

    new CfnOutput(this, "RuntimeArn", { value: runtime.attrAgentRuntimeArn });
    new CfnOutput(this, "RuntimeId", { value: runtime.attrAgentRuntimeId });
    new CfnOutput(this, "MemoryId", { value: memory.attrMemoryId });
    new CfnOutput(this, "NotesTableName", { value: notes.tableName });
    new CfnOutput(this, "UserPoolId", { value: users.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: client.userPoolClientId });
    new CfnOutput(this, "ModelId", { value: props.profileId });
  }
}
