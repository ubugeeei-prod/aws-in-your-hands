import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { CorsHttpMethod, HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import { OAuthScope, UserPool } from "aws-cdk-lib/aws-cognito";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

import { KEY_PREFIX } from "../../api/src/keys.ts";
import { PENDING, STATE_TAG } from "../../api/src/object-store.ts";

const LOCAL_SPA = "http://localhost:5173";

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

    const userPool = new UserPool(this, "Users", {
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
        scopes: [OAuthScope.OPENID],
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

    const table = new Table(this, "Notes", {
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "sk", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const logGroup = new LogGroup(this, "HandlerLogs", {
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const role = new Role(this, "HandlerRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
    });
    logGroup.grantWrite(role);
    role.addToPolicy(
      new PolicyStatement({
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
      new PolicyStatement({
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
      new PolicyStatement({ actions: ["s3:ListBucket"], resources: [uploads.bucketArn] }),
    );
    // #endregion uploads-role

    const handler = new NodejsFunction(this, "Handler", {
      entry: fileURLToPath(new URL("../../api/src/lambda.ts", import.meta.url)),
      handler: "handler",
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
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
        format: OutputFormat.ESM,
        target: "node24",
        minify: false,
        sourceMap: false,
        externalModules: [],
        banner:
          "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
    });

    const issuer = `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`;
    const authorizer = new HttpJwtAuthorizer("CognitoJwt", issuer, {
      jwtAudience: [client.userPoolClientId],
      identitySource: ["$request.header.Authorization"],
    });
    const api = new HttpApi(this, "Api", {
      description: "Notes API with image uploads (signed-in users only)",
      corsPreflight: {
        allowOrigins: [spaOrigin, LOCAL_SPA],
        allowMethods: [
          CorsHttpMethod.GET,
          CorsHttpMethod.POST,
          CorsHttpMethod.PUT,
          CorsHttpMethod.DELETE,
        ],
        allowHeaders: ["content-type", "authorization"],
        maxAge: Duration.hours(1),
      },
    });
    const integration = new HttpLambdaIntegration("Notes", handler);
    const signedIn = { integration, authorizer, authorizationScopes: ["openid"] };
    api.addRoutes({ path: "/health", methods: [HttpMethod.GET], integration });
    api.addRoutes({ path: "/me", methods: [HttpMethod.GET], ...signedIn });
    api.addRoutes({ path: "/notes", methods: [HttpMethod.GET, HttpMethod.POST], ...signedIn });
    api.addRoutes({
      path: "/notes/{id}",
      methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE],
      ...signedIn,
    });
    // #region routes
    // Asking for a permit needs a token. Using one does not: that request
    // goes to S3, not through here.
    api.addRoutes({
      path: "/notes/{id}/attachments",
      methods: [HttpMethod.GET, HttpMethod.POST],
      ...signedIn,
    });
    api.addRoutes({
      path: "/notes/{id}/attachments/{attachmentId}",
      methods: [HttpMethod.PUT, HttpMethod.DELETE],
      ...signedIn,
    });
    // #endregion routes

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
