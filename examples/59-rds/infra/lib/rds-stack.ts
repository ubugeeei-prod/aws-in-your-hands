import { fileURLToPath } from "node:url";

import { ArnFormat, CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import type { Construct } from "constructs";

import { importNetwork } from "@aih/example-11-network/infra/lib/import-network.ts";

import { DATABASE_NAME, POSTGRES_PORT, PROFILES, type RdsConfig } from "../../src/config.ts";
import { API_ROLE, MIGRATOR_ROLE } from "../../src/roles.ts";

export type RdsStackProps = StackProps & { config: RdsConfig };

/** The instance has a fixed name so that its log group can exist before it does. */
export const INSTANCE_ID = "aih-notes";
const MASTER_USER = "notes_admin";

// Requests per second the API accepts, and how far a burst may go past it. Beyond that: 429.
export const THROTTLE = { rate: 10, burst: 20 } as const;

// The Lambda guide lists these six and says they must be allowed on all resources.
const VPC_ATTACH_ACTIONS = [
  "ec2:CreateNetworkInterface",
  "ec2:DescribeNetworkInterfaces",
  "ec2:DescribeSubnets",
  "ec2:DeleteNetworkInterface",
  "ec2:AssignPrivateIpAddresses",
  "ec2:UnassignPrivateIpAddresses",
];

export class RdsStack extends Stack {
  constructor(scope: Construct, id: string, props: RdsStackProps) {
    super(scope, id, props);
    const { config } = props;
    const profile = PROFILES[config.profile];

    // #region network
    // The chapter 11 VPC, read by export name. Its private subnets have no route out.
    const vpc = importNetwork(this, "Network");
    const subnets = vpc.isolatedSubnets;

    // Two groups that name each other: PostgreSQL leaves the functions only towards
    // the database, and reaches the database only from the functions.
    const functionGroup = new ec2.SecurityGroup(this, "FunctionGroup", {
      vpc,
      description: "Chapter 59 functions: PostgreSQL to the database, nothing else",
      allowAllOutbound: false,
    });
    const databaseGroup = new ec2.SecurityGroup(this, "DatabaseGroup", {
      vpc,
      description: "Chapter 59 database: PostgreSQL from the functions, nothing else",
      allowAllOutbound: false,
    });
    functionGroup.addEgressRule(databaseGroup, ec2.Port.tcp(POSTGRES_PORT), "PostgreSQL");
    databaseGroup.addIngressRule(functionGroup, ec2.Port.tcp(POSTGRES_PORT), "PostgreSQL");

    const subnetGroup = new rds.SubnetGroup(this, "Subnets", {
      description: "Private subnets of the chapter 11 VPC, one per Availability Zone",
      vpc,
      vpcSubnets: { subnets },
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion network

    // #region parameters
    const engine = rds.DatabaseInstanceEngine.postgres({
      version: rds.PostgresEngineVersion.of(
        config.postgresVersion,
        config.postgresVersion.split(".")[0] ?? "",
      ),
    });
    // The default group cannot be edited, so every setting that is ever changed
    // needs a group of the instance's own, from the first day.
    const parameterGroup = new rds.ParameterGroup(this, "Parameters", {
      engine,
      description: "Chapter 59: slow statements are logged, and every connection uses TLS",
      parameters: {
        // Milliseconds. A statement that runs this long is written to the log with its text.
        log_min_duration_statement: "500",
        // Already the default from PostgreSQL 15 on. Written down so that it stays.
        "rds.force_ssl": "1",
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // RDS writes here under this exact name. Made first, it has a retention
    // and leaves with the stack. Made by RDS, it would have neither.
    const databaseLogs = new logs.LogGroup(this, "DatabaseLogs", {
      logGroupName: `/aws/rds/instance/${INSTANCE_ID}/postgresql`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion parameters

    // #region instance
    const shared = {
      instanceType: new ec2.InstanceType(config.instanceClass),
      vpc,
      subnetGroup,
      securityGroups: [databaseGroup],
      // No public address and no public DNS answer. Reachable from this VPC only.
      publiclyAccessible: false,
      storageType: rds.StorageType.GP3,
      parameterGroup,
      // An IAM role may sign in as a database user that was granted rds_iam.
      iamAuthentication: true,
      cloudwatchLogsExports: ["postgresql"],
      // Minor versions arrive by themselves, in the maintenance window below.
      autoMinorVersionUpgrade: true,
      // Times are UTC. Backups at 02:00 and maintenance on Monday at 03:00 in Japan.
      preferredBackupWindow: "17:00-17:30",
      preferredMaintenanceWindow: "sun:18:00-sun:18:30",
      multiAz: profile.multiAz,
      deletionProtection: profile.deletionProtection,
      deleteAutomatedBackups: !profile.survivesStack,
      removalPolicy: profile.survivesStack ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      ...(profile.maxAllocatedStorageGiB === undefined
        ? {}
        : { maxAllocatedStorage: profile.maxAllocatedStorageGiB }),
    } satisfies Partial<rds.DatabaseInstanceProps>;

    const instance = new rds.DatabaseInstance(this, "Database", {
      ...shared,
      engine,
      instanceIdentifier: INSTANCE_ID,
      databaseName: DATABASE_NAME,
      allocatedStorage: 20,
      // Encryption can only be chosen now. It cannot be turned on later.
      storageEncrypted: true,
      backupRetention: Duration.days(profile.backupRetentionDays),
      // When the major version leaves standard support, RDS upgrades the instance
      // instead of keeping it on the old version at an hourly charge per vCPU.
      engineLifecycleSupport: rds.EngineLifecycleSupport.OPEN_SOURCE_RDS_EXTENDED_SUPPORT_DISABLED,
      // RDS creates the master password, keeps it in Secrets Manager, and rotates it.
      // It refuses to create a read replica of such an instance, so with a replica
      // the password is generated once by CloudFormation and nothing rotates it.
      ...(config.readReplica
        ? { credentials: rds.Credentials.fromGeneratedSecret(MASTER_USER) }
        : {
            credentials: rds.Credentials.fromUsername(MASTER_USER),
            manageMasterUserPassword: true,
          }),
    });
    instance.node.addDependency(databaseLogs);
    // #endregion instance

    // #region replica
    // Asynchronous: it answers reads and can be behind. Its endpoint is its own.
    const replica = config.readReplica
      ? new rds.DatabaseInstanceReadReplica(this, "Replica", {
          ...shared,
          sourceDatabaseInstance: instance,
          instanceIdentifier: `${INSTANCE_ID}-replica`,
          // The replica is where long reads go. It is not what survives a failure.
          multiAz: false,
          cloudwatchLogsExports: [],
        })
      : undefined;
    // #endregion replica

    // #region roles
    // rds-db:connect is not about the instance. It names one database user on it.
    const databaseUser = (resourceId: string | undefined, user: string): string =>
      this.formatArn({
        service: "rds-db",
        resource: "dbuser",
        resourceName: `${resourceId}/${user}`,
        arnFormat: ArnFormat.COLON_RESOURCE_NAME,
      });
    const roleFor = (name: string, user: string): { role: iam.Role; logGroup: logs.LogGroup } => {
      const logGroup = new logs.LogGroup(this, `${name}Logs`, {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: RemovalPolicy.DESTROY,
      });
      const role = new iam.Role(this, `${name}Role`, {
        assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      });
      logGroup.grants.write(role);
      role.addToPolicy(
        new iam.PolicyStatement({
          actions: ["rds-db:connect"],
          resources: [instance, ...(replica === undefined ? [] : [replica])].map((target) =>
            databaseUser(target.instanceResourceId, user),
          ),
        }),
      );
      // Lambda uses the function's role to create its network interfaces in the VPC.
      role.addToPolicy(new iam.PolicyStatement({ actions: VPC_ATTACH_ACTIONS, resources: ["*"] }));
      return { role, logGroup };
    };
    const api = roleFor("Handler", API_ROLE);
    const ops = roleFor("Ops", MIGRATOR_ROLE);
    // #endregion roles

    // #region functions
    const functionProps = {
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      vpc,
      vpcSubnets: { subnets },
      securityGroups: [functionGroup],
      bundling: {
        // node-postgres is CommonJS and calls require() for Node's own modules.
        format: nodejs.OutputFormat.CJS,
        target: "node24",
        minify: false,
        sourceMap: false,
        // Bundle the AWS SDK too, so the token signer is the version in pnpm-lock.yaml.
        externalModules: [],
      },
    } satisfies Partial<nodejs.NodejsFunctionProps>;
    const environment = {
      ALLOWED_ORIGIN: config.allowedOrigin,
      LOG_LEVEL: "info",
      STAGE: "dev",
      DB_HOST: instance.dbInstanceEndpointAddress,
      DB_PORT: instance.dbInstanceEndpointPort,
      DB_NAME: DATABASE_NAME,
      // Where the Lambda runtime keeps Amazon's root certificates, the RDS ones among them.
      NODE_EXTRA_CA_CERTS: "/var/runtime/ca-cert.pem",
    };

    const handler = new nodejs.NodejsFunction(this, "Handler", {
      ...functionProps,
      entry: fileURLToPath(new URL("../../src/lambda.ts", import.meta.url)),
      timeout: Duration.seconds(10),
      role: api.role,
      logGroup: api.logGroup,
      environment: {
        ...environment,
        DB_REPLICA_HOST: replica?.dbInstanceEndpointAddress ?? "",
      },
    });
    // Invoked by hand, by whoever may call lambda:InvokeFunction on it. No route leads here.
    const opsFunction = new nodejs.NodejsFunction(this, "Ops", {
      ...functionProps,
      entry: fileURLToPath(new URL("../../src/ops-lambda.ts", import.meta.url)),
      // Building an index can take a while on a table with rows in it.
      timeout: Duration.minutes(5),
      role: ops.role,
      logGroup: ops.logGroup,
      environment,
    });
    // #endregion functions

    const httpApi = new apigwv2.HttpApi(this, "Api", {
      description: "Notes API on RDS for PostgreSQL",
      corsPreflight: {
        allowOrigins: [config.allowedOrigin],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PUT,
          apigwv2.CorsHttpMethod.DELETE,
        ],
        allowHeaders: ["content-type", "x-notes-seen"],
        exposeHeaders: ["x-notes-seen", "x-notes-read-from"],
        maxAge: Duration.hours(1),
      },
    });
    const integration = new integrations.HttpLambdaIntegration("Notes", handler);
    httpApi.addRoutes({ path: "/health", methods: [apigwv2.HttpMethod.GET], integration });
    httpApi.addRoutes({
      path: "/notes",
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      integration,
    });
    httpApi.addRoutes({
      path: "/notes/{id}",
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.PUT, apigwv2.HttpMethod.DELETE],
      integration,
    });
    // The HttpApi construct has no throttling option, so this reaches the stage it created.
    const stage = httpApi.defaultStage?.node.defaultChild as apigwv2.CfnStage;
    stage.defaultRouteSettings = {
      throttlingRateLimit: THROTTLE.rate,
      throttlingBurstLimit: THROTTLE.burst,
    };

    // #region alarm
    // A full volume stops the database, and automated backups stop with it.
    new cloudwatch.Alarm(this, "StorageLow", {
      alarmDescription: "The database has less than 4 GiB of its 20 GiB left",
      metric: new cloudwatch.Metric({
        namespace: "AWS/RDS",
        metricName: "FreeStorageSpace",
        dimensionsMap: { DBInstanceIdentifier: INSTANCE_ID },
        statistic: "Minimum",
        period: Duration.minutes(5),
      }),
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      // Bytes.
      threshold: 4 * 1024 ** 3,
      evaluationPeriods: 3,
      // An instance that is stopped reports nothing, which is not a full disk.
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    // #endregion alarm

    new CfnOutput(this, "ApiUrl", { value: httpApi.apiEndpoint });
    new CfnOutput(this, "OpsFunctionName", { value: opsFunction.functionName });
    new CfnOutput(this, "DatabaseEndpoint", { value: instance.dbInstanceEndpointAddress });
    // Chapter 39 asks for these two as its source.
    new CfnOutput(this, "DatabaseSecurityGroupId", { value: databaseGroup.securityGroupId });
    new CfnOutput(this, "DatabaseName", { value: DATABASE_NAME });
    const masterSecret = instance.secret;
    if (masterSecret !== undefined) {
      new CfnOutput(this, "MasterSecretArn", { value: masterSecret.secretArn });
    }
    new CfnOutput(this, "HandlerLogGroupName", { value: api.logGroup.logGroupName });
    new CfnOutput(this, "DatabaseLogGroupName", { value: databaseLogs.logGroupName });
  }
}
