import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";

import { TABLE_LIMIT } from "@aih/example-05-dynamodb/infra/lib/notes-stack.ts";

import type { MediaRegion } from "../../api/src/env.ts";

/** The built page, served by `vp run preview:calls:web`. The only origin that may call the API. */
export const LOCAL_PAGE = "http://localhost:4173";

const THROTTLE = { rate: 10, burst: 20 } as const;

export type CallsStackProps = StackProps & { mediaRegion: MediaRegion };

export class CallsStack extends Stack {
  constructor(scope: Construct, id: string, props: CallsStackProps) {
    super(scope, id, props);

    // Sign-in as in chapter 06: managed login, authorization code with PKCE, no self sign-up.
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
    const domain = userPool.addDomain("Domain", {
      cognitoDomain: { domainPrefix: `aih-calls-${this.account}` },
    });
    const client = userPool.addClient("Spa", {
      generateSecret: false,
      oAuth: {
        flows: { authorizationCodeGrant: true, implicitCodeGrant: false },
        scopes: [cognito.OAuthScope.OPENID],
        callbackUrls: [`${LOCAL_PAGE}/callback`],
        logoutUrls: [`${LOCAL_PAGE}/`],
      },
      authFlows: { userSrp: false, userPassword: false, adminUserPassword: false, custom: false },
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(1),
      enableTokenRevocation: true,
      preventUserExistenceErrors: true,
    });

    // The notes table of chapter 05. Rooms live in it too, under their own keys.
    const table = new dynamodb.Table(this, "Notes", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
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
    logGroup.grants.write(role);
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

    // #region chime-permissions
    // A meeting is not a CloudFormation resource: there is nothing to declare, only calls to
    // permit. CreateMeeting has no resource type in IAM, so "*" is the only resource it takes.
    role.addToPolicy(
      new iam.PolicyStatement({ actions: ["chime:CreateMeeting"], resources: ["*"] }),
    );
    // The rest act on a meeting, and are limited to meetings of this account in this Region.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "chime:GetMeeting",
          "chime:DeleteMeeting",
          "chime:CreateAttendee",
          "chime:DeleteAttendee",
        ],
        resources: [this.formatArn({ service: "chime", resource: "meeting", resourceName: "*" })],
      }),
    );
    // #endregion chime-permissions

    const handler = new nodejs.NodejsFunction(this, "Handler", {
      entry: fileURLToPath(new URL("../../api/src/lambda.ts", import.meta.url)),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      // One join makes several Chime calls in a row, and may go round three times.
      timeout: Duration.seconds(15),
      role,
      logGroup,
      environment: {
        ALLOWED_ORIGIN: LOCAL_PAGE,
        LOG_LEVEL: "info",
        STAGE: "dev",
        NOTES_STORE: "dynamodb",
        TABLE_NAME: table.tableName,
        USER_POOL_CLIENT_ID: client.userPoolClientId,
        MEETINGS: "chime",
        MEDIA_REGION: props.mediaRegion,
      },
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
      description: "Notes API with rooms (signed-in users only)",
      corsPreflight: {
        allowOrigins: [LOCAL_PAGE],
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
    const { GET, POST, PUT, DELETE } = apigwv2.HttpMethod;
    api.addRoutes({ path: "/health", methods: [GET], integration });
    api.addRoutes({ path: "/me", methods: [GET], ...signedIn });
    api.addRoutes({ path: "/notes", methods: [GET, POST], ...signedIn });
    api.addRoutes({ path: "/notes/{id}", methods: [GET, PUT, DELETE], ...signedIn });
    // #region routes
    // Every room route sits behind the JWT authorizer. None is public, and none has a
    // catch-all: a path that is not listed here never reaches the function.
    api.addRoutes({ path: "/rooms", methods: [POST], ...signedIn });
    api.addRoutes({ path: "/rooms/{id}", methods: [GET, DELETE], ...signedIn });
    api.addRoutes({ path: "/rooms/{id}/members/{sub}", methods: [PUT, DELETE], ...signedIn });
    api.addRoutes({ path: "/rooms/{id}/join", methods: [POST], ...signedIn });
    api.addRoutes({ path: "/rooms/{id}/leave", methods: [POST], ...signedIn });
    // #endregion routes

    // Chime's own default is 10 CreateAttendee calls a second for the account. This stays under it.
    const stage = api.defaultStage?.node.defaultChild as apigwv2.CfnStage;
    stage.defaultRouteSettings = {
      throttlingRateLimit: THROTTLE.rate,
      throttlingBurstLimit: THROTTLE.burst,
    };

    new CfnOutput(this, "ApiUrl", { value: api.apiEndpoint });
    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: client.userPoolClientId });
    new CfnOutput(this, "Issuer", { value: issuer });
    new CfnOutput(this, "AuthDomain", { value: domain.baseUrl() });
    new CfnOutput(this, "TableName", { value: table.tableName });
    new CfnOutput(this, "HandlerLogGroupName", { value: logGroup.logGroupName });
    new CfnOutput(this, "MediaRegion", { value: props.mediaRegion });
  }
}
