import { fileURLToPath } from "node:url";

import { Aws, CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

import { HEALTH_CHECK } from "../../src/objectives.ts";
import { HEALTH_PATH } from "../../src/regional-app.ts";
import {
  otherRegion,
  PRIMARY_REGION,
  type Region,
  TABLE_NAME,
  uploadsBucketName,
} from "../../src/regions.ts";

export type DnsProps = {
  /** An existing public hosted zone. This stack does not create one. */
  hostedZoneId: string;
  zoneName: string;
  /** The name clients call, inside that zone. Both Regions answer to it. */
  domainName: string;
  /** "failover": Tokyo answers while healthy. "latency": the nearest healthy Region answers. */
  routing: "failover" | "latency";
};

export type RegionStackProps = StackProps & {
  region: Region;
  allowedOrigin: string;
  /** Whether the function in this Region takes writes. */
  writes: "accept" | "refuse";
  /** Whether this Region's bucket copies its new objects to the other Region. */
  replicateUploads: boolean;
  /** S3 Replication Time Control: a stated time for replication, billed per GB and per metric. */
  replicationTimeControl: boolean;
  /** A failover drill: this Region's health check answers 503 while the API keeps working. */
  failHealth?: boolean | undefined;
  dns?: DnsProps | undefined;
};

// Old versions of an image, kept as in chapter 22.
export const NONCURRENT_DAYS = 30;

export class RegionStack extends Stack {
  constructor(scope: Construct, id: string, props: RegionStackProps) {
    super(scope, id, { ...props, env: { region: props.region } });
    const primary = props.region === PRIMARY_REGION;
    const peer = otherRegion(props.region);

    // #region table
    // Every replica is declared in one stack, the primary's, because
    // CloudFormation cannot coordinate one global table across two stacks.
    const table: dynamodb.ITableV2 = primary
      ? new dynamodb.TableV2(this, "Notes", {
          tableName: TABLE_NAME,
          partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
          sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
          billing: dynamodb.Billing.onDemand(),
          // No consistency mode is named, so the table is eventually consistent
          // across Regions (MREC): writes are copied to Osaka after they return.
          replicas: [{ region: peer }],
          // A replica copies a mistaken delete within a second. This is what undoes one.
          pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
          removalPolicy: RemovalPolicy.DESTROY,
        })
      : dynamodb.TableV2.fromTableName(this, "Notes", TABLE_NAME);
    // #endregion table

    // #region bucket
    const destination = s3.Bucket.fromBucketName(
      this,
      "PeerUploads",
      uploadsBucketName(Aws.ACCOUNT_ID, peer),
    );
    const replicationRole = props.replicateUploads
      ? new iam.Role(this, "ReplicationRole", {
          assumedBy: new iam.ServicePrincipal("s3.amazonaws.com"),
        })
      : undefined;
    const uploads = new s3.Bucket(this, "Uploads", {
      // Named, so the stack in the other Region can point at it without asking this one.
      bucketName: uploadsBucketName(Aws.ACCOUNT_ID, props.region),
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // Replication requires versioning on both sides.
      versioned: true,
      lifecycleRules: [
        {
          id: "expire-noncurrent-versions",
          noncurrentVersionExpiration: Duration.days(NONCURRENT_DAYS),
          expiredObjectDeleteMarker: true,
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
      ],
      removalPolicy: RemovalPolicy.DESTROY,
      ...(replicationRole === undefined
        ? {}
        : {
            replicationRole,
            replicationRules: [
              {
                id: `to-${peer}`,
                destination,
                priority: 1,
                // 99.9% of objects within 15 minutes: the number the RPO for images rests on.
                ...(props.replicationTimeControl
                  ? {
                      replicationTimeControl: s3.ReplicationTimeValue.FIFTEEN_MINUTES,
                      metrics: s3.ReplicationTimeValue.FIFTEEN_MINUTES,
                    }
                  : {}),
                // A delete in one Region leaves the other Region's copy in place.
                deleteMarkerReplication: false,
              },
            ],
          }),
    });
    // #endregion bucket

    const logGroup = new logs.LogGroup(this, "HandlerLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // #region role
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
        // This Region's copy only. The function has no business in the other one.
        resources: [
          this.formatArn({ service: "dynamodb", resource: "table", resourceName: TABLE_NAME }),
        ],
      }),
    );
    // #endregion role

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
      environment: {
        ALLOWED_ORIGIN: props.allowedOrigin,
        LOG_LEVEL: "info",
        STAGE: "dev",
        NOTES_STORE: "dynamodb",
        TABLE_NAME,
        REGION: props.region,
        WRITES: props.writes,
        HEALTH: props.failHealth === true ? "fail" : "probe",
      },
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: "node24",
        minify: false,
        sourceMap: false,
        externalModules: [],
        // The bundled AWS SDK still calls require(); an ESM bundle has none unless we provide it.
        banner:
          "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
    });
    // #endregion function

    const api = new apigwv2.HttpApi(this, "Api", {
      description: `Notes API in ${props.region}`,
      corsPreflight: {
        allowOrigins: [props.allowedOrigin],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PUT,
          apigwv2.CorsHttpMethod.DELETE,
        ],
        allowHeaders: ["content-type"],
        maxAge: Duration.hours(1),
      },
    });
    const integration = new integrations.HttpLambdaIntegration("Notes", handler);
    api.addRoutes({ path: HEALTH_PATH, methods: [apigwv2.HttpMethod.GET], integration });
    api.addRoutes({
      path: "/notes",
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      integration,
    });
    api.addRoutes({
      path: "/notes/{id}",
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.PUT, apigwv2.HttpMethod.DELETE],
      integration,
    });
    const stage = api.defaultStage?.node.defaultChild as apigwv2.CfnStage;
    stage.defaultRouteSettings = { throttlingRateLimit: 10, throttlingBurstLimit: 20 };

    if (replicationRole !== undefined) {
      grantReplication(replicationRole, uploads, destination);
    }
    if (props.dns !== undefined) {
      addDns(this, props.dns, { api, region: props.region, primary });
    }

    new CfnOutput(this, "Region", { value: props.region });
    new CfnOutput(this, "ApiUrl", { value: api.apiEndpoint });
    new CfnOutput(this, "TableName", { value: table.tableName });
    new CfnOutput(this, "UploadsBucketName", { value: uploads.bucketName });
    new CfnOutput(this, "HandlerLogGroupName", { value: logGroup.logGroupName });
  }
}

// #region replication-role
// Written out instead of left to CDK: its default role has one fixed name, and
// two stacks in one account would both try to create it.
function grantReplication(role: iam.Role, source: s3.IBucket, destination: s3.IBucket): void {
  role.addToPolicy(
    new iam.PolicyStatement({
      actions: ["s3:GetReplicationConfiguration", "s3:ListBucket"],
      resources: [source.bucketArn],
    }),
  );
  role.addToPolicy(
    new iam.PolicyStatement({
      actions: [
        "s3:GetObjectVersionForReplication",
        "s3:GetObjectVersionAcl",
        "s3:GetObjectVersionTagging",
      ],
      resources: [source.arnForObjects("*")],
    }),
  );
  role.addToPolicy(
    new iam.PolicyStatement({
      actions: ["s3:ReplicateObject", "s3:ReplicateDelete", "s3:ReplicateTags"],
      resources: [destination.arnForObjects("*")],
    }),
  );
}
// #endregion replication-role

// #region dns
function addDns(
  stack: Stack,
  dns: DnsProps,
  target: { api: apigwv2.HttpApi; region: Region; primary: boolean },
): void {
  const zone = route53.HostedZone.fromHostedZoneAttributes(stack, "Zone", {
    hostedZoneId: dns.hostedZoneId,
    zoneName: dns.zoneName,
  });
  // A Regional custom domain needs its certificate in the same Region, so each stack asks for one.
  const certificate = new acm.Certificate(stack, "Certificate", {
    domainName: dns.domainName,
    validation: acm.CertificateValidation.fromDns(zone),
  });
  const domain = new apigwv2.DomainName(stack, "Domain", {
    domainName: dns.domainName,
    certificate,
  });
  new apigwv2.ApiMapping(stack, "Mapping", { api: target.api, domainName: domain });

  // The check calls the Region's own endpoint, never the shared name: the
  // shared name is what the check decides about.
  const healthCheck = new route53.HealthCheck(stack, "Health", {
    type: route53.HealthCheckType.HTTPS,
    fqdn: `${target.api.apiId}.execute-api.${target.region}.${Aws.URL_SUFFIX}`,
    port: 443,
    resourcePath: HEALTH_PATH,
    requestInterval: Duration.seconds(HEALTH_CHECK.requestIntervalSeconds),
    failureThreshold: HEALTH_CHECK.failureThreshold,
  });

  new route53.ARecord(stack, "Record", {
    zone,
    recordName: dns.domainName,
    // Two records with one name. This is what tells them apart.
    setIdentifier: target.region,
    healthCheck,
    ...(dns.routing === "failover"
      ? { failover: target.primary ? route53.Failover.PRIMARY : route53.Failover.SECONDARY }
      : { region: target.region }),
    target: route53.RecordTarget.fromAlias({
      bind: () => ({
        dnsName: domain.regionalDomainName,
        hostedZoneId: domain.regionalHostedZoneId,
        // Required on a failover alias: API Gateway being down in the Region counts too.
        evaluateTargetHealth: true,
      }),
    }),
  });

  new CfnOutput(stack, "HealthCheckId", { value: healthCheck.healthCheckId });
  new CfnOutput(stack, "DomainName", { value: dns.domainName });
}
// #endregion dns
