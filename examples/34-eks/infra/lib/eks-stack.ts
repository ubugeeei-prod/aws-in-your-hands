import { CfnOutput, Stack, type StackProps } from "aws-cdk-lib";
import * as eks from "aws-cdk-lib/aws-eks";
import * as iam from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";

import { importNetwork } from "@aih/example-11-network/infra/lib/import-network.ts";

import {
  CLUSTER_NAME,
  type EksConfig,
  KUBERNETES_VERSION,
  NAMESPACE,
  SERVICE_ACCOUNT,
} from "../../src/config.ts";

export type EksStackProps = StackProps & { config: EksConfig };

const accessPolicy = (name: string): string => `arn:aws:eks::aws:cluster-access-policy/${name}`;

export class EksStack extends Stack {
  constructor(scope: Construct, id: string, props: EksStackProps) {
    super(scope, id, props);
    const { config } = props;
    const vpc = importNetwork(this, "Network");

    // #region cluster-role
    // What EKS itself acts as when it starts nodes, creates load balancers, and attaches volumes.
    const clusterRole = new iam.Role(this, "ClusterRole", {
      assumedBy: new iam.ServicePrincipal("eks.amazonaws.com"),
      managedPolicies: [
        "AmazonEKSClusterPolicy",
        "AmazonEKSComputePolicy",
        "AmazonEKSBlockStoragePolicyV2",
        "AmazonEKSLoadBalancingPolicy",
        "AmazonEKSNetworkingPolicy",
      ].map((name) => iam.ManagedPolicy.fromAwsManagedPolicyName(name)),
    });
    // Auto Mode tags the sessions it opens with this role.
    clusterRole.assumeRolePolicy?.addStatements(
      new iam.PolicyStatement({
        actions: ["sts:TagSession"],
        principals: [new iam.ServicePrincipal("eks.amazonaws.com")],
      }),
    );
    // #endregion cluster-role

    // #region cluster
    const cluster = new eks.CfnCluster(this, "Cluster", {
      name: CLUSTER_NAME,
      version: KUBERNETES_VERSION,
      roleArn: clusterRole.roleArn,
      resourcesVpcConfig: {
        // The control plane's network interfaces. They need no route out of the VPC.
        subnetIds: vpc.isolatedSubnets.map((subnet) => subnet.subnetId),
        // kubectl on a laptop comes in over the public endpoint; the nodes use the private one.
        endpointPublicAccess: true,
        endpointPrivateAccess: true,
      },
      accessConfig: {
        // Access entries only: no aws-auth ConfigMap to edit by hand.
        authenticationMode: "API",
        // Whoever runs the deploy becomes cluster admin. The page says what to do about that.
        bootstrapClusterCreatorAdminPermissions: true,
      },
      // Auto Mode: all three are switched on together. No built-in node pool, so the
      // cluster starts no node until the manifests in k8s/ ask for one.
      computeConfig: { enabled: true },
      kubernetesNetworkConfig: { elasticLoadBalancing: { enabled: true } },
      storageConfig: { blockStorage: { enabled: true } },
      // Auto Mode runs the networking add-ons on the node itself.
      bootstrapSelfManagedAddons: false,
      // At the end of standard support the cluster is upgraded instead of billed six times as much.
      upgradePolicy: { supportType: "STANDARD" },
      // For practice: destroy must be able to delete the cluster.
      deletionProtection: false,
    });
    // #endregion cluster

    // #region node-role
    // What a node acts as: join the cluster, pull images from ECR. Nothing the app needs.
    const nodeRole = new iam.Role(this, "NodeRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        "AmazonEKSWorkerNodeMinimalPolicy",
        "AmazonEC2ContainerRegistryPullOnly",
      ].map((name) => iam.ManagedPolicy.fromAwsManagedPolicyName(name)),
    });
    // A node class of our own gets no access entry from EKS. Without this one its nodes cannot join.
    new eks.CfnAccessEntry(this, "NodeAccess", {
      clusterName: cluster.ref,
      principalArn: nodeRole.roleArn,
      type: "EC2",
      accessPolicies: [
        { policyArn: accessPolicy("AmazonEKSAutoNodePolicy"), accessScope: { type: "cluster" } },
      ],
    });
    // #endregion node-role

    // #region deploy-access
    if (config.deployRoleArn !== undefined) {
      // The role that ships the app may change what is in the app's namespace, and nothing else.
      new eks.CfnAccessEntry(this, "DeployAccess", {
        clusterName: cluster.ref,
        principalArn: config.deployRoleArn,
        type: "STANDARD",
        accessPolicies: [
          {
            policyArn: accessPolicy("AmazonEKSEditPolicy"),
            accessScope: { type: "namespace", namespaces: [NAMESPACE] },
          },
        ],
      });
    }
    // #endregion deploy-access

    // #region pod-identity
    // What the app's code acts as. This app calls no AWS API, so the role stays empty.
    const podRole = new iam.Role(this, "PodRole", {
      assumedBy: new iam.ServicePrincipal("pods.eks.amazonaws.com"),
    });
    podRole.assumeRolePolicy?.addStatements(
      new iam.PolicyStatement({
        actions: ["sts:TagSession"],
        principals: [new iam.ServicePrincipal("pods.eks.amazonaws.com")],
      }),
    );
    // The link is in AWS, not in the cluster: pods of this service account, in this namespace, get this role.
    new eks.CfnPodIdentityAssociation(this, "PodIdentity", {
      clusterName: cluster.ref,
      namespace: NAMESPACE,
      serviceAccount: SERVICE_ACCOUNT,
      roleArn: podRole.roleArn,
    });
    // #endregion pod-identity

    new CfnOutput(this, "ClusterName", { value: cluster.ref });
    new CfnOutput(this, "NodeRoleName", { value: nodeRole.roleName });
    new CfnOutput(this, "ClusterSecurityGroupId", { value: cluster.attrClusterSecurityGroupId });
    new CfnOutput(this, "PodRoleArn", { value: podRole.roleArn });
  }
}
