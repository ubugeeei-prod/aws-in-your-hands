import { fileURLToPath } from "node:url";
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import { FunctionUrlOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { PolicyDocument, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import { Architecture, FunctionUrlAuthType, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";

export type SecurityStackProps = StackProps & {
  /** A CLOUDFRONT-scope web ACL from AihSecurityWaf. Without it, no AWS WAF charge exists. */
  webAclArn?: string | undefined;
  /** Adds a customer managed KMS key, billed by the month for as long as it exists. */
  customerManagedKey: boolean;
};

export class SecurityStack extends Stack {
  constructor(scope: Construct, id: string, props: SecurityStackProps) {
    super(scope, id, props);

    // #region key
    // Off by default: aws/secretsmanager has no monthly fee. A key of your own does.
    const key = props.customerManagedKey
      ? new Key(this, "SecretKey", {
          description: "AWS in Your Hands chapter 21: encrypts the token signing secret",
          enableKeyRotation: true,
          // The shortest wait KMS allows before a key is gone for good.
          pendingWindow: Duration.days(7),
          removalPolicy: RemovalPolicy.DESTROY,
        })
      : undefined;
    // #endregion key

    // #region secret
    const secret = new Secret(this, "SigningKey", {
      description: "AWS in Your Hands chapter 21: HMAC key for the token API",
      // The value is generated at deploy time. It is in no file, no template, and no environment variable.
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ purpose: "aih-token-signing" }),
        generateStringKey: "key",
        passwordLength: 64,
        excludePunctuation: true,
      },
      ...(key === undefined ? {} : { encryptionKey: key }),
      // A practice key: nothing was signed with it that must outlive the stack.
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion secret

    const logGroup = new LogGroup(this, "HandlerLogs", {
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // #region role
    const statements = [
      new PolicyStatement({
        sid: "WriteOwnLogs",
        actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
        resources: [logGroup.logGroupArn],
      }),
      // One action on one secret. Not secretsmanager:*, and not every secret in the account.
      new PolicyStatement({
        sid: "ReadSigningKey",
        actions: ["secretsmanager:GetSecretValue"],
        resources: [secret.secretArn],
      }),
    ];
    if (key !== undefined) {
      statements.push(
        new PolicyStatement({
          sid: "DecryptThroughSecretsManager",
          actions: ["kms:Decrypt"],
          resources: [key.keyArn],
          // Only as part of a Secrets Manager call. The role cannot use the key directly.
          conditions: { StringEquals: { "kms:ViaService": `secretsmanager.${this.region}.amazonaws.com` } },
        }),
      );
    }
    const role = new Role(this, "HandlerRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      // Inline, so the lint in src/iam-lint.ts reads the whole permission set off one resource.
      inlinePolicies: { Handler: new PolicyDocument({ statements }) },
    });
    // #endregion role

    // #region function
    const handler = new NodejsFunction(this, "Handler", {
      entry: fileURLToPath(new URL("../../src/lambda.ts", import.meta.url)),
      handler: "handler",
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      role,
      logGroup,
      environment: {
        LOG_LEVEL: "info",
        STAGE: "dev",
        SECRET_SOURCE: "secretsmanager",
        // Where the secret is. Anyone who can read the function's configuration sees this, and that is fine.
        SECRET_ID: secret.secretArn,
        TOKEN_TTL_SECONDS: "300",
        KEY_CACHE_SECONDS: "300",
        KEY_REFRESH_MIN_SECONDS: "30",
      },
      bundling: {
        format: OutputFormat.ESM,
        target: "node24",
        minify: false,
        sourceMap: false,
        // Bundle the AWS SDK too, so the function runs the version in pnpm-lock.yaml.
        externalModules: [],
        // The bundled SDK still calls require() for Node's own modules, which an ES module does not have.
        banner: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
    });
    // #endregion function

    // #region entry
    const url = handler.addFunctionUrl({
      // Unsigned requests never reach the function, so nobody walks around CloudFront and its web ACL.
      authType: FunctionUrlAuthType.AWS_IAM,
    });
    const distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: "AWS in Your Hands chapter 21 token API",
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      // AWS WAF attaches here. A function URL has no place to attach one.
      ...(props.webAclArn === undefined ? {} : { webAclId: props.webAclArn }),
      defaultBehavior: {
        origin: FunctionUrlOrigin.withOriginAccessControl(url),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        // GET and HEAD only: with origin access control, a body would need a hash the caller has to send.
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        // Tokens are per caller. Nothing here may be served from a shared cache.
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
      },
    });
    // #endregion entry

    new CfnOutput(this, "Url", { value: `https://${distribution.distributionDomainName}` });
    new CfnOutput(this, "DistributionId", { value: distribution.distributionId });
    new CfnOutput(this, "SecretArn", { value: secret.secretArn });
    new CfnOutput(this, "HandlerLogGroupName", { value: logGroup.logGroupName });
    new CfnOutput(this, "WebAcl", { value: props.webAclArn ?? "none" });
  }
}
