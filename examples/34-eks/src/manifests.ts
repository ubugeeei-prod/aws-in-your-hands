import { NETWORK_STACK } from "@aih/example-11-network/src/exports.ts";

import {
  APP_NAME,
  NAMESPACE,
  NODES,
  type NodeSubnets,
  POD,
  SERVICE_ACCOUNT,
  WORKLOAD,
} from "./config.ts";
import type {
  Budget,
  Deployment,
  Ingress,
  Manifest,
  ManifestList,
  NodeClass,
  NodePool,
  Service,
} from "./k8s/schema.ts";
import { podTiming } from "./timing.ts";

const labels = { "app.kubernetes.io/name": APP_NAME };
const HTTP = "http";
const NODE_CLASS = "notes";
const INGRESS_CLASS = "notes-alb";

export const list = (items: Manifest[]): ManifestList => ({
  apiVersion: "v1",
  kind: "List",
  items,
});

// #region cluster-input
export type ClusterInput = {
  /** The name of the node role, from the stack's NodeRoleName output. */
  nodeRole: string;
  /** The cluster security group, from the stack's ClusterSecurityGroupId output. */
  securityGroupId: string;
  nodeSubnets: NodeSubnets;
};

/** Chapter 11 names its subnets "AihNetwork/Public1" and so on. Both selectors below find them by that tag. */
const subnetNames = (tier: "Public" | "Private"): string[] =>
  [1, 2].map((number) => `${NETWORK_STACK}/${tier}${number}`);
// #endregion cluster-input

// #region nodes
export function nodeClass(input: ClusterInput): NodeClass {
  const inPublic = input.nodeSubnets === "public";
  return {
    apiVersion: "eks.amazonaws.com/v1",
    kind: "NodeClass",
    metadata: { name: NODE_CLASS },
    spec: {
      role: input.nodeRole,
      subnetSelectorTerms: subnetNames(inPublic ? "Public" : "Private").map((Name) => ({
        tags: { Name },
      })),
      securityGroupSelectorTerms: [{ id: input.securityGroupId }],
      ephemeralStorage: { size: `${NODES.ephemeralStorageGiB}Gi` },
      // In a public subnet a node has no way to ECR or to the cluster without an address of its own.
      advancedNetworking: { associatePublicIPAddress: inPublic },
    },
  };
}

export function nodePool(): NodePool {
  return {
    apiVersion: "karpenter.sh/v1",
    kind: "NodePool",
    metadata: { name: "notes" },
    spec: {
      template: {
        spec: {
          nodeClassRef: { group: "eks.amazonaws.com", kind: "NodeClass", name: NODE_CLASS },
          requirements: [
            // Chapter 12 builds the image for arm64. The built-in general-purpose pool is amd64 only.
            { key: "kubernetes.io/arch", operator: "In", values: ["arm64"] },
            { key: "karpenter.sh/capacity-type", operator: "In", values: ["on-demand"] },
            {
              key: "node.kubernetes.io/instance-type",
              operator: "In",
              values: [NODES.instanceType],
            },
          ],
        },
      },
      disruption: { consolidationPolicy: "WhenEmptyOrUnderutilized", consolidateAfter: "30s" },
      // Past this many vCPUs Auto Mode starts no more nodes. A bound on the bill.
      limits: { cpu: String(NODES.cpuLimit) },
    },
  };
}
// #endregion nodes

// #region cluster
/** What a cluster administrator applies once: the namespace, the nodes, and the class of load balancer. */
export function clusterManifests(input: ClusterInput): ManifestList {
  return list([
    { apiVersion: "v1", kind: "Namespace", metadata: { name: NAMESPACE } },
    nodeClass(input),
    nodePool(),
    {
      apiVersion: "eks.amazonaws.com/v1",
      kind: "IngressClassParams",
      metadata: { name: INGRESS_CLASS },
      spec: {
        scheme: "internet-facing",
        // Chapter 11's subnets carry no kubernetes.io/role/elb tag, so they are named here.
        subnets: { matchTags: [{ key: "Name", values: subnetNames("Public") }] },
      },
    },
    {
      apiVersion: "networking.k8s.io/v1",
      kind: "IngressClass",
      metadata: { name: INGRESS_CLASS },
      spec: {
        controller: "eks.amazonaws.com/alb",
        parameters: {
          apiGroup: "eks.amazonaws.com",
          kind: "IngressClassParams",
          name: INGRESS_CLASS,
        },
      },
    },
  ]);
}
// #endregion cluster

// #region app-input
export type AppInput = {
  /** repository:tag, as chapter 12 pushed it. */
  image: string;
  allowedOrigin: string;
};

const tagOf = (image: string): string => image.slice(image.lastIndexOf(":") + 1);
// #endregion app-input

// #region deployment
export function deployment(input: AppInput): Deployment {
  const probe = { httpGet: { path: "/health", port: HTTP }, timeoutSeconds: 2 };
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: APP_NAME, namespace: NAMESPACE, labels },
    spec: {
      replicas: WORKLOAD.replicas,
      minReadySeconds: podTiming.minReadySeconds,
      strategy: {
        type: "RollingUpdate",
        rollingUpdate: { maxSurge: WORKLOAD.maxSurge, maxUnavailable: WORKLOAD.maxUnavailable },
      },
      selector: { matchLabels: labels },
      template: {
        metadata: { labels },
        spec: {
          // The Pod Identity association in the stack names this service account.
          serviceAccountName: SERVICE_ACCOUNT,
          terminationGracePeriodSeconds: podTiming.terminationGracePeriod,
          nodeSelector: { "kubernetes.io/arch": "arm64" },
          // One zone going away must not take every pod with it.
          topologySpreadConstraints: [
            {
              maxSkew: 1,
              topologyKey: "topology.kubernetes.io/zone",
              whenUnsatisfiable: "DoNotSchedule",
              labelSelector: { matchLabels: labels },
            },
          ],
          securityContext: {
            runAsNonRoot: true,
            // The "node" user of the base image. runAsNonRoot cannot check a user given by name.
            runAsUser: 1000,
            seccompProfile: { type: "RuntimeDefault" },
          },
          containers: [
            {
              name: "api",
              image: input.image,
              ports: [{ name: HTTP, containerPort: POD.containerPort }],
              env: [
                { name: "PORT", value: String(POD.containerPort) },
                { name: "ALLOWED_ORIGIN", value: input.allowedOrigin },
                { name: "LOG_LEVEL", value: "info" },
                { name: "STAGE", value: "dev" },
                { name: "APP_VERSION", value: tagOf(input.image) },
              ],
              resources: {
                requests: { cpu: `${POD.cpuMillis}m`, memory: `${POD.memoryMiB}Mi` },
                limits: { memory: `${POD.memoryMiB}Mi` },
              },
              readinessProbe: {
                ...probe,
                periodSeconds: podTiming.readinessPeriod,
                failureThreshold: podTiming.readinessFailureThreshold,
              },
              livenessProbe: {
                ...probe,
                periodSeconds: podTiming.livenessPeriod,
                failureThreshold: podTiming.livenessFailureThreshold,
              },
              // The kubelet sleeps before it sends SIGTERM, so the load balancer stops sending first.
              lifecycle: { preStop: { sleep: { seconds: podTiming.preStopSleep } } },
              securityContext: {
                allowPrivilegeEscalation: false,
                readOnlyRootFilesystem: true,
                capabilities: { drop: ["ALL"] },
              },
            },
          ],
        },
      },
    },
  };
}
// #endregion deployment

// #region budget
export function budget(): Budget {
  return {
    apiVersion: "policy/v1",
    kind: "PodDisruptionBudget",
    metadata: { name: APP_NAME, namespace: NAMESPACE },
    spec: {
      maxUnavailable: WORKLOAD.budgetMaxUnavailable,
      selector: { matchLabels: labels },
      // A pod that never became ready must not be able to hold a node forever.
      unhealthyPodEvictionPolicy: "AlwaysAllow",
    },
  };
}
// #endregion budget

// #region traffic
export function service(): Service {
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name: APP_NAME, namespace: NAMESPACE },
    spec: {
      type: "ClusterIP",
      selector: labels,
      ports: [{ name: HTTP, port: 80, targetPort: HTTP }],
    },
  };
}

export function ingress(): Ingress {
  const alb = (key: string): string => `alb.ingress.kubernetes.io/${key}`;
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "Ingress",
    metadata: {
      name: APP_NAME,
      namespace: NAMESPACE,
      // The same health check and the same deregistration delay as chapter 12's target group.
      annotations: {
        [alb("healthcheck-path")]: "/health",
        [alb("success-codes")]: "200",
        [alb("healthcheck-interval-seconds")]: String(podTiming.healthCheckInterval),
        [alb("healthcheck-timeout-seconds")]: String(podTiming.healthCheckTimeout),
        [alb("healthy-threshold-count")]: String(podTiming.healthyThreshold),
        [alb("unhealthy-threshold-count")]: String(podTiming.unhealthyThreshold),
        [alb("target-group-attributes")]:
          `deregistration_delay.timeout_seconds=${podTiming.deregistrationDelay}`,
      },
    },
    spec: {
      ingressClassName: INGRESS_CLASS,
      rules: [
        {
          http: {
            paths: [
              {
                path: "/",
                pathType: "Prefix",
                backend: { service: { name: APP_NAME, port: { number: 80 } } },
              },
            ],
          },
        },
      ],
    },
  };
}
// #endregion traffic

// #region app
/** What the deploy role applies on every release. Everything here lives in one namespace. */
export function appManifests(input: AppInput): ManifestList {
  return list([
    {
      apiVersion: "v1",
      kind: "ServiceAccount",
      metadata: { name: SERVICE_ACCOUNT, namespace: NAMESPACE },
    },
    deployment(input),
    budget(),
    service(),
    ingress(),
  ]);
}
// #endregion app
