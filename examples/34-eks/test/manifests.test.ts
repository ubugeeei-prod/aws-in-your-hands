import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { timing } from "@aih/example-12-containers/src/timing.ts";

import { NAMESPACE, NODES, POD, WORKLOAD } from "../src/config.ts";
import { referenceProblems, schedulingProblems } from "../src/k8s/check.ts";
import { type Deployment, type Manifest, parseList } from "../src/k8s/schema.ts";
import { appManifests, clusterManifests } from "../src/manifests.ts";
import { EXAMPLE_APP, EXAMPLE_CLUSTER, renderedFiles } from "../src/rendered.ts";
import { podTiming } from "../src/timing.ts";

const committed = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../k8s/${name}`, import.meta.url), "utf8"));

const cluster = clusterManifests(EXAMPLE_CLUSTER);
const app = appManifests(EXAMPLE_APP);
const all = (): Manifest[] => structuredClone([...cluster.items, ...app.items]);

const find = <Kind extends Manifest["kind"]>(items: Manifest[], kind: Kind) => {
  const found = items.find((item): item is Extract<Manifest, { kind: Kind }> => item.kind === kind);
  if (found === undefined) {
    throw new Error(`no ${kind} among the manifests`);
  }
  return found;
};
const container = (deployment: Deployment) => {
  const [first] = deployment.spec.template.spec.containers;
  if (first === undefined) {
    throw new Error("the Deployment has no container");
  }
  return first;
};

describe("the files in k8s/", () => {
  it.each(Object.entries(renderedFiles()))("%s is what the generators produce", (name, list) => {
    expect(committed(name)).toEqual(list);
  });

  it.each(["cluster.json", "app.json"])("%s passes the schemas", (name) => {
    expect(() => parseList(committed(name))).not.toThrow();
  });

  it("hold no reference that leads nowhere, and no pod that could not be scheduled", () => {
    expect(referenceProblems(all())).toEqual([]);
    expect(schedulingProblems(all())).toEqual([]);
  });
});

// #region refused
describe("what the schemas refuse", () => {
  const broken = (change: (deployment: Deployment) => void): unknown => {
    const items = structuredClone(app.items);
    change(find(items, "Deployment"));
    return { apiVersion: "v1", kind: "List", items };
  };

  it("a misspelt field, which the API server would drop or refuse", () => {
    const list = broken((deployment) => {
      const spec = container(deployment) as Record<string, unknown>;
      spec["readinesProbe"] = spec["readinessProbe"];
      delete spec["readinessProbe"];
    });
    expect(() => parseList(list)).toThrow(/readinessProbe/);
  });

  it("the tag latest, and an image without a tag", () => {
    for (const image of ["example.invalid/notes:latest", "example.invalid/notes"]) {
      expect(() =>
        parseList(broken((deployment) => (container(deployment).image = image))),
      ).toThrow(/image/);
    }
  });

  it("a container that may write to its own filesystem or gain privileges", () => {
    const list = broken((deployment) => {
      const context = container(deployment).securityContext as Record<string, unknown>;
      context["readOnlyRootFilesystem"] = false;
      context["allowPrivilegeEscalation"] = true;
    });
    expect(() => parseList(list)).toThrow(/securityContext/);
  });

  it("memory written in a unit the chapter does not use", () => {
    const list = broken((deployment) => (container(deployment).resources.requests.memory = "512M"));
    expect(() => parseList(list)).toThrow(/memory/);
  });

  it("a budget with both numbers, or with neither", () => {
    const withBudget = (spec: Record<string, unknown>): unknown => ({
      apiVersion: "v1",
      kind: "List",
      items: [{ ...find(app.items, "PodDisruptionBudget"), spec }],
    });
    const selector = { matchLabels: { "app.kubernetes.io/name": "notes-api" } };
    const policy = { unhealthyPodEvictionPolicy: "AlwaysAllow" };
    expect(() => parseList(withBudget({ selector, ...policy }))).toThrow(/exactly one/);
    expect(() =>
      parseList(withBudget({ selector, ...policy, minAvailable: 1, maxUnavailable: 1 })),
    ).toThrow(/exactly one/);
  });

  it("a kind the chapter has no schema for", () => {
    const list = { apiVersion: "v1", kind: "List", items: [{ apiVersion: "v1", kind: "Secret" }] };
    expect(() => parseList(list)).toThrow(/kind/);
  });
});
// #endregion refused

// #region silent
describe("mistakes Kubernetes accepts and the checks do not", () => {
  it("a Service whose selector matches no pod", () => {
    const items = all();
    find(items, "Service").spec.selector = { "app.kubernetes.io/name": "notes" };
    expect(referenceProblems(items)).toEqual(["Service notes-api: the selector matches no pod"]);
  });

  it("a budget that selects nothing, and so protects nothing", () => {
    const items = all();
    find(items, "PodDisruptionBudget").spec.selector.matchLabels = { app: "notes-api" };
    expect(referenceProblems(items)).toEqual([
      "Deployment notes-api: 0 disruption budgets select its pods",
    ]);
  });

  it("an Ingress that points at a port the Service does not have", () => {
    const items = all();
    const [rule] = find(items, "Ingress").spec.rules;
    const [path] = rule?.http.paths ?? [];
    if (path !== undefined) {
      path.backend.service.port.number = 8080;
    }
    expect(referenceProblems(items)).toEqual([
      'Ingress notes-api: no service "notes-api" listens on 8080',
    ]);
  });

  it("a service account under another name than the one Pod Identity knows", () => {
    const items = all();
    find(items, "ServiceAccount").metadata.name = "default";
    expect(referenceProblems(items)).toEqual([
      'Deployment notes-api: service account "notes-api" is not defined',
    ]);
  });

  it("a pod that asks for amd64 when the only node pool is arm64", () => {
    const items = all();
    find(items, "Deployment").spec.template.spec.nodeSelector = { "kubernetes.io/arch": "amd64" };
    expect(schedulingProblems(items)).toEqual([
      'Deployment notes-api: no node pool provides {"kubernetes.io/arch":"amd64"}',
    ]);
  });

  it("the app's objects applied before the namespace exists", () => {
    expect(referenceProblems(structuredClone(app.items))).toEqual(
      expect.arrayContaining([`ServiceAccount notes-api: namespace "${NAMESPACE}" is not defined`]),
    );
  });
});
// #endregion silent

describe("what the manifests say", () => {
  const deployment = find(app.items, "Deployment");
  const api = container(deployment);

  it("runs the pod the size of chapter 12's task, with no CPU limit", () => {
    expect(api.resources).toEqual({
      requests: { cpu: "250m", memory: "512Mi" },
      limits: { memory: "512Mi" },
    });
    expect(api.ports).toEqual([{ name: "http", containerPort: POD.containerPort }]);
  });

  it("gives the container the same environment as chapter 12's task definition", () => {
    expect(Object.fromEntries(api.env.map((item) => [item.name, item.value]))).toEqual({
      PORT: "8080",
      ALLOWED_ORIGIN: "http://localhost:5173",
      LOG_LEVEL: "info",
      STAGE: "dev",
      APP_VERSION: "v1",
    });
  });

  it("stops a pod the way chapter 12's server expects to be stopped", () => {
    const afterSigterm = deployment.spec.template.spec.terminationGracePeriodSeconds - 15;
    expect(api.lifecycle.preStop.sleep.seconds).toBe(podTiming.preStopSleep);
    // The server gives up at 25 seconds; SIGKILL must come after that, as on Fargate.
    expect(afterSigterm).toBe(timing.stopTimeout);
    expect(afterSigterm).toBeGreaterThan(timing.shutdownDeadline);
  });

  it("gives the load balancer the health check and the delay of chapter 12's target group", () => {
    const annotations = find(app.items, "Ingress").metadata.annotations ?? {};
    const alb = (key: string): string | undefined =>
      annotations[`alb.ingress.kubernetes.io/${key}`];
    expect(alb("healthcheck-path")).toBe("/health");
    expect(alb("healthcheck-interval-seconds")).toBe(String(timing.healthCheckInterval));
    expect(alb("healthcheck-timeout-seconds")).toBe(String(timing.healthCheckTimeout));
    expect(alb("target-group-attributes")).toBe(
      `deregistration_delay.timeout_seconds=${timing.deregistrationDelay}`,
    );
  });

  it("never takes a ready pod away during a rollout, and spreads the pods over zones", () => {
    expect(deployment.spec.replicas).toBe(WORKLOAD.replicas);
    expect(deployment.spec.strategy.rollingUpdate).toEqual({ maxSurge: "100%", maxUnavailable: 0 });
    expect(deployment.spec.template.spec.topologySpreadConstraints).toEqual([
      expect.objectContaining({
        topologyKey: "topology.kubernetes.io/zone",
        whenUnsatisfiable: "DoNotSchedule",
      }),
    ]);
  });

  it("runs as the image's unprivileged user", () => {
    expect(deployment.spec.template.spec.securityContext).toMatchObject({
      runAsNonRoot: true,
      runAsUser: 1000,
    });
  });

  it("puts everything the deploy role applies in the one namespace it may edit", () => {
    for (const item of app.items) {
      expect(item.metadata.namespace, item.kind).toBe(NAMESPACE);
    }
    // What is left needs a cluster administrator.
    expect(cluster.items.map((item) => [item.kind, item.metadata.namespace])).toEqual([
      ["Namespace", undefined],
      ["NodeClass", undefined],
      ["NodePool", undefined],
      ["IngressClassParams", undefined],
      ["IngressClass", undefined],
    ]);
  });
});

describe("where the nodes live", () => {
  const nodeClassOf = (nodeSubnets: "public" | "private") =>
    find(clusterManifests({ ...EXAMPLE_CLUSTER, nodeSubnets }).items, "NodeClass").spec;

  it("by default: chapter 11's public subnets, each node with an address of its own", () => {
    expect(nodeClassOf("public")).toMatchObject({
      subnetSelectorTerms: [
        { tags: { Name: "AihNetwork/Public1" } },
        { tags: { Name: "AihNetwork/Public2" } },
      ],
      advancedNetworking: { associatePublicIPAddress: true },
    });
  });

  it("with --node-subnets private: the private subnets, and no public address", () => {
    expect(nodeClassOf("private")).toMatchObject({
      subnetSelectorTerms: [
        { tags: { Name: "AihNetwork/Private1" } },
        { tags: { Name: "AihNetwork/Private2" } },
      ],
      advancedNetworking: { associatePublicIPAddress: false },
    });
  });

  it("keeps the load balancer in the public subnets either way", () => {
    for (const nodeSubnets of ["public", "private"] as const) {
      const { items } = clusterManifests({ ...EXAMPLE_CLUSTER, nodeSubnets });
      expect(find(items, "IngressClassParams").spec).toEqual({
        scheme: "internet-facing",
        subnets: {
          matchTags: [{ key: "Name", values: ["AihNetwork/Public1", "AihNetwork/Public2"] }],
        },
      });
    }
  });

  it("caps what Auto Mode may start: one arm64 instance type, on demand, up to the CPU limit", () => {
    const pool = find(cluster.items, "NodePool").spec;
    expect(pool.template.spec.requirements).toEqual([
      { key: "kubernetes.io/arch", operator: "In", values: ["arm64"] },
      { key: "karpenter.sh/capacity-type", operator: "In", values: ["on-demand"] },
      { key: "node.kubernetes.io/instance-type", operator: "In", values: [NODES.instanceType] },
    ]);
    expect(pool.limits).toEqual({ cpu: "8" });
    expect(NODES.cpuLimit / NODES.vcpusPerNode).toBe(4);
  });
});
