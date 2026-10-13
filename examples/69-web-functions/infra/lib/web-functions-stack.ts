import { createHash } from "node:crypto";

import { ArnFormat, CfnOutput, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";
import * as v from "valibot";

import {
  CODE_KEY,
  CODE_PREFIX,
  codeBucketName,
  ENDPOINT_NAME,
  FUNCTION_NAME,
  LIMITS,
  LOG_GROUP,
} from "../../src/names.ts";
import { limitsSchema, type Release, shares } from "../../src/release.ts";

export type WebFunctionsStackProps = StackProps & {
  allowedOrigin: string;
  /** Undefined until a package has been uploaded: the stack then holds no revision and no endpoint. */
  release: Release | undefined;
};

export class WebFunctionsStack extends Stack {
  constructor(scope: Construct, id: string, props: WebFunctionsStackProps) {
    super(scope, id, props);
    // A value outside the documented ranges stops synth, not a deploy halfway through.
    const limits = v.parse(limitsSchema, LIMITS);

    // #region code
    // A revision points at one version of one object. Without versioning Lambda refuses the bucket.
    const code = new s3.Bucket(this, "Code", {
      bucketName: codeBucketName(this.account, this.region),
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // Lambda reads the package as itself, not as a role of this account.
    // The condition narrows "Lambda" down to the revisions of this one function.
    code.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "LambdaReadsRevisionCode",
        principals: [new iam.ServicePrincipal("lambda.amazonaws.com")],
        actions: ["s3:GetObject", "s3:GetObjectVersion"],
        resources: [code.arnForObjects(`${CODE_PREFIX}/*`)],
        conditions: {
          ArnLike: {
            "aws:SourceArn": this.formatArn({
              service: "lambda",
              resource: "web-function",
              resourceName: `${FUNCTION_NAME}/revision/*`,
              arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
            }),
          },
        },
      }),
    );
    // #endregion code

    // #region logs
    // Created here so that the retention is in place before the first line. Left to Lambda,
    // both groups would keep their logs forever and outlive the stack.
    const logGroups = [LOG_GROUP, `${LOG_GROUP}.local`].map(
      (logGroupName, index) =>
        new logs.LogGroup(this, index === 0 ? "Logs" : "LocalLogs", {
          logGroupName,
          retention: logs.RetentionDays.ONE_WEEK,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
    );
    // #endregion logs

    // #region role
    // What the server may do in AWS: write its own logs. The notes live in memory.
    const role = new iam.Role(this, "ExecutionRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    const mayLog = role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
        resources: logGroups.map((group) => group.logGroupArn),
      }),
    );
    // #endregion role

    // #region function
    // The name and nothing else. Code and settings belong to revisions, addresses to endpoints.
    const webFunction = new lambda.CfnWebFunction(this, "Function", {
      functionName: FUNCTION_NAME,
    });
    // #endregion function
    new CfnOutput(this, "CodeBucket", { value: code.bucketName });
    new CfnOutput(this, "FunctionArn", { value: webFunction.attrFunctionArn });

    if (props.release === undefined) {
      return;
    }

    // #region revision
    const revisionOf = (version: string): lambda.CfnWebFunctionRevision => {
      // One logical ID per upload: a new upload is a new resource next to the old one,
      // not a replacement of it, so two can serve at once.
      const digest = createHash("sha256").update(version).digest("hex").slice(0, 12);
      const revision = new lambda.CfnWebFunctionRevision(this, `Revision${digest}`, {
        functionName: FUNCTION_NAME,
        description: `${CODE_KEY} version ${version}`.slice(0, 256),
        buildConfig: {
          codeConfig: { s3Object: { bucket: code.bucketName, key: CODE_KEY, versionId: version } },
          runtimeConfig: { runtime: "nodejs24.x" },
        },
        serviceConfig: {
          executionRoleArn: role.roleArn,
          timeoutSeconds: limits.timeoutSeconds,
          maxConcurrencyPerEnvironment: limits.maxConcurrencyPerEnvironment,
          environmentVariables: {
            ALLOWED_ORIGIN: props.allowedOrigin,
            LOG_LEVEL: "info",
            STAGE: "dev",
            RELEASE: version,
          },
          telemetryConfig: {
            loggingConfig: {
              logGroup: LOG_GROUP,
              applicationLogLevel: "INFO",
              systemLogLevel: "INFO",
            },
          },
        },
      });
      // Lambda checks its access to the package when the revision is created.
      revision.node.addDependency(
        webFunction,
        code.policy ?? code,
        mayLog.policyDependable ?? role,
      );
      revision.node.addDependency(...logGroups);
      return revision;
    };
    // #endregion revision

    // #region endpoint
    const endpoint = new lambda.CfnWebFunctionEndpoint(this, "Endpoint", {
      functionName: FUNCTION_NAME,
      endpointName: ENDPOINT_NAME,
      // One Region. The type cannot be changed afterwards.
      endpointType: "HomeRegion",
      // Lambda refuses a request that is not signed by a principal allowed to invoke this endpoint.
      authType: "IamAuth",
      revisionWeights: shares(props.release).map(({ version, weight }) => ({
        revisionId: revisionOf(version).attrRevisionId,
        weight,
      })),
      scalingConfig: { maxEnvironments: limits.maxEnvironments },
      throttleConfig: { rateLimit: limits.rateLimit },
    });
    // #endregion endpoint
    endpoint.node.addDependency(webFunction);

    new CfnOutput(this, "EndpointUrl", { value: `https://${endpoint.attrDomainName}` });
    new CfnOutput(this, "EndpointArn", { value: endpoint.attrEndpointArn });
  }
}
