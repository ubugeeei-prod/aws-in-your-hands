import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as bedrock from "aws-cdk-lib/aws-bedrock";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";

import { modelArns, type VerifiedProfileId } from "@aih/example-17-ai/infra/lib/models.ts";

import {
  APAC_GUARDRAIL_PROFILE,
  guardrailProfileArns,
  type PromptAttackFilter,
} from "./guardrail.ts";

export type BedrockStackProps = StackProps & {
  profileId: VerifiedProfileId;
  /** "standard" adds the prompt attack filter, and with it evaluation outside Japan. */
  promptAttackFilter: PromptAttackFilter;
};

/** The loop gives up after this long. The function must outlive it to say so. */
export const INFERENCE_TIMEOUT = Duration.seconds(60);
export const MAX_OUTPUT_TOKENS = 600;
export const MAX_TURNS = 4;
export const MAX_TOTAL_TOKENS = 20_000;
/** USD 0.50 per owner per UTC day, in millionths of a dollar. */
export const DAILY_BUDGET_MICRO_USD = 500_000;

export class BedrockStack extends Stack {
  constructor(scope: Construct, id: string, props: BedrockStackProps) {
    super(scope, id, props);

    // The table of chapter 05, and the notes the tools read.
    const notes = new dynamodb.Table(this, "Notes", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // #region usage-table
    // One item per owner per day: what that owner has spent on inference.
    const usage = new dynamodb.Table(this, "Usage", {
      partitionKey: { name: "owner", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "day", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expiresAt",
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion usage-table

    // #region guardrail
    const standard = props.promptAttackFilter === "standard";
    const guardrail = new bedrock.CfnGuardrail(this, "Guardrail", {
      name: `${id}-assistant`,
      description: "Keeps credentials out of the assistant's answers.",
      blockedInputMessaging: "この質問にはお答えできません。",
      blockedOutputsMessaging: "この回答は表示できません。",
      // A note may hold a pasted key. The assistant must not repeat one, in a question or an answer.
      sensitiveInformationPolicyConfig: {
        piiEntitiesConfig: [
          { type: "AWS_ACCESS_KEY", action: "BLOCK" },
          { type: "AWS_SECRET_KEY", action: "BLOCK" },
        ],
      },
      ...(standard
        ? {
            // The Classic tier covers English, French and Spanish. Japanese needs Standard,
            // and Standard runs through a guardrail profile that spans Regions.
            contentPolicyConfig: {
              filtersConfig: [
                { type: "PROMPT_ATTACK", inputStrength: "HIGH", outputStrength: "NONE" },
              ],
              contentFiltersTierConfig: { tierName: "STANDARD" },
            },
            crossRegionConfig: {
              guardrailProfileArn: `arn:${this.partition}:bedrock:${this.region}:${this.account}:guardrail-profile/${APAC_GUARDRAIL_PROFILE.id}`,
            },
          }
        : {}),
    });
    // A call names a numbered version, never the working draft: the draft changes under it.
    const version = new bedrock.CfnGuardrailVersion(this, "GuardrailRelease", {
      guardrailIdentifier: guardrail.attrGuardrailId,
      description: "The version the function calls.",
    });
    // #endregion guardrail

    const logGroup = new logs.LogGroup(this, "HandlerLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // #region role
    const role = new iam.Role(this, "HandlerRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    logGroup.grants.write(role);

    const arns = modelArns(props.profileId, {
      partition: this.partition,
      region: this.region,
      account: this.account,
    });
    // As in chapter 17: one profile, and its models only by way of that profile.
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
    // A call that names a guardrail is refused unless the caller may apply that guardrail.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:ApplyGuardrail"],
        resources: [
          guardrail.attrGuardrailArn,
          ...(standard
            ? guardrailProfileArns({ partition: this.partition, account: this.account })
            : []),
        ],
      }),
    );
    // The tools read notes. Nothing the model can ask for writes one.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:GetItem", "dynamodb:Query"],
        resources: [notes.tableArn],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
        resources: [usage.tableArn],
      }),
    );
    // #endregion role

    // #region function
    const handler = new nodejs.NodejsFunction(this, "Handler", {
      entry: fileURLToPath(new URL("../../src/lambda.ts", import.meta.url)),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      // The hard stop behind the loop's own deadline.
      timeout: INFERENCE_TIMEOUT.plus(Duration.seconds(10)),
      role,
      logGroup,
      environment: {
        AI_BACKEND: "bedrock",
        // The only place the deployed code learns which model it calls.
        BEDROCK_MODEL_ID: props.profileId,
        GUARDRAIL_ID: guardrail.attrGuardrailId,
        GUARDRAIL_VERSION: version.attrVersion,
        NOTES_TABLE_NAME: notes.tableName,
        USAGE_TABLE_NAME: usage.tableName,
        MAX_OUTPUT_TOKENS: String(MAX_OUTPUT_TOKENS),
        MAX_TURNS: String(MAX_TURNS),
        MAX_TOTAL_TOKENS: String(MAX_TOTAL_TOKENS),
        INFERENCE_TIMEOUT_MS: String(INFERENCE_TIMEOUT.toMilliseconds()),
        DAILY_BUDGET_MICRO_USD: String(DAILY_BUDGET_MICRO_USD),
        PROMPT_CACHE: "on",
        LOG_LEVEL: "info",
        STAGE: "dev",
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

    const url = handler.addFunctionUrl({
      // Lambda checks the signature before the function runs, and tells the function who signed.
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
    });
    // #endregion function

    new CfnOutput(this, "FunctionUrl", { value: url.url });
    new CfnOutput(this, "HandlerLogGroupName", { value: logGroup.logGroupName });
    new CfnOutput(this, "NotesTableName", { value: notes.tableName });
    new CfnOutput(this, "UsageTableName", { value: usage.tableName });
    new CfnOutput(this, "GuardrailId", { value: guardrail.attrGuardrailId });
    new CfnOutput(this, "GuardrailVersion", { value: version.attrVersion });
    new CfnOutput(this, "ModelId", { value: props.profileId });
  }
}
