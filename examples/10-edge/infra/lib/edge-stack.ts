import { fileURLToPath } from "node:url";

import { CfnOutput, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";
import { z } from "zod";

// #region props
// Lambda@Edge takes a numbered version in us-east-1. $LATEST and aliases are refused, so they are refused here first.
export const bodyDigestVersionArnSchema = z
  .string()
  .regex(
    /^arn:aws:lambda:us-east-1:\d{12}:function:[A-Za-z0-9-_]+:\d+$/,
    "must be a numbered function version in us-east-1, such as arn:aws:lambda:us-east-1:123456789012:function:name:1",
  )
  .optional();

export type EdgeStackProps = StackProps & { bodyDigestVersionArn?: string | undefined };
// #endregion props

export class EdgeStack extends Stack {
  constructor(scope: Construct, id: string, props: EdgeStackProps) {
    super(scope, id, props);
    const bodyDigestVersionArn = bodyDigestVersionArnSchema.parse(props.bodyDigestVersionArn);

    const content = new s3.Bucket(this, "Content", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // #region store
    // Created empty. The pairs belong to edge-data.json and the sync script, not to this stack:
    // an import source is read once at creation, and changing it would replace the store.
    const edgeData = new cloudfront.KeyValueStore(this, "EdgeData", {
      comment: "Flags and redirects read by the chapter 10 edge router",
    });
    // The pairs can be rebuilt from edge-data.json, so the store goes with the stack.
    edgeData.applyRemovalPolicy(RemovalPolicy.DESTROY);
    // #endregion store

    // #region router
    const router = new cloudfront.Function(this, "EdgeRouter", {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromFile({
        filePath: fileURLToPath(new URL("../functions/edge-router.js", import.meta.url)),
      }),
      keyValueStore: edgeData,
      comment: "Maintenance switch, redirects, and a feature flag from KeyValueStore",
    });
    const viewerRequest = [
      { function: router, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
    ];
    // #endregion router

    const origin = origins.S3BucketOrigin.withOriginAccessControl(content, {
      originAccessLevels: [cloudfront.AccessLevel.READ, cloudfront.AccessLevel.LIST],
    });

    // #region distribution
    const distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: "AWS in Your Hands chapter 10 edge functions",
      // The router already rewrites "/". This is the backstop: with LIST granted, a bare "/" at S3 lists the bucket.
      defaultRootObject: "index.html",
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      defaultBehavior: {
        origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        compress: true,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        functionAssociations: viewerRequest,
      },
    });
    // #endregion distribution

    // #region digest
    if (bodyDigestVersionArn !== undefined) {
      distribution.addBehavior("/digest", origin, {
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        // POST exists only inside "all methods". The router refuses the other six before Lambda@Edge runs.
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        // Nothing is cached, so every POST that gets past the router is one Lambda@Edge invocation.
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        // A CloudFront Function on the viewer side and Lambda@Edge on the origin side may share a behavior.
        functionAssociations: viewerRequest,
        edgeLambdas: [
          {
            functionVersion: lambda.Version.fromVersionArn(
              this,
              "BodyDigestVersion",
              bodyDigestVersionArn,
            ),
            eventType: cloudfront.LambdaEdgeEventType.ORIGIN_REQUEST,
            includeBody: true,
          },
        ],
      });
    }
    // #endregion digest

    new CfnOutput(this, "ContentBucketName", { value: content.bucketName });
    new CfnOutput(this, "DistributionId", { value: distribution.distributionId });
    new CfnOutput(this, "DistributionDomainName", { value: distribution.distributionDomainName });
    new CfnOutput(this, "KeyValueStoreArn", { value: edgeData.keyValueStoreArn });
  }
}
