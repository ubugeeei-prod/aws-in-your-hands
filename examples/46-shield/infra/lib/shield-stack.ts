import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";

import { SHARED_CACHE } from "../../src/defences.ts";

export type ShieldStackProps = StackProps & {
  allowedOrigin: string;
  webAclArn?: string | undefined;
  reservedConcurrency?: number | undefined;
};

export class ShieldStack extends Stack {
  constructor(scope: Construct, id: string, props: ShieldStackProps) {
    super(scope, id, props);

    const logGroup = new logs.LogGroup(this, "HandlerLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const role = new iam.Role(this, "HandlerRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    logGroup.grants.write(role);

    // #region function
    const handler = new nodejs.NodejsFunction(this, "Handler", {
      entry: fileURLToPath(new URL("../../src/lambda.ts", import.meta.url)),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      role,
      logGroup,
      // The brake. Past ten requests a second for each unit, the function URL answers 429
      // and nothing runs. Without it the bound is the account's whole concurrency.
      ...(props.reservedConcurrency === undefined
        ? {}
        : { reservedConcurrentExecutions: props.reservedConcurrency }),
      environment: {
        ALLOWED_ORIGIN: props.allowedOrigin,
        LOG_LEVEL: "info",
        STAGE: "dev",
      },
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: "node24",
        minify: false,
        sourceMap: false,
        externalModules: [],
      },
    });
    // #endregion function

    // #region origin
    const url = handler.addFunctionUrl({
      // An unsigned request is refused by Lambda before the function runs. Only this
      // distribution may sign: the permission CDK adds names its ARN.
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
    });
    const origin = origins.FunctionUrlOrigin.withOriginAccessControl(url);
    // #endregion origin

    // #region distribution
    const behavior = {
      origin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
      // GET and HEAD only: with origin access control, a body would need a hash the caller has to send.
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
    };
    const distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: "AWS in Your Hands chapter 46 notes API",
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      ...(props.webAclArn === undefined ? {} : { webAclId: props.webAclArn }),
      // Notes differ by caller once there is sign-in. Nothing here is kept at the edge.
      defaultBehavior: { ...behavior, cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED },
      additionalBehaviors: {
        // The same answer for everyone. The key has no query string, header or cookie in it,
        // so `?x=1`, `?x=2`, ... are one object, and the function decides how long it lives.
        [SHARED_CACHE.path]: {
          ...behavior,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          // What reaches the origin is as plain as the key, or two callers could fill it differently.
          originRequestPolicy: undefined,
        },
      },
    });
    // #endregion distribution

    new CfnOutput(this, "Url", { value: `https://${distribution.distributionDomainName}` });
    new CfnOutput(this, "DistributionId", { value: distribution.distributionId });
    new CfnOutput(this, "DistributionArn", { value: distribution.distributionArn });
    // Printed so that the deploy page can show it refusing a direct request.
    new CfnOutput(this, "FunctionUrl", { value: url.url });
    new CfnOutput(this, "FunctionName", { value: handler.functionName });
    new CfnOutput(this, "HandlerLogGroupName", { value: logGroup.logGroupName });
  }
}
