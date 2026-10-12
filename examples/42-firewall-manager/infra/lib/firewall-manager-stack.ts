import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps, Token } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as fms from "aws-cdk-lib/aws-fms";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sns from "aws-cdk-lib/aws-sns";
import type { Construct } from "constructs";

import { FINDING_EVENT_PATTERN } from "../../src/finding.ts";
import { contentAuditDataSchema, encode } from "../../src/managed-service-data.ts";
import {
  AUDIT_ALLOWED,
  SG_AUDIT_POLICY_NAME,
  sgAuditData,
  sgAuditScope,
} from "../../src/policies.ts";
import { scopeProps } from "./scope-props.ts";

export type FirewallManagerStackProps = StackProps & {
  /** The account this stack is deployed into. Its service-linked role publishes to the topic. */
  adminAccountId: string;
  orgUnitIds: string[];
  remediation: boolean;
  notifyEmail?: string | undefined;
};

/** The audit policy for security groups, and the path a compliance change takes to a person. */
export class FirewallManagerStack extends Stack {
  constructor(scope: Construct, id: string, props: FirewallManagerStackProps) {
    super(scope, id, props);

    // #region audit-group
    // A VPC with nothing in it: the audit security group needs one to exist in, and is
    // never attached to anything. Firewall Manager only reads its rules as the reference.
    const vpc = new ec2.CfnVPC(this, "AuditVpc", {
      cidrBlock: "10.255.255.240/28",
      tags: [{ key: "Name", value: "aih-firewall-manager-audit" }],
    });
    const auditGroup = new ec2.CfnSecurityGroup(this, "AuditGroup", {
      vpcId: vpc.attrVpcId,
      groupDescription: "Reference rules for the Firewall Manager audit policy. Attach to nothing.",
      securityGroupIngress: AUDIT_ALLOWED.map((range) => ({
        ipProtocol: range.protocol === "all" ? "-1" : range.protocol,
        ...(range.fromPort === undefined ? {} : { fromPort: range.fromPort }),
        ...(range.toPort === undefined ? {} : { toPort: range.toPort }),
        ...(range.cidr.includes(":") ? { cidrIpv6: range.cidr } : { cidrIp: range.cidr }),
        description: range.description,
      })),
    });
    // #endregion audit-group

    // #region audit-policy
    const policy = new fms.CfnPolicy(this, "IngressAuditPolicy", {
      policyName: SG_AUDIT_POLICY_NAME,
      policyDescription:
        "AWS in Your Hands chapter 42: inbound rules open to the internet only on 443",
      ...scopeProps(sgAuditScope(props.orgUnitIds)),
      securityServicePolicyData: {
        type: "SECURITY_GROUPS_CONTENT_AUDIT",
        managedServiceData: encode(
          contentAuditDataSchema(Token.isUnresolved),
          sgAuditData(auditGroup.attrGroupId),
        ),
      },
      // An audit policy has to be created with this false. `-c sgRemediation=on` is a later deploy.
      remediationEnabled: props.remediation,
      resourcesCleanUp: true,
      deleteAllPolicyResources: true,
    });
    // #endregion audit-policy

    // #region channel
    const topic = new sns.Topic(this, "ComplianceTopic", {
      displayName: "Firewall Manager compliance",
    });
    // The service-linked role of the administrator account, as the documented topic policy names it.
    const serviceRoleArn = `arn:aws:iam::${props.adminAccountId}:role/aws-service-role/fms.amazonaws.com/AWSServiceRoleForFMS`;
    topic.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "AWSFirewallManagerSNSPolicy",
        principals: [new iam.ArnPrincipal(serviceRoleArn)],
        actions: ["sns:Publish"],
        resources: [topic.topicArn],
      }),
    );
    const channel = new fms.CfnNotificationChannel(this, "NotificationChannel", {
      snsRoleName: serviceRoleArn,
      snsTopicArn: topic.topicArn,
    });
    // After the topic's policy, so the role may already publish when the channel is set.
    channel.node.addDependency(topic);
    if (props.notifyEmail !== undefined) {
      new sns.Subscription(this, "NotifyEmail", {
        topic,
        protocol: sns.SubscriptionProtocol.EMAIL,
        endpoint: props.notifyEmail,
      });
    }
    // #endregion channel

    // #region notifier
    const logGroup = new logs.LogGroup(this, "NotifierLogs", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const role = new iam.Role(this, "NotifierRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      inlinePolicies: {
        Notifier: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              sid: "WriteOwnLogs",
              actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
              resources: [logGroup.logGroupArn],
            }),
            new iam.PolicyStatement({
              sid: "PublishToComplianceTopic",
              actions: ["sns:Publish"],
              resources: [topic.topicArn],
            }),
          ],
        }),
      },
    });
    const notifier = new nodejs.NodejsFunction(this, "Notifier", {
      entry: fileURLToPath(new URL("../../src/lambda.ts", import.meta.url)),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      role,
      logGroup,
      environment: { TOPIC_ARN: topic.topicArn },
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: "node24",
        minify: false,
        sourceMap: false,
        externalModules: [],
        // The bundled SDK still calls require() for Node's own modules, which an ES module does not have.
        banner:
          "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
    });

    // Security Hub CSPM has to be enabled for these events to exist at all.
    new events.Rule(this, "FindingRule", {
      description: "Firewall Manager findings, as Security Hub imports or updates them",
      eventPattern: {
        source: [...FINDING_EVENT_PATTERN.source],
        detailType: [...FINDING_EVENT_PATTERN.detailType],
        detail: {
          findings: { ProductName: [...FINDING_EVENT_PATTERN.detail.findings.ProductName] },
        },
      },
      targets: [new targets.LambdaFunction(notifier)],
    });
    // #endregion notifier

    new CfnOutput(this, "IngressAuditPolicyId", { value: policy.attrId });
    new CfnOutput(this, "ComplianceTopicArn", { value: topic.topicArn });
    new CfnOutput(this, "NotifierLogGroupName", { value: logGroup.logGroupName });
  }
}
