import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

import { TABLE_LIMIT } from "@aih/example-05-dynamodb/infra/lib/notes-stack.ts";

import { KEY_PREFIX } from "../../api/src/keys.ts";
import { PENDING, STATE_TAG } from "../../api/src/object-store.ts";

const LOCAL_SPA = "http://localhost:5173";

// Requests per second the API accepts, and how far a burst may go past it. Beyond that: 429.
const THROTTLE = { rate: 10, burst: 20 } as const;

// The stack of chapter 06 with one more bucket, one more policy statement,
// and four more routes. The regions below mark what is new.
export class UploadsStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    // SPA hosting, as in chapters 03 and 06.
    const content = new s3.Bucket(this, "Content", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const spaFallback = new cloudfront.Function(this, "SpaFallback", {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      // The very file chapter 06 deploys and tests.
      code: cloudfront.FunctionCode.fromFile({
        filePath: fileURLToPath(
          import.meta.resolve("@aih/example-06-auth/infra/functions/spa-fallback.js"),
        ),
      }),
      comment: "Answers client-side routes with the SPA's index.html",
    });
    const distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: "AWS in Your Hands chapter 07 notes app with uploads",
      defaultRootObject: "index.html",
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(content, {
          originAccessLevels: [cloudfront.AccessLevel.READ, cloudfront.AccessLevel.LIST],
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        compress: true,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        functionAssociations: [
          { function: spaFallback, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
        ],
      },
    });
    const spaOrigin = `https://${distribution.distributionDomainName}`;

    // #region uploads-bucket
    const uploads = new s3.Bucket(this, "Uploads", {
      // No bucket policy and no ACL can make an object public. Every read and
      // write goes through a signature made by this app's function.
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      cors: [
        {
          // The browser's upload is a cross-origin POST. Showing an image
          // with <img> needs no CORS rule, so GET is not listed.
          allowedOrigins: [spaOrigin, LOCAL_SPA],
          allowedMethods: [s3.HttpMethods.POST],
          maxAge: 3600,
        },
      ],
      lifecycleRules: [
        {
          id: "expire-unfinished-uploads",
          // Uploads arrive with this tag, and finishing one takes it off.
          tagFilters: { [STATE_TAG]: PENDING },
          expiration: Duration.days(1),
        },
        {
          // Nothing in this app starts a multipart upload. If something ever
          // does and gives up, its parts would be stored, and billed, forever.
          id: "abort-incomplete-multipart-uploads",
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
      ],
      // Exercise data: deleted with the stack, once emptied. Real uploads want RETAIN.
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion uploads-bucket

    const userPool = new cognito.UserPool(this, "Users", {
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
    // A different prefix from chapter 06's, so both stacks can exist at once.
    const domain = userPool.addDomain("Domain", {
      cognitoDomain: { domainPrefix: `aih-uploads-${this.account}` },
    });
    const client = userPool.addClient("Spa", {
      generateSecret: false,
      oAuth: {
        flows: { authorizationCodeGrant: true, implicitCodeGrant: false },
        scopes: [cognito.OAuthScope.OPENID],
        callbackUrls: [`${spaOrigin}/callback`, `${LOCAL_SPA}/callback`],
        logoutUrls: [`${spaOrigin}/`, `${LOCAL_SPA}/`],
      },
      authFlows: { userSrp: false, userPassword: false, adminUserPassword: false, custom: false },
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(1),
      enableTokenRevocation: true,
      preventUserExistenceErrors: true,
    });

    const table = new dynamodb.Table(this, "Notes", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      // Chapter 05's ceiling on request units per second. Past it DynamoDB throttles instead of billing.
      maxReadRequestUnits: TABLE_LIMIT.read,
      maxWriteRequestUnits: TABLE_LIMIT.write,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const logGroup = new logs.LogGroup(this, "HandlerLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const role = new iam.Role(this, "HandlerRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    logGroup.grantWrite(role);
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
        ],
        resources: [table.tableArn],
      }),
    );
    // #region uploads-role
    // A presigned URL or form can do no more than the role that signed it.
    // So this statement is also the outer limit of every permit the API hands out.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          // The browser's upload, which also sets a tag.
          "s3:PutObject",
          "s3:PutObjectTagging",
          // Finishing an upload takes the tag off.
          "s3:DeleteObjectTagging",
          // HeadObject, and the view URLs.
          "s3:GetObject",
          "s3:DeleteObject",
        ],
        resources: [uploads.arnForObjects(`${KEY_PREFIX}*`)],
      }),
    );
    // Not for listing: with this, HeadObject on a missing key answers 404
    // instead of 403, and the app can tell "not uploaded yet" from "not allowed".
    role.addToPolicy(
      new iam.PolicyStatement({ actions: ["s3:ListBucket"], resources: [uploads.bucketArn] }),
    );
    // #endregion uploads-role

    const handler = new nodejs.NodejsFunction(this, "Handler", {
      entry: fileURLToPath(new URL("../../api/src/lambda.ts", import.meta.url)),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      role,
      logGroup,
      environment: {
        ALLOWED_ORIGIN: spaOrigin,
        LOG_LEVEL: "info",
        STAGE: "dev",
        NOTES_STORE: "dynamodb",
        TABLE_NAME: table.tableName,
        USER_POOL_CLIENT_ID: client.userPoolClientId,
        UPLOADS_STORE: "s3",
        UPLOADS_BUCKET: uploads.bucketName,
      },
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
    });

    const issuer = `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`;
    const authorizer = new authorizers.HttpJwtAuthorizer("CognitoJwt", issuer, {
      jwtAudience: [client.userPoolClientId],
      identitySource: ["$request.header.Authorization"],
    });
    const api = new apigwv2.HttpApi(this, "Api", {
      description: "Notes API with image uploads (signed-in users only)",
      corsPreflight: {
        allowOrigins: [spaOrigin, LOCAL_SPA],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PUT,
          apigwv2.CorsHttpMethod.DELETE,
        ],
        allowHeaders: ["content-type", "authorization"],
        maxAge: Duration.hours(1),
      },
    });
    const integration = new integrations.HttpLambdaIntegration("Notes", handler);
    const signedIn = { integration, authorizer, authorizationScopes: ["openid"] };
    api.addRoutes({ path: "/health", methods: [apigwv2.HttpMethod.GET], integration });
    api.addRoutes({ path: "/me", methods: [apigwv2.HttpMethod.GET], ...signedIn });
    api.addRoutes({
      path: "/notes",
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      ...signedIn,
    });
    api.addRoutes({
      path: "/notes/{id}",
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.PUT, apigwv2.HttpMethod.DELETE],
      ...signedIn,
    });
    // #region routes
    // Asking for a permit needs a token. Using one does not: that request
    // goes to S3, not through here.
    api.addRoutes({
      path: "/notes/{id}/attachments",
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      ...signedIn,
    });
    api.addRoutes({
      path: "/notes/{id}/attachments/{attachmentId}",
      methods: [apigwv2.HttpMethod.PUT, apigwv2.HttpMethod.DELETE],
      ...signedIn,
    });
    // #endregion routes

    // #region throttle
    // On every route, /health included: the JWT check turns callers away but does not slow them down.
    const stage = api.defaultStage?.node.defaultChild as apigwv2.CfnStage;
    stage.defaultRouteSettings = {
      throttlingRateLimit: THROTTLE.rate,
      throttlingBurstLimit: THROTTLE.burst,
    };
    // #endregion throttle

    new CfnOutput(this, "ApiUrl", { value: api.apiEndpoint });
    new CfnOutput(this, "ContentBucketName", { value: content.bucketName });
    new CfnOutput(this, "UploadsBucketName", { value: uploads.bucketName });
    new CfnOutput(this, "DistributionId", { value: distribution.distributionId });
    new CfnOutput(this, "DistributionDomainName", { value: distribution.distributionDomainName });
    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: client.userPoolClientId });
    new CfnOutput(this, "Issuer", { value: issuer });
    new CfnOutput(this, "AuthDomain", { value: domain.baseUrl() });
    new CfnOutput(this, "TableName", { value: table.tableName });
    new CfnOutput(this, "HandlerLogGroupName", { value: logGroup.logGroupName });
  }
}
