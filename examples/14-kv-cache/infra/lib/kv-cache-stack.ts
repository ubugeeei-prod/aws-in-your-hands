import { fileURLToPath } from "node:url";
import { ArnFormat, CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { CfnServerlessCache } from "aws-cdk-lib/aws-elasticache";
import { PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";
import { TTL_ATTRIBUTE } from "../../src/dynamodb-store.ts";

export type KvCacheStackProps = StackProps & {
  /** `dynamodb` creates nothing that is billed while idle. `valkey` adds an ElastiCache Serverless cache, which is. */
  store: "dynamodb" | "valkey";
};

// ElastiCache creates these two in every account; every user in the group authenticates with IAM.
const IAM_USER_GROUP = "default.iam-user-group";
const IAM_USER = "default.iam-user";
const CACHE_NAME = "aih-kv-cache";

export class KvCacheStack extends Stack {
  constructor(scope: Construct, id: string, props: KvCacheStackProps) {
    super(scope, id, props);

    // #region table
    const table = new Table(this, "Store", {
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "sk", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      // DynamoDB deletes items some time after this Unix-seconds attribute has passed.
      timeToLiveAttribute: TTL_ATTRIBUTE,
      // Counters and cached copies: nothing here is worth keeping.
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion table

    const logGroup = new LogGroup(this, "HandlerLogs", {
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // #region role
    const role = new Role(this, "HandlerRole", { assumedBy: new ServicePrincipal("lambda.amazonaws.com") });
    logGroup.grantWrite(role);
    // The four calls the stores make. No Query, no Scan.
    role.addToPolicy(
      new PolicyStatement({
        actions: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem"],
        resources: [table.tableArn],
      }),
    );
    // #endregion role

    const environment: Record<string, string> = {
      LOG_LEVEL: "info",
      STAGE: "dev",
      RATE_LIMIT: "5",
      RATE_WINDOW_SECONDS: "60",
      RATE_ALGORITHM: "fixed",
      RATE_ON_ERROR: "allow",
      CACHE_TTL_SECONDS: "30",
      SOURCE_DELAY_MS: "300",
      KV_STORE: "dynamodb",
      TABLE_NAME: table.tableName,
    };

    // #region valkey
    if (props.store === "valkey") {
      // Billed from the moment it is available until it is deleted, requests or not.
      const cache = new CfnServerlessCache(this, "Valkey", {
        serverlessCacheName: CACHE_NAME,
        description: "AWS in Your Hands chapter 14: rate limit counters and a list cache",
        engine: "valkey",
        // Public endpoints need Valkey 9.0 or later.
        majorEngineVersion: "9",
        // Reachable from the internet, so the function needs no VPC. Every
        // connection must present an IAM token over TLS 1.3.
        connectionType: "public",
        userGroupId: IAM_USER_GROUP,
        // A ceiling on what a mistake or an attack can cost. Past it, ElastiCache evicts and throttles.
        cacheUsageLimits: { dataStorage: { maximum: 1, unit: "GB" }, ecpuPerSecond: { maximum: 1000 } },
      });
      // No final snapshot is named, so nothing outlives the stack.
      cache.applyRemovalPolicy(RemovalPolicy.DESTROY);

      role.addToPolicy(
        new PolicyStatement({
          actions: ["elasticache:Connect"],
          // Both are required: which cache, and as which ElastiCache user.
          resources: [
            cache.attrArn,
            this.formatArn({
              service: "elasticache",
              resource: "user",
              resourceName: IAM_USER,
              arnFormat: ArnFormat.COLON_RESOURCE_NAME,
            }),
          ],
        }),
      );

      Object.assign(environment, {
        KV_STORE: "elasticache",
        VALKEY_ENDPOINT: cache.attrEndpointAddress,
        VALKEY_PORT: cache.attrEndpointPort,
        VALKEY_CACHE_NAME: CACHE_NAME,
        VALKEY_USER: IAM_USER,
      });
      new CfnOutput(this, "ValkeyEndpoint", { value: cache.attrEndpointAddress });
    }
    // #endregion valkey

    const handler = new NodejsFunction(this, "Handler", {
      entry: fileURLToPath(new URL("../../src/lambda.ts", import.meta.url)),
      handler: "handler",
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      role,
      logGroup,
      environment,
      bundling: {
        // iovalkey is CommonJS and calls require() for Node's own modules.
        format: OutputFormat.CJS,
        target: "node24",
        minify: false,
        sourceMap: false,
        // Bundle the AWS SDK too, so the function runs the version in pnpm-lock.yaml.
        externalModules: [],
      },
    });

    const api = new HttpApi(this, "Api", { description: "Items API with a rate limit and a cache" });
    const integration = new HttpLambdaIntegration("Items", handler);
    api.addRoutes({ path: "/health", methods: [HttpMethod.GET], integration });
    api.addRoutes({ path: "/items", methods: [HttpMethod.GET], integration });

    new CfnOutput(this, "ApiUrl", { value: api.apiEndpoint });
    new CfnOutput(this, "TableName", { value: table.tableName });
    new CfnOutput(this, "HandlerLogGroupName", { value: logGroup.logGroupName });
  }
}
