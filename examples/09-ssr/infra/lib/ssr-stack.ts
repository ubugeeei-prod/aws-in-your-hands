import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";
import * as v from "valibot";

import { SHARED_SECONDS } from "../../core/cache-control.ts";
import { ASSET_PATH_PATTERN, PERSONAL_PATH_PATTERNS } from "../../core/routes.ts";

// #region reserved
// Off unless asked for. Reserving takes N out of the account's concurrency, and an account
// with a low limit refuses the deploy.
const WHOLE_NUMBER = "must be a whole number such as 5";

export const reservedConcurrencySchema = v.optional(
  v.pipe(
    // Context given with `-c` arrives as text. Number() turns "many" into NaN, which v.number refuses.
    v.union([v.number(), v.pipe(v.string(), v.transform(Number))], WHOLE_NUMBER),
    v.number(WHOLE_NUMBER),
    v.integer(WHOLE_NUMBER),
    v.minValue(1, "must be 1 or more: 0 would stop the site"),
    v.maxValue(1000),
  ),
);
// #endregion reserved

export type SsrStackProps = StackProps & {
  /** The directory `nuxt build` wrote the Lambda handler to (.output/server). */
  serverDir: string;
  /** Which handler that build contains, read from .output/nitro.json. */
  responseStreaming: boolean;
  /** At most this many requests render at once. From `-c reservedConcurrency=N`. */
  reservedConcurrency?: unknown;
};

export class SsrStack extends Stack {
  constructor(scope: Construct, id: string, props: SsrStackProps) {
    super(scope, id, props);
    const reservedConcurrency = v.parse(reservedConcurrencySchema, props.reservedConcurrency);

    // #region assets
    const assets = new s3.Bucket(this, "Assets", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // Rebuildable from source, so it goes with the stack.
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion assets

    // #region function
    const logGroup = new logs.LogGroup(this, "ServerLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const role = new iam.Role(this, "ServerRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    logGroup.grants.write(role);

    const server = new lambda.Function(this, "Server", {
      // Already bundled by Nitro, node_modules included. CDK only zips it.
      code: lambda.Code.fromAsset(props.serverDir),
      handler: "index.handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      // CloudFront waits 30 seconds for an origin by default. Give up well before that.
      timeout: Duration.seconds(10),
      role,
      logGroup,
      environment: { STAGE: "dev", AIH_SSR_SIGN_IN: "off" },
      // The one bound on cache misses. Past it, Lambda throttles and CloudFront answers with an error.
      ...(reservedConcurrency === undefined
        ? {}
        : { reservedConcurrentExecutions: reservedConcurrency }),
    });
    // #endregion function

    // #region url
    const url = server.addFunctionUrl({
      // Unsigned requests are refused by Lambda before the function runs.
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
      // Follows the handler that the build produced, so the two are never set apart by hand.
      invokeMode: props.responseStreaming
        ? lambda.InvokeMode.RESPONSE_STREAM
        : lambda.InvokeMode.BUFFERED,
    });
    // CloudFront signs each origin request, and the function's policy admits this distribution only.
    const serverOrigin = origins.FunctionUrlOrigin.withOriginAccessControl(url);
    // #endregion url

    // #region public-policy
    const publicPages = new cloudfront.CachePolicy(this, "PublicPages", {
      comment:
        "Public SSR pages: cached only when the origin says so, never keyed or varied by cookie",
      // 0, so that `private, no-store` from the origin is obeyed. Above 0, CloudFront caches anyway.
      minTtl: Duration.seconds(0),
      // 0, so that a response with no Cache-Control at all is not cached.
      defaultTtl: Duration.seconds(0),
      // A ceiling on whatever the application asks for.
      maxTtl: Duration.seconds(SHARED_SECONDS),
      // Not in the cache key, and therefore not sent to the origin either.
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
      // No page reads a query string. In the key, `?x=<random>` would make every request a miss.
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    const publicHeaders = new cloudfront.ResponseHeadersPolicy(this, "PublicHeaders", {
      comment: "Security headers, and no Set-Cookie on anything that may be shared",
      // A cached Set-Cookie would be replayed to every reader of the page.
      removeHeaders: ["Set-Cookie"],
      securityHeadersBehavior: {
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.SAMEORIGIN, override: true },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        strictTransportSecurity: { accessControlMaxAge: Duration.days(365), override: true },
      },
    });
    // #endregion public-policy

    // #region personal
    const personal: cloudfront.BehaviorOptions = {
      origin: serverOrigin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      // With origin access control, a POST needs a body hash that browsers do not send.
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      // Nothing under /me is ever stored, whatever headers the application sends.
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      // Cookies reach the function on these paths, and only on these.
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
    };
    // #endregion personal

    // #region distribution
    const distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: "AWS in Your Hands chapter 09 regional SSR",
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      defaultBehavior: {
        origin: serverOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        compress: true,
        cachePolicy: publicPages,
        responseHeadersPolicy: publicHeaders,
      },
      additionalBehaviors: {
        [ASSET_PATH_PATTERN]: {
          // LIST lets S3 answer 404 for a missing file. With READ alone it answers 403.
          origin: origins.S3BucketOrigin.withOriginAccessControl(assets, {
            originAccessLevels: [cloudfront.AccessLevel.READ, cloudfront.AccessLevel.LIST],
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          compress: true,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        },
        ...Object.fromEntries(PERSONAL_PATH_PATTERNS.map((pattern) => [pattern, personal])),
      },
    });
    // #endregion distribution

    new CfnOutput(this, "ContentBucketName", { value: assets.bucketName });
    new CfnOutput(this, "DistributionId", { value: distribution.distributionId });
    new CfnOutput(this, "DistributionDomainName", { value: distribution.distributionDomainName });
    // Printed so that the smoke test can confirm it does not answer.
    new CfnOutput(this, "ServerFunctionUrl", { value: url.url });
    new CfnOutput(this, "ServerLogGroupName", { value: logGroup.logGroupName });
  }
}
