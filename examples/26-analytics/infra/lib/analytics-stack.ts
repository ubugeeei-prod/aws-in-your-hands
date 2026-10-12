import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as athena from "aws-cdk-lib/aws-athena";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as glue from "aws-cdk-lib/aws-glue";
import * as iam from "aws-cdk-lib/aws-iam";
import * as firehose from "aws-cdk-lib/aws-kinesisfirehose";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

import { DATABASE, QUALIFIED_TABLE, TABLE, WORKGROUP } from "../../src/names.ts";
import {
  FIREHOSE_ERROR_PREFIX,
  firehosePrefix,
  type Format,
  projectionParameters,
  tableRoot,
} from "../../src/partition.ts";
import { COLUMNS } from "../../src/record.ts";

export type AnalyticsStackProps = StackProps & {
  allowedOrigin: string;
  /** How the records are stored. Changing it starts a new folder; the old files stay where they are. */
  format: Format;
};

// #region bounds
// As in chapter 19: requests per second the API accepts, and what the table accepts.
export const THROTTLE = { rate: 10, burst: 20 } as const;
export const TABLE_CAP = { read: 150, write: 40 } as const;
// The most one query may read before Athena cancels it. 1 GiB is half a cent at USD 5 per TB.
export const BYTES_SCANNED_CUTOFF = 1024 ** 3;
// #endregion bounds

// #region retention
export const RESULTS_PREFIX = "athena-results/";
// Days the records, the failed records and the query results are kept. Practice values.
export const RETENTION_DAYS = { records: 90, errors: 14, results: 7 } as const;
// #endregion retention

// #region storage
// How a table of each format is read. The class names are Hive's; Athena and Firehose both use them.
const STORAGE = {
  json: {
    inputFormat: "org.apache.hadoop.mapred.TextInputFormat",
    outputFormat: "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
    serializationLibrary: "org.apache.hive.hcatalog.data.JsonSerDe",
    classification: "json",
  },
  parquet: {
    inputFormat: "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
    outputFormat: "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat",
    serializationLibrary: "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe",
    classification: "parquet",
  },
} as const;
// #endregion storage

export class AnalyticsStack extends Stack {
  constructor(scope: Construct, id: string, props: AnalyticsStackProps) {
    super(scope, id, props);
    const { format } = props;

    // #region bucket
    const lake = new s3.Bucket(this, "Lake", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [
        // Each rule names its folder, so a folder nobody listed is kept, not silently deleted.
        ...(["json", "parquet"] as const).map((each) => ({
          id: `expire-${each}-records`,
          prefix: tableRoot(each),
          expiration: Duration.days(RETENTION_DAYS.records),
        })),
        {
          id: "expire-failed-records",
          prefix: "errors/",
          expiration: Duration.days(RETENTION_DAYS.errors),
        },
        {
          // Every query leaves its result here, and nothing else ever deletes one.
          id: "expire-query-results",
          prefix: RESULTS_PREFIX,
          expiration: Duration.days(RETENTION_DAYS.results),
        },
        {
          // Firehose and Athena both write in parts. A part of an upload that never finished is billed too.
          id: "abort-incomplete-multipart-uploads",
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
      ],
      // Exercise data: deleted with the stack, once emptied. Records you mean to keep want RETAIN.
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion bucket

    // #region catalog
    const database = new glue.CfnDatabase(this, "Database", {
      catalogId: this.account,
      databaseInput: { name: DATABASE, description: "Request records of the notes API" },
    });

    const location = `s3://${lake.bucketName}/${tableRoot(format)}`;
    const table = new glue.CfnTable(this, "Requests", {
      catalogId: this.account,
      databaseName: DATABASE,
      tableInput: {
        name: TABLE,
        // The files belong to the bucket. Dropping the table deletes no data.
        tableType: "EXTERNAL_TABLE",
        partitionKeys: [{ name: "dt", type: "string" }],
        parameters: {
          classification: STORAGE[format].classification,
          ...projectionParameters(location),
        },
        storageDescriptor: {
          location,
          columns: COLUMNS.map(({ name, type }) => ({ name, type })),
          inputFormat: STORAGE[format].inputFormat,
          outputFormat: STORAGE[format].outputFormat,
          serdeInfo: { serializationLibrary: STORAGE[format].serializationLibrary },
        },
      },
    });
    table.node.addDependency(database);
    // #endregion catalog

    // #region delivery-role
    const deliveryLogs = new logs.LogGroup(this, "DeliveryLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const deliveryLogStream = new logs.LogStream(this, "DeliveryLogStream", {
      logGroup: deliveryLogs,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const deliveryRole = new iam.Role(this, "DeliveryRole", {
      assumedBy: new iam.ServicePrincipal("firehose.amazonaws.com"),
    });
    deliveryRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetBucketLocation", "s3:ListBucket", "s3:ListBucketMultipartUploads"],
        resources: [lake.bucketArn],
      }),
    );
    deliveryRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:AbortMultipartUpload", "s3:GetObject", "s3:PutObject"],
        // Only where this stream writes. Not the query results, not the other format's folder.
        resources: [lake.arnForObjects(`${tableRoot(format)}*`), lake.arnForObjects("errors/*")],
      }),
    );
    deliveryRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["logs:PutLogEvents"],
        resources: [`${deliveryLogs.logGroupArn}:log-stream:${deliveryLogStream.logStreamName}`],
      }),
    );
    if (format === "parquet") {
      // To convert, Firehose reads the column list from the table above.
      deliveryRole.addToPolicy(
        new iam.PolicyStatement({
          actions: ["glue:GetTable", "glue:GetTableVersion", "glue:GetTableVersions"],
          resources: [
            this.formatArn({ service: "glue", resource: "catalog" }),
            this.formatArn({ service: "glue", resource: "database", resourceName: DATABASE }),
            this.formatArn({
              service: "glue",
              resource: "table",
              resourceName: `${DATABASE}/${TABLE}`,
            }),
          ],
        }),
      );
    }
    // #endregion delivery-role

    // #region stream
    const stream = new firehose.CfnDeliveryStream(this, "Delivery", {
      deliveryStreamType: "DirectPut",
      extendedS3DestinationConfiguration: {
        bucketArn: lake.bucketArn,
        roleArn: deliveryRole.roleArn,
        prefix: firehosePrefix(format),
        // Required as soon as the prefix holds an expression.
        errorOutputPrefix: FIREHOSE_ERROR_PREFIX,
        cloudWatchLoggingOptions: {
          enabled: true,
          logGroupName: deliveryLogs.logGroupName,
          logStreamName: deliveryLogStream.logStreamName,
        },
        ...(format === "json"
          ? {
              // Whichever comes first. One object a minute at most, however little arrives.
              bufferingHints: { intervalInSeconds: 60, sizeInMBs: 5 },
              compressionFormat: "GZIP",
            }
          : {
              // A Parquet file is worth its footer only when it holds many rows: wait longer.
              bufferingHints: { intervalInSeconds: 300, sizeInMBs: 64 },
              // Parquet compresses inside the file. Compressing the file again would hide it from Athena.
              compressionFormat: "UNCOMPRESSED",
              dataFormatConversionConfiguration: {
                enabled: true,
                inputFormatConfiguration: { deserializer: { openXJsonSerDe: {} } },
                outputFormatConfiguration: { serializer: { parquetSerDe: {} } },
                schemaConfiguration: {
                  catalogId: this.account,
                  databaseName: DATABASE,
                  tableName: TABLE,
                  region: this.region,
                  roleArn: deliveryRole.roleArn,
                  versionId: "LATEST",
                },
              },
            }),
      },
    });
    // The stream checks its role and its table when it is created.
    stream.node.addDependency(deliveryRole, table);
    // #endregion stream

    // #region workgroup
    const workgroup = new athena.CfnWorkGroup(this, "WorkGroup", {
      name: WORKGROUP,
      description: "Queries over the request records, each capped in bytes scanned",
      state: "ENABLED",
      // Without this, a workgroup that has run a query cannot be deleted with the stack.
      recursiveDeleteOption: true,
      workGroupConfiguration: {
        bytesScannedCutoffPerQuery: BYTES_SCANNED_CUTOFF,
        // A caller cannot override the result location or lift the cap from the client side.
        enforceWorkGroupConfiguration: true,
        publishCloudWatchMetricsEnabled: true,
        resultConfiguration: {
          outputLocation: `s3://${lake.bucketName}/${RESULTS_PREFIX}`,
          encryptionConfiguration: { encryptionOption: "SSE_S3" },
        },
      },
    });
    // #endregion workgroup

    // The same table, role and routes as chapters 05 and 19. Only what differs is marked.
    const notes = new dynamodb.Table(this, "Notes", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      maxReadRequestUnits: TABLE_CAP.read,
      maxWriteRequestUnits: TABLE_CAP.write,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const handlerLogs = new logs.LogGroup(this, "HandlerLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const handlerRole = new iam.Role(this, "HandlerRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    handlerLogs.grants.write(handlerRole);
    handlerRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
        ],
        resources: [notes.tableArn],
      }),
    );
    // #region producer
    // The function may add records to this one stream. It cannot read the bucket or run a query.
    handlerRole.addToPolicy(
      new iam.PolicyStatement({ actions: ["firehose:PutRecord"], resources: [stream.attrArn] }),
    );
    // #endregion producer

    const handler = new nodejs.NodejsFunction(this, "Handler", {
      entry: fileURLToPath(new URL("../../src/lambda.ts", import.meta.url)),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      role: handlerRole,
      logGroup: handlerLogs,
      loggingFormat: lambda.LoggingFormat.JSON,
      environment: {
        ALLOWED_ORIGIN: props.allowedOrigin,
        LOG_LEVEL: "info",
        STAGE: "dev",
        NOTES_STORE: "dynamodb",
        TABLE_NAME: notes.tableName,
        DELIVERY_STREAM_NAME: stream.ref,
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

    const api = new apigwv2.HttpApi(this, "Api", {
      description: "Notes API that records each request for analysis",
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
    api.addRoutes({ path: "/health", methods: [apigwv2.HttpMethod.GET], integration });
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
    stage.defaultRouteSettings = {
      throttlingRateLimit: THROTTLE.rate,
      throttlingBurstLimit: THROTTLE.burst,
    };

    new CfnOutput(this, "ApiUrl", { value: api.apiEndpoint });
    new CfnOutput(this, "LakeBucketName", { value: lake.bucketName });
    new CfnOutput(this, "DeliveryStreamName", { value: stream.ref });
    new CfnOutput(this, "WorkGroupName", { value: workgroup.name });
    new CfnOutput(this, "TableName", { value: QUALIFIED_TABLE });
    new CfnOutput(this, "Format", { value: format });
  }
}
