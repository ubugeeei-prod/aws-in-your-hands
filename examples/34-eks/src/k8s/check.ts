import type { Manifest } from "./schema.ts";

type Labels = Record<string, string>;

const selects = (selector: Labels, labels: Labels): boolean =>
  Object.keys(selector).length > 0 &&
  Object.entries(selector).every(([key, value]) => labels[key] === value);

const of = <Kind extends Manifest["kind"]>(
  items: Manifest[],
  kind: Kind,
): Extract<Manifest, { kind: Kind }>[] =>
  items.filter((item): item is Extract<Manifest, { kind: Kind }> => item.kind === kind);

const inNamespace = (item: Manifest, namespace: string | undefined): boolean =>
  item.metadata.namespace === namespace;

// #region references
/**
 * What a schema for one object cannot see: the names and labels by which the objects
 * find each other. Kubernetes accepts every one of these mistakes without a word; the
 * Service then has no endpoints, or the budget protects nothing.
 */
export function referenceProblems(items: Manifest[]): string[] {
  const problems: string[] = [];
  const namespaces = new Set(of(items, "Namespace").map((item) => item.metadata.name));

  for (const item of items) {
    const namespace = item.metadata.namespace;
    if (namespace !== undefined && !namespaces.has(namespace)) {
      problems.push(`${item.kind} ${item.metadata.name}: namespace "${namespace}" is not defined`);
    }
  }

  for (const deployment of of(items, "Deployment")) {
    const { name, namespace } = deployment.metadata;
    const pod = deployment.spec.template;
    if (!selects(deployment.spec.selector.matchLabels, pod.metadata.labels)) {
      problems.push(`Deployment ${name}: the selector does not match the pod's labels`);
    }
    for (const constraint of pod.spec.topologySpreadConstraints) {
      if (!selects(constraint.labelSelector.matchLabels, pod.metadata.labels)) {
        problems.push(`Deployment ${name}: a spread constraint counts pods other than its own`);
      }
    }
    const account = of(items, "ServiceAccount").find(
      (item) => item.metadata.name === pod.spec.serviceAccountName && inNamespace(item, namespace),
    );
    if (account === undefined) {
      problems.push(
        `Deployment ${name}: service account "${pod.spec.serviceAccountName}" is not defined`,
      );
    }
    for (const container of pod.spec.containers) {
      const ports = new Set(container.ports.map((port) => port.name));
      for (const probe of [container.readinessProbe, container.livenessProbe]) {
        if (!ports.has(probe.httpGet.port)) {
          problems.push(
            `Deployment ${name}: a probe asks port "${probe.httpGet.port}", which the container does not name`,
          );
        }
      }
    }
    const budgets = of(items, "PodDisruptionBudget").filter(
      (item) =>
        inNamespace(item, namespace) &&
        selects(item.spec.selector.matchLabels, pod.metadata.labels),
    );
    if (budgets.length !== 1) {
      problems.push(`Deployment ${name}: ${budgets.length} disruption budgets select its pods`);
    }
  }

  for (const service of of(items, "Service")) {
    const { name, namespace } = service.metadata;
    const backends = of(items, "Deployment").filter(
      (item) =>
        inNamespace(item, namespace) &&
        selects(service.spec.selector, item.spec.template.metadata.labels),
    );
    if (backends.length === 0) {
      problems.push(`Service ${name}: the selector matches no pod`);
    }
    for (const backend of backends) {
      const named = new Set(
        backend.spec.template.spec.containers.flatMap((item) =>
          item.ports.map((port) => port.name),
        ),
      );
      for (const port of service.spec.ports) {
        if (!named.has(port.targetPort)) {
          problems.push(`Service ${name}: no container names the port "${port.targetPort}"`);
        }
      }
    }
  }

  for (const ingress of of(items, "Ingress")) {
    const { name, namespace } = ingress.metadata;
    const ingressClass = of(items, "IngressClass").find(
      (item) => item.metadata.name === ingress.spec.ingressClassName,
    );
    if (ingressClass === undefined) {
      problems.push(`Ingress ${name}: class "${ingress.spec.ingressClassName}" is not defined`);
    }
    for (const path of ingress.spec.rules.flatMap((rule) => rule.http.paths)) {
      const target = path.backend.service;
      const service = of(items, "Service").find(
        (item) => item.metadata.name === target.name && inNamespace(item, namespace),
      );
      if (service?.spec.ports.some((port) => port.port === target.port.number) !== true) {
        problems.push(
          `Ingress ${name}: no service "${target.name}" listens on ${target.port.number}`,
        );
      }
    }
  }

  for (const ingressClass of of(items, "IngressClass")) {
    const wanted = ingressClass.spec.parameters.name;
    if (!of(items, "IngressClassParams").some((item) => item.metadata.name === wanted)) {
      problems.push(
        `IngressClass ${ingressClass.metadata.name}: parameters "${wanted}" are not defined`,
      );
    }
  }

  for (const pool of of(items, "NodePool")) {
    const wanted = pool.spec.template.spec.nodeClassRef.name;
    if (!of(items, "NodeClass").some((item) => item.metadata.name === wanted)) {
      problems.push(`NodePool ${pool.metadata.name}: node class "${wanted}" is not defined`);
    }
  }

  return problems;
}
// #endregion references

// #region schedulable
/**
 * A pod stays Pending for ever when no node pool can give it a node its selector accepts.
 * Checked for the one kind of requirement the manifests write: `key In [values]`.
 */
export function schedulingProblems(items: Manifest[]): string[] {
  const pools = of(items, "NodePool");
  return of(items, "Deployment").flatMap((deployment) => {
    const wanted = Object.entries(deployment.spec.template.spec.nodeSelector);
    const fits = pools.some((pool) =>
      wanted.every(([key, value]) => {
        const requirement = pool.spec.template.spec.requirements.find((item) => item.key === key);
        // A pool that says nothing about a label may or may not provide it. Only a match counts.
        return requirement?.values.includes(value) === true;
      }),
    );
    return fits
      ? []
      : [
          `Deployment ${deployment.metadata.name}: no node pool provides ${JSON.stringify(Object.fromEntries(wanted))}`,
        ];
  });
}
// #endregion schedulable
