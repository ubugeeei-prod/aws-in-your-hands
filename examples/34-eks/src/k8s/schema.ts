// Schemas for the Kubernetes objects this chapter writes, and only for the fields it uses.
// Every object is strict: a field that is not listed here is refused, so a typo such as
// `readinesProbe` fails a test on the laptop. The API server's own validation is far larger.

import * as v from "valibot";

// #region scalars
/** A DNS-1123 label: what Kubernetes accepts as the name of most objects. */
const name = v.pipe(
  v.string(),
  v.maxLength(63),
  v.regex(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, "use lowercase letters, digits, and '-'"),
);

/** v.record alone would accept an array, which is never a set of labels. */
const stringMap = v.pipe(
  v.custom<Record<string, string>>(
    (input) => typeof input === "object" && input !== null && !Array.isArray(input),
    "expected an object of strings",
  ),
  v.record(v.string(), v.string()),
);

/** CPU in millicores and memory in binary units: the two spellings this chapter writes. */
const cpu = v.pipe(v.string(), v.regex(/^[1-9]\d*m$/, "write CPU in millicores, such as 250m"));
const memory = v.pipe(v.string(), v.regex(/^[1-9]\d*(Mi|Gi)$/, "write memory as 512Mi or 1Gi"));

const port = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65_535));
const seconds = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(3600));
const count = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1000));

/** A whole number of pods, or a share of them. */
export const intOrPercent = v.union([
  count,
  v.pipe(v.string(), v.regex(/^(100|[1-9]?\d)%$/, "write a percentage from 0% to 100%")),
]);

const image = v.pipe(
  v.string(),
  v.regex(
    /^[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/,
    "write the image as repository:tag",
  ),
  // The same rule chapter 12 applies to its image tag.
  v.check((value) => !value.endsWith(":latest"), "name the build; 'latest' says nothing"),
);

const metadata = v.strictObject({
  name,
  namespace: v.optional(name),
  labels: v.optional(stringMap),
  annotations: v.optional(stringMap),
});
const selector = v.strictObject({ matchLabels: stringMap });
// #endregion scalars

// #region workload
const probe = v.strictObject({
  httpGet: v.strictObject({ path: v.pipe(v.string(), v.startsWith("/")), port: name }),
  periodSeconds: v.pipe(seconds, v.minValue(1)),
  timeoutSeconds: v.pipe(seconds, v.minValue(1)),
  failureThreshold: v.pipe(count, v.minValue(1)),
});

const container = v.strictObject({
  name,
  image,
  ports: v.array(v.strictObject({ name, containerPort: port })),
  env: v.array(v.strictObject({ name: v.pipe(v.string(), v.minLength(1)), value: v.string() })),
  resources: v.strictObject({
    requests: v.strictObject({ cpu, memory }),
    // No CPU limit: a limit throttles the pod even while the node sits idle.
    limits: v.strictObject({ memory }),
  }),
  readinessProbe: probe,
  livenessProbe: probe,
  lifecycle: v.strictObject({
    preStop: v.strictObject({ sleep: v.strictObject({ seconds }) }),
  }),
  securityContext: v.strictObject({
    allowPrivilegeEscalation: v.literal(false),
    readOnlyRootFilesystem: v.literal(true),
    capabilities: v.strictObject({ drop: v.tuple([v.literal("ALL")]) }),
  }),
});

export const deploymentSchema = v.strictObject({
  apiVersion: v.literal("apps/v1"),
  kind: v.literal("Deployment"),
  metadata,
  spec: v.strictObject({
    replicas: v.pipe(count, v.minValue(1)),
    minReadySeconds: seconds,
    strategy: v.strictObject({
      type: v.literal("RollingUpdate"),
      rollingUpdate: v.strictObject({ maxSurge: intOrPercent, maxUnavailable: intOrPercent }),
    }),
    selector,
    template: v.strictObject({
      metadata: v.strictObject({ labels: stringMap }),
      spec: v.strictObject({
        serviceAccountName: name,
        terminationGracePeriodSeconds: seconds,
        nodeSelector: stringMap,
        topologySpreadConstraints: v.array(
          v.strictObject({
            maxSkew: v.pipe(count, v.minValue(1)),
            topologyKey: v.string(),
            whenUnsatisfiable: v.picklist(["DoNotSchedule", "ScheduleAnyway"]),
            labelSelector: selector,
          }),
        ),
        securityContext: v.strictObject({
          runAsNonRoot: v.literal(true),
          runAsUser: v.pipe(v.number(), v.integer(), v.minValue(1)),
          seccompProfile: v.strictObject({ type: v.literal("RuntimeDefault") }),
        }),
        containers: v.pipe(v.array(container), v.minLength(1)),
      }),
    }),
  }),
});

export const budgetSchema = v.strictObject({
  apiVersion: v.literal("policy/v1"),
  kind: v.literal("PodDisruptionBudget"),
  metadata,
  spec: v.pipe(
    v.strictObject({
      minAvailable: v.optional(intOrPercent),
      maxUnavailable: v.optional(intOrPercent),
      selector,
      unhealthyPodEvictionPolicy: v.picklist(["IfHealthyBudget", "AlwaysAllow"]),
    }),
    v.check(
      (spec) => (spec.minAvailable === undefined) !== (spec.maxUnavailable === undefined),
      "set exactly one of minAvailable and maxUnavailable",
    ),
  ),
});
// #endregion workload

// #region network
export const serviceSchema = v.strictObject({
  apiVersion: v.literal("v1"),
  kind: v.literal("Service"),
  metadata,
  spec: v.strictObject({
    type: v.literal("ClusterIP"),
    selector: stringMap,
    ports: v.array(v.strictObject({ name, port, targetPort: name })),
  }),
});

export const ingressSchema = v.strictObject({
  apiVersion: v.literal("networking.k8s.io/v1"),
  kind: v.literal("Ingress"),
  metadata,
  spec: v.strictObject({
    ingressClassName: name,
    rules: v.array(
      v.strictObject({
        http: v.strictObject({
          paths: v.array(
            v.strictObject({
              path: v.pipe(v.string(), v.startsWith("/")),
              pathType: v.picklist(["Prefix", "Exact"]),
              backend: v.strictObject({
                service: v.strictObject({ name, port: v.strictObject({ number: port }) }),
              }),
            }),
          ),
        }),
      }),
    ),
  }),
});

export const ingressClassSchema = v.strictObject({
  apiVersion: v.literal("networking.k8s.io/v1"),
  kind: v.literal("IngressClass"),
  metadata,
  spec: v.strictObject({
    // The load balancing that EKS Auto Mode runs, not a controller installed in the cluster.
    controller: v.literal("eks.amazonaws.com/alb"),
    parameters: v.strictObject({
      apiGroup: v.literal("eks.amazonaws.com"),
      kind: v.literal("IngressClassParams"),
      name,
    }),
  }),
});

export const ingressClassParamsSchema = v.strictObject({
  apiVersion: v.literal("eks.amazonaws.com/v1"),
  kind: v.literal("IngressClassParams"),
  metadata,
  spec: v.strictObject({
    scheme: v.picklist(["internet-facing", "internal"]),
    subnets: v.strictObject({
      matchTags: v.array(v.strictObject({ key: v.string(), values: v.array(v.string()) })),
    }),
  }),
});
// #endregion network

// #region cluster
export const namespaceSchema = v.strictObject({
  apiVersion: v.literal("v1"),
  kind: v.literal("Namespace"),
  metadata,
});

export const serviceAccountSchema = v.strictObject({
  apiVersion: v.literal("v1"),
  kind: v.literal("ServiceAccount"),
  metadata,
});

export const nodeClassSchema = v.strictObject({
  apiVersion: v.literal("eks.amazonaws.com/v1"),
  kind: v.literal("NodeClass"),
  metadata,
  spec: v.strictObject({
    role: v.pipe(v.string(), v.regex(/^[\w+=,.@-]{1,64}$/, "write the role's name, not its ARN")),
    subnetSelectorTerms: v.pipe(v.array(v.strictObject({ tags: stringMap })), v.minLength(1)),
    securityGroupSelectorTerms: v.pipe(
      v.array(v.strictObject({ id: v.pipe(v.string(), v.regex(/^sg-[0-9a-f]{8,17}$/)) })),
      v.minLength(1),
    ),
    ephemeralStorage: v.strictObject({
      size: v.pipe(v.string(), v.regex(/^[1-9]\d*Gi$/)),
    }),
    advancedNetworking: v.strictObject({ associatePublicIPAddress: v.boolean() }),
  }),
});

export const nodePoolSchema = v.strictObject({
  apiVersion: v.literal("karpenter.sh/v1"),
  kind: v.literal("NodePool"),
  metadata,
  spec: v.strictObject({
    template: v.strictObject({
      spec: v.strictObject({
        nodeClassRef: v.strictObject({
          group: v.literal("eks.amazonaws.com"),
          kind: v.literal("NodeClass"),
          name,
        }),
        requirements: v.array(
          v.strictObject({
            key: v.string(),
            operator: v.literal("In"),
            values: v.pipe(v.array(v.string()), v.minLength(1)),
          }),
        ),
      }),
    }),
    disruption: v.strictObject({
      consolidationPolicy: v.picklist(["WhenEmpty", "WhenEmptyOrUnderutilized", "Balanced"]),
      consolidateAfter: v.pipe(v.string(), v.regex(/^\d+(s|m|h)$/)),
    }),
    limits: v.strictObject({ cpu: v.pipe(v.string(), v.regex(/^[1-9]\d*$/)) }),
  }),
});
// #endregion cluster

// #region manifest
export const manifestSchema = v.variant("kind", [
  namespaceSchema,
  serviceAccountSchema,
  deploymentSchema,
  budgetSchema,
  serviceSchema,
  ingressSchema,
  ingressClassSchema,
  ingressClassParamsSchema,
  nodeClassSchema,
  nodePoolSchema,
]);

export type Manifest = v.InferOutput<typeof manifestSchema>;
export type Deployment = v.InferOutput<typeof deploymentSchema>;
export type Budget = v.InferOutput<typeof budgetSchema>;
export type Service = v.InferOutput<typeof serviceSchema>;
export type Ingress = v.InferOutput<typeof ingressSchema>;
export type NodeClass = v.InferOutput<typeof nodeClassSchema>;
export type NodePool = v.InferOutput<typeof nodePoolSchema>;

/** What `kubectl apply -f` reads from one file: several objects in a List. */
export const listSchema = v.strictObject({
  apiVersion: v.literal("v1"),
  kind: v.literal("List"),
  items: v.array(manifestSchema),
});
export type ManifestList = v.InferOutput<typeof listSchema>;

/** Parses a rendered file; the message names every field that is wrong. */
export function parseList(input: unknown): ManifestList {
  const result = v.safeParse(listSchema, input);
  if (!result.success) {
    const problems = result.issues.map(
      (item) => `  ${v.getDotPath(item) ?? "(root)"}: ${item.message}`,
    );
    throw new Error(`Invalid manifests:\n${problems.join("\n")}`);
  }
  return result.output;
}
// #endregion manifest
