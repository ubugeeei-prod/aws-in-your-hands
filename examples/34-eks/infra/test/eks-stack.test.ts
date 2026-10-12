import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import {
  CLUSTER_NAME,
  KUBERNETES_VERSION,
  NAMESPACE,
  parseEksConfig,
  SERVICE_ACCOUNT,
} from "../../src/config.ts";
import { appManifests } from "../../src/manifests.ts";
import { RELEASE_CALENDAR } from "../../src/support.ts";
import { EksStack } from "../lib/eks-stack.ts";

type Resource = { Type: string; Properties?: Record<string, unknown>; DeletionPolicy?: string };
type Statement = { Effect: string; Action: string | string[]; Principal: { Service: string } };

function synth(input: unknown) {
  const app = new App();
  const stack = new EksStack(app, "AihEks", {
    env: { region: "ap-northeast-1" },
    config: parseEksConfig(input),
  });
  const template = Template.fromStack(stack);
  const resources = template.toJSON()["Resources"] as Record<string, Resource>;
  const ofType = (type: string): [string, Resource][] =>
    Object.entries(resources).filter(([, resource]) => resource.Type === type);
  const role = (prefix: string): Resource => {
    const found = ofType("AWS::IAM::Role").find(([id]) => id.startsWith(prefix));
    if (found === undefined) {
      throw new Error(`no role whose logical ID starts with ${prefix}`);
    }
    return found[1];
  };
  return { template, resources, ofType, role, missing: app.synth().manifest.missing };
}

const DEPLOY_ROLE = "arn:aws:iam::123456789012:role/aih-deploy";
const alone = synth({});
const withDeployRole = synth({ deployRoleArn: DEPLOY_ROLE });

const trust = (role: Resource): Statement[] =>
  (role.Properties?.["AssumeRolePolicyDocument"] as { Statement: Statement[] } | undefined)
    ?.Statement ?? [];
const managed = (role: Resource): string[] =>
  ((role.Properties?.["ManagedPolicyArns"] ?? []) as unknown[]).map((arn) =>
    JSON.stringify(arn).replace(/^.*:policy\/([A-Za-z0-9]+).*$/, "$1"),
  );

describe("the cluster", () => {
  const { template, ofType } = alone;

  it("is an Auto Mode cluster with no built-in node pool, so it starts no node by itself", () => {
    template.hasResourceProperties("AWS::EKS::Cluster", {
      Name: CLUSTER_NAME,
      ComputeConfig: { Enabled: true },
      KubernetesNetworkConfig: { ElasticLoadBalancing: { Enabled: true } },
      StorageConfig: { BlockStorage: { Enabled: true } },
      BootstrapSelfManagedAddons: false,
    });
    const [[, cluster] = []] = ofType("AWS::EKS::Cluster");
    const compute = cluster?.Properties?.["ComputeConfig"] as Record<string, unknown>;
    expect(compute).not.toHaveProperty("NodePools");
    expect(compute).not.toHaveProperty("NodeRoleArn");
    expect(ofType("AWS::EKS::Nodegroup")).toEqual([]);
    expect(ofType("AWS::EKS::FargateProfile")).toEqual([]);
  });

  it("runs a version that is in standard support, and never drifts into extended support", () => {
    template.hasResourceProperties("AWS::EKS::Cluster", {
      Version: KUBERNETES_VERSION,
      UpgradePolicy: { SupportType: "STANDARD" },
    });
    const dates = RELEASE_CALENDAR.find((entry) => entry.version === KUBERNETES_VERSION);
    expect(dates).toBeDefined();
    // The newest version in the calendar: nothing in it leaves standard support later.
    expect(dates?.endOfStandardSupport).toBe(
      RELEASE_CALENDAR.map((entry) => entry.endOfStandardSupport)
        .toSorted()
        .at(-1),
    );
  });

  it("lets people in through access entries only", () => {
    template.hasResourceProperties("AWS::EKS::Cluster", {
      AccessConfig: { AuthenticationMode: "API", BootstrapClusterCreatorAdminPermissions: true },
    });
  });

  it("puts the control plane's interfaces in the private subnets of chapter 11", () => {
    template.hasResourceProperties("AWS::EKS::Cluster", {
      ResourcesVpcConfig: {
        SubnetIds: [
          { "Fn::ImportValue": "AihNetwork-Private1SubnetId" },
          { "Fn::ImportValue": "AihNetwork-Private2SubnetId" },
        ],
        EndpointPublicAccess: true,
        EndpointPrivateAccess: true,
      },
    });
  });

  it("can be destroyed: no deletion protection, and nothing is retained", () => {
    template.hasResourceProperties("AWS::EKS::Cluster", { DeletionProtection: false });
    for (const [id, resource] of Object.entries(alone.resources)) {
      expect(resource.DeletionPolicy ?? "Delete", id).toBe("Delete");
    }
  });
});

describe("the three roles", () => {
  const { role, ofType } = alone;

  it("gives EKS itself the five policies Auto Mode asks for, and lets only EKS assume the role", () => {
    const clusterRole = role("ClusterRole");
    expect(managed(clusterRole).toSorted()).toEqual([
      "AmazonEKSBlockStoragePolicyV2",
      "AmazonEKSClusterPolicy",
      "AmazonEKSComputePolicy",
      "AmazonEKSLoadBalancingPolicy",
      "AmazonEKSNetworkingPolicy",
    ]);
    expect(trust(clusterRole).map(({ Action, Principal }) => [Action, Principal.Service])).toEqual([
      ["sts:AssumeRole", "eks.amazonaws.com"],
      ["sts:TagSession", "eks.amazonaws.com"],
    ]);
  });

  it("gives a node what it needs to join and to pull an image, and nothing the app could use", () => {
    const nodeRole = role("NodeRole");
    expect(managed(nodeRole).toSorted()).toEqual([
      "AmazonEC2ContainerRegistryPullOnly",
      "AmazonEKSWorkerNodeMinimalPolicy",
    ]);
    expect(trust(nodeRole).map(({ Action, Principal }) => [Action, Principal.Service])).toEqual([
      ["sts:AssumeRole", "ec2.amazonaws.com"],
    ]);
  });

  it("gives the app's code no permission at all, through Pod Identity and not through the node", () => {
    const podRole = role("PodRole");
    expect(podRole.Properties).not.toHaveProperty("ManagedPolicyArns");
    expect(podRole.Properties).not.toHaveProperty("Policies");
    expect(trust(podRole).map(({ Action, Principal }) => [Action, Principal.Service])).toEqual([
      ["sts:AssumeRole", "pods.eks.amazonaws.com"],
      ["sts:TagSession", "pods.eks.amazonaws.com"],
    ]);
    // No inline policy anywhere, and no OIDC provider: that would be IRSA.
    expect(ofType("AWS::IAM::Policy")).toEqual([]);
    expect(ofType("AWS::IAM::OIDCProvider")).toEqual([]);
  });

  it("ties the pod role to the very service account the Deployment runs as", () => {
    alone.template.hasResourceProperties("AWS::EKS::PodIdentityAssociation", {
      ClusterName: { Ref: "Cluster" },
      Namespace: NAMESPACE,
      ServiceAccount: SERVICE_ACCOUNT,
      RoleArn: { "Fn::GetAtt": [Match.stringLikeRegexp("^PodRole"), "Arn"] },
    });
    const { items } = appManifests({
      image: "example.invalid/notes:v1",
      allowedOrigin: "http://localhost:5173",
    });
    const deployment = items.find((item) => item.kind === "Deployment");
    expect(deployment?.metadata.namespace).toBe(NAMESPACE);
    expect(deployment?.spec.template.spec.serviceAccountName).toBe(SERVICE_ACCOUNT);
  });
});

describe("who may use the Kubernetes API", () => {
  const entries = (layout: typeof alone) =>
    layout.ofType("AWS::EKS::AccessEntry").map(([, entry]) => entry.Properties);

  it("by default: the nodes, as nodes, and nobody else by an entry of this stack", () => {
    expect(entries(alone)).toEqual([
      {
        ClusterName: { Ref: "Cluster" },
        PrincipalArn: { "Fn::GetAtt": [expect.stringMatching(/^NodeRole/), "Arn"] },
        Type: "EC2",
        AccessPolicies: [
          {
            PolicyArn: "arn:aws:eks::aws:cluster-access-policy/AmazonEKSAutoNodePolicy",
            AccessScope: { Type: "cluster" },
          },
        ],
      },
    ]);
  });

  it("with deployRoleArn: that role may edit the app's namespace, and is not a cluster admin", () => {
    const [deploy] = entries(withDeployRole).filter((entry) => entry?.["Type"] === "STANDARD");
    expect(deploy).toEqual({
      ClusterName: { Ref: "Cluster" },
      PrincipalArn: DEPLOY_ROLE,
      Type: "STANDARD",
      AccessPolicies: [
        {
          PolicyArn: "arn:aws:eks::aws:cluster-access-policy/AmazonEKSEditPolicy",
          AccessScope: { Type: "namespace", Namespaces: [NAMESPACE] },
        },
      ],
    });
    expect(JSON.stringify(withDeployRole.resources)).not.toContain("ClusterAdminPolicy");
  });

  it("refuses a deploy role that is not the ARN of a role", () => {
    expect(() => parseEksConfig({ deployRoleArn: "aih-deploy" })).toThrow(/deployRoleArn/);
    expect(() => parseEksConfig({ deployRoleArn: "arn:aws:iam::123456789012:user/me" })).toThrow();
  });
});

describe("what cdkd is asked to create", () => {
  it("asks AWS nothing during synthesis, and names no account", () => {
    expect(alone.missing).toBeUndefined();
    // An account ID would show up as the fifth field of an ARN.
    expect(/:\d{12}:/.test(JSON.stringify(alone.resources))).toBe(false);
  });

  it("uses no custom resource, no Lambda function, and no nested stack", () => {
    const types = Object.values(withDeployRole.resources).map((resource) => resource.Type);
    expect(types.filter((type) => type.startsWith("Custom::"))).toEqual([]);
    expect(types).not.toContain("AWS::Lambda::Function");
    expect(types).not.toContain("AWS::CloudFormation::Stack");
    expect(types).not.toContain("AWS::CloudFormation::CustomResource");
  });

  it("uses only resource types that were checked against the pinned cdkd", () => {
    // From the property coverage table in the bundled source of @go-to-k/cdkd 0.296.28.
    const handled: Record<string, string[]> = {
      "AWS::IAM::Role": ["AssumeRolePolicyDocument", "ManagedPolicyArns"],
    };
    // cdkd 0.296.28 registers no provider for any AWS::EKS type, and none of these is on
    // its list of types Cloud Control cannot provision. So all three go through Cloud Control.
    const viaCloudControl = [
      "AWS::EKS::AccessEntry",
      "AWS::EKS::Cluster",
      "AWS::EKS::PodIdentityAssociation",
    ];

    const types = [
      ...new Set(Object.values(withDeployRole.resources).map((resource) => resource.Type)),
    ].toSorted();
    expect(types).toEqual([...Object.keys(handled), ...viaCloudControl].toSorted());
    for (const [id, resource] of Object.entries(withDeployRole.resources)) {
      const allowed = handled[resource.Type];
      if (allowed !== undefined) {
        expect(allowed, id).toEqual(expect.arrayContaining(Object.keys(resource.Properties ?? {})));
      }
    }
  });
});
