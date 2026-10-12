// A template as a graph: one node per resource, one edge per reference between two resources.

import type { Template } from "./template.ts";

// #region types
/** The four forms that are followed. `from` names `to`, so `to` has to exist first. */
export type Via = "Ref" | "Fn::GetAtt" | "Fn::Sub" | "DependsOn";

export type Node = { id: string; type: string };
export type Edge = { from: string; to: string; via: Via };

export type Graph = {
  nodes: Node[];
  edges: Edge[];
  /** Resources left out on request, such as the AWS::CDK::Metadata every CDK stack carries. */
  omitted: Node[];
  /** Names that are neither a resource, a parameter, nor an `AWS::` pseudo parameter. */
  unresolved: { from: string; name: string; via: Via }[];
  /** Which resources each output reads. Outputs are not nodes. */
  outputs: { name: string; to: string[] }[];
};
// #endregion types

type Found = { name: string; via: Via };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// #region sub
/** The names inside `${...}` in an Fn::Sub string. `${!Literal}` is text, not a name. */
export function subNames(text: string): string[] {
  const names: string[] = [];
  for (const [, inner = ""] of text.matchAll(/\$\{([^}]*)\}/g)) {
    const name = inner.trim();
    if (name !== "" && !name.startsWith("!")) {
      // `${Bucket.Arn}` reads an attribute of Bucket.
      names.push(name.split(".")[0] ?? name);
    }
  }
  return names;
}
// #endregion sub

// #region walk
/** Every Ref, Fn::GetAtt and Fn::Sub under a value, however deep it sits. */
export function references(value: unknown): Found[] {
  if (Array.isArray(value)) {
    return value.flatMap(references);
  }
  if (!isRecord(value)) {
    return [];
  }
  const keys = Object.keys(value);
  if (keys.length === 1) {
    const [key = ""] = keys;
    const argument = value[key];
    if (key === "Ref" && typeof argument === "string") {
      return [{ name: argument, via: "Ref" }];
    }
    if (key === "Fn::GetAtt") {
      // ["Bucket", "Arn"]. The one-string "Bucket.Arn" is the argument of YAML's !GetAtt, read here too.
      if (typeof argument === "string") {
        return [{ name: argument.split(".")[0] ?? argument, via: "Fn::GetAtt" }];
      }
      if (Array.isArray(argument) && typeof argument[0] === "string") {
        return [{ name: argument[0], via: "Fn::GetAtt" }, ...references(argument.slice(1))];
      }
    }
    if (key === "Fn::Sub") {
      if (typeof argument === "string") {
        return subNames(argument).map((name) => ({ name, via: "Fn::Sub" }));
      }
      if (Array.isArray(argument) && typeof argument[0] === "string") {
        // The second element defines local names. They shadow resources of the same name.
        const local = isRecord(argument[1]) ? argument[1] : {};
        return [
          ...subNames(argument[0])
            .filter((name) => !Object.hasOwn(local, name))
            .map((name): Found => ({ name, via: "Fn::Sub" })),
          ...references(Object.values(local)),
        ];
      }
    }
  }
  return Object.values(value).flatMap(references);
}
// #endregion walk

export type GraphOptions = { omitTypes?: readonly string[] };

// #region graph
export function templateGraph(template: Template, options: GraphOptions = {}): Graph {
  const omitTypes = new Set(options.omitTypes ?? []);
  const entries = Object.entries(template.Resources);
  const nodes = entries
    .filter(([, resource]) => !omitTypes.has(resource.Type))
    .map(([id, resource]) => ({ id, type: resource.Type }));
  const omitted = entries
    .filter(([, resource]) => omitTypes.has(resource.Type))
    .map(([id, resource]) => ({ id, type: resource.Type }));

  const known = new Set(nodes.map((node) => node.id));
  const ignorable = new Set([
    ...omitted.map((node) => node.id),
    ...Object.keys(template.Parameters ?? {}),
  ]);

  const edges: Edge[] = [];
  const unresolved: Graph["unresolved"] = [];
  const seen = new Set<string>();
  const add = (from: string, { name, via }: Found): void => {
    const key = `${from} ${via} ${name}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    if (known.has(name)) {
      edges.push({ from, to: name, via });
    } else if (!ignorable.has(name) && !name.startsWith("AWS::")) {
      unresolved.push({ from, name, via });
    }
  };

  for (const [id, resource] of entries) {
    if (!known.has(id)) {
      continue;
    }
    const { Type: _type, DependsOn: dependsOn, ...rest } = resource;
    for (const found of references(rest)) {
      add(id, found);
    }
    for (const name of dependsOn === undefined ? [] : [dependsOn].flat()) {
      add(id, { name, via: "DependsOn" });
    }
  }

  const outputs = Object.entries(template.Outputs ?? {}).map(([name, output]) => ({
    name,
    to: [...new Set(references(output).map((found) => found.name))].filter((id) => known.has(id)),
  }));

  return { nodes, edges, omitted, unresolved, outputs };
}
// #endregion graph
