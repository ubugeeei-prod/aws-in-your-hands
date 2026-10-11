import { fileURLToPath } from "node:url";
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

export class BookSiteStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    // #region bucket
    // Private. The only reader is the distribution below.
    const content = new s3.Bucket(this, "Content", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // Rebuildable from this repository, so it goes away with the stack.
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion bucket

    // #region rewrite
    const urlRewrite = new cloudfront.Function(this, "UrlRewrite", {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromFile({
        filePath: fileURLToPath(new URL("../functions/url-rewrite.js", import.meta.url)),
      }),
      comment: "Maps directory URLs of the static book to their index.html object",
    });
    // #endregion rewrite

    // #region distribution
    const distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: "AWS in Your Hands book site",
      defaultRootObject: "index.html",
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      // Price class 200 includes the Japan edge locations.
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(content),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        compress: true,
        // Per-object lifetime comes from the Cache-Control header set at publish time.
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        functionAssociations: [{ function: urlRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      // GetObject only, so S3 answers 403 for a missing key. Both codes become a real 404,
      // not a SPA fallback.
      errorResponses: [403, 404].map((httpStatus) => ({
        httpStatus,
        responseHttpStatus: 404,
        responsePagePath: "/404.html",
        ttl: Duration.seconds(60),
      })),
    });
    // #endregion distribution

    // #region outputs
    // The publish and smoke tasks read these from the cdkd state.
    new CfnOutput(this, "ContentBucketName", { value: content.bucketName });
    new CfnOutput(this, "DistributionId", { value: distribution.distributionId });
    new CfnOutput(this, "DistributionDomainName", { value: distribution.distributionDomainName });
    // #endregion outputs
  }
}
