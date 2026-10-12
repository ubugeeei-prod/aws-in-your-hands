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

/** Registered so that a local SPA can sign in against the deployed user pool. */
const LOCAL_SPA = "http://localhost:5173";

export class NotesAppStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    // SPA hosting, as in chapter 03.
    const content = new s3.Bucket(this, "Content", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const spaFallback = new cloudfront.Function(this, "SpaFallback", {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromFile({
        filePath: fileURLToPath(new URL("../functions/spa-fallback.js", import.meta.url)),
      }),
      comment: "Answers client-side routes with the SPA's index.html",
    });
    const distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: "AWS in Your Hands chapter 06 notes app",
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

    // #region user-pool
    const userPool = new cognito.UserPool(this, "Users", {
      // Open sign-up would let strangers in and send sign-up emails in your
      // name. Users are created by `vp run app:user:create`.
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
      // Exercise data: deleted with the stack, users included.
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Cognito serves the sign-in page here. The password never passes through this app's code.
    const domain = userPool.addDomain("Domain", {
      cognitoDomain: { domainPrefix: `aih-notes-${this.account}` },
    });
    // #endregion user-pool

    // #region client
    const client = userPool.addClient("Spa", {
      // A browser app cannot keep a secret. PKCE takes its place.
      generateSecret: false,
      oAuth: {
        flows: { authorizationCodeGrant: true, implicitCodeGrant: false },
        scopes: [cognito.OAuthScope.OPENID],
        callbackUrls: [`${spaOrigin}/callback`, `${LOCAL_SPA}/callback`],
        logoutUrls: [`${spaOrigin}/`, `${LOCAL_SPA}/`],
      },
      // No direct password APIs: the only way in is the redirect to managed login.
      authFlows: { userSrp: false, userPassword: false, adminUserPassword: false, custom: false },
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(1),
      // API Gateway does not ask Cognito, so a revoked access token still
      // passes the JWT authorizer until it expires.
      enableTokenRevocation: true,
      preventUserExistenceErrors: true,
    });
    // #endregion client

    // The table of chapter 05.
    const table = new dynamodb.Table(this, "Notes", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
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

    // #region authorizer
    const issuer = `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`;
    // Checked before the function is invoked: signature, issuer, expiry, and
    // this app client as the audience.
    const authorizer = new authorizers.HttpJwtAuthorizer("CognitoJwt", issuer, {
      jwtAudience: [client.userPoolClientId],
      identitySource: ["$request.header.Authorization"],
    });

    const api = new apigwv2.HttpApi(this, "Api", {
      description: "Notes API (signed-in users only)",
      corsPreflight: {
        // Two fixed origins, never "*".
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
    // An ID token has no scope claim, so requiring one keeps ID tokens out here.
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
    // #endregion authorizer

    new CfnOutput(this, "ApiUrl", { value: api.apiEndpoint });
    new CfnOutput(this, "ContentBucketName", { value: content.bucketName });
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
