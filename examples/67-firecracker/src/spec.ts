// The pinned Firecracker API specification, and the part of it this example uses.

import * as v from "valibot";

// #region pinned
/** One release of Firecracker. The checksum is of the specification file at that tag. */
export const SPEC = {
  version: "1.17.0",
  url: "https://raw.githubusercontent.com/firecracker-microvm/firecracker/v1.17.0/src/firecracker/swagger/firecracker.yaml",
  sha256: "473a0a392927b407834b341bf5fbc7925524fedaf9d925e1bbbafb6a1f48c671",
} as const;

/** Every call the walkthrough makes. Nothing else of the API is typed here. */
export const USED_OPERATIONS = [
  { method: "get", path: "/" },
  { method: "get", path: "/version" },
  { method: "put", path: "/machine-config" },
  { method: "put", path: "/boot-source" },
  { method: "put", path: "/drives/{drive_id}" },
  { method: "put", path: "/network-interfaces/{iface_id}" },
  { method: "put", path: "/actions" },
  { method: "patch", path: "/vm" },
  { method: "put", path: "/snapshot/create" },
] as const;
// #endregion pinned

export type Method = (typeof USED_OPERATIONS)[number]["method"];

/** The Swagger 2.0 schema keywords the used definitions contain. `conforms` reads the first seven. */
export const KNOWN_KEYWORDS = [
  "$ref",
  "type",
  "required",
  "properties",
  "enum",
  "minimum",
  "maximum",
  "description",
  "default",
  "format",
  "readOnly",
] as const;

export type SchemaNode = {
  $ref?: string;
  type?: string;
  required?: string[];
  properties?: Record<string, SchemaNode>;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  [keyword: string]: unknown;
};

const schemaNode: v.GenericSchema<SchemaNode> = v.looseObject({
  $ref: v.optional(v.string()),
  type: v.optional(v.string()),
  required: v.optional(v.array(v.string())),
  properties: v.optional(
    v.record(
      v.string(),
      v.lazy(() => schemaNode),
    ),
  ),
  enum: v.optional(v.array(v.string())),
  minimum: v.optional(v.number()),
  maximum: v.optional(v.number()),
});

const operationSchema = v.looseObject({
  operationId: v.string(),
  summary: v.optional(v.string()),
  parameters: v.optional(
    v.array(
      v.looseObject({
        name: v.string(),
        in: v.picklist(["body", "path"]),
        required: v.optional(v.boolean()),
        schema: v.optional(schemaNode),
      }),
    ),
  ),
  responses: v.record(v.string(), v.looseObject({ schema: v.optional(schemaNode) })),
});
export type Operation = v.InferOutput<typeof operationSchema>;

export const specSubsetSchema = v.object({
  source: v.object({
    url: v.string(),
    sha256: v.string(),
    license: v.object({ name: v.string(), url: v.string() }),
  }),
  info: v.object({ title: v.string(), version: v.string() }),
  paths: v.record(v.string(), v.record(v.string(), operationSchema)),
  definitions: v.record(v.string(), schemaNode),
});
export type SpecSubset = v.InferOutput<typeof specSubsetSchema>;

const REF = "#/definitions/";

function refsIn(node: unknown, found: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      refsIn(item, found);
    }
  } else if (typeof node === "object" && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string" && value.startsWith(REF)) {
        found.add(value.slice(REF.length));
      } else {
        refsIn(value, found);
      }
    }
  }
}

const fullSpecSchema = v.looseObject({
  info: v.looseObject({
    title: v.string(),
    version: v.string(),
    license: v.object({ name: v.string(), url: v.string() }),
  }),
  paths: v.record(v.string(), v.record(v.string(), v.unknown())),
  definitions: v.record(v.string(), v.unknown()),
});

// #region extract
/** The used operations and every definition they reach, cut out of the whole specification. */
export function extractSubset(document: unknown): SpecSubset {
  const full = v.parse(fullSpecSchema, document);
  const paths: Record<string, Record<string, unknown>> = {};
  for (const { method, path } of USED_OPERATIONS) {
    const operation = full.paths[path]?.[method];
    if (operation === undefined) {
      throw new Error(`the specification has no ${method.toUpperCase()} ${path}`);
    }
    paths[path] = { ...paths[path], [method]: operation };
  }

  const definitions: Record<string, unknown> = {};
  const pending = new Set<string>();
  refsIn(paths, pending);
  for (const name of pending) {
    const definition = full.definitions[name];
    if (definition === undefined) {
      throw new Error(`the specification refers to ${name} and does not define it`);
    }
    definitions[name] = definition;
    // A Set visits what is added during the loop, so this follows references to the end.
    refsIn(definition, pending);
  }

  return v.parse(specSubsetSchema, {
    source: { url: SPEC.url, sha256: SPEC.sha256, license: full.info.license },
    info: { title: full.info.title, version: full.info.version },
    paths,
    definitions: Object.fromEntries(
      Object.entries(definitions).toSorted(([a], [b]) => a.localeCompare(b)),
    ),
  });
}
// #endregion extract

/** `/drives/rootfs` is an instance of `/drives/{drive_id}`. */
export function matchesTemplate(template: string, path: string): boolean {
  const pattern = template
    .split("/")
    .map((part) =>
      /^\{.+\}$/.test(part) ? "[^/]+" : part.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
  return new RegExp(`^${pattern.join("/")}$`).test(path);
}

export function findOperation(
  spec: SpecSubset,
  method: string,
  path: string,
): { template: string; operation: Operation } | undefined {
  // An exact path first: "/" must not be shadowed by a template.
  const templates = Object.keys(spec.paths).toSorted(
    (a, b) => Number(a.includes("{")) - Number(b.includes("{")),
  );
  for (const template of templates) {
    const operation = spec.paths[template]?.[method.toLowerCase()];
    if (operation !== undefined && matchesTemplate(template, path)) {
      return { template, operation };
    }
  }
  return undefined;
}

/** The definition a request body of this operation must have, when it takes one. */
export function bodyDefinition(operation: Operation): string | undefined {
  const ref = operation.parameters?.find((parameter) => parameter.in === "body")?.schema?.$ref;
  return ref?.startsWith(REF) ? ref.slice(REF.length) : undefined;
}

// #region conforms
/**
 * Checks a value against a definition, reading `$ref`, `type`, `required`, `properties`,
 * `enum`, `minimum` and `maximum`. Stricter than Swagger in one way: a property the
 * definition does not name is reported, so a misspelt field cannot pass.
 */
export function conforms(
  spec: SpecSubset,
  node: SchemaNode,
  value: unknown,
  at = "body",
): string[] {
  if (node.$ref !== undefined) {
    const target = spec.definitions[node.$ref.slice(REF.length)];
    return target === undefined
      ? [`${at}: ${node.$ref} is not in the subset`]
      : conforms(spec, target, value, at);
  }
  if (node.enum !== undefined && !(typeof value === "string" && node.enum.includes(value))) {
    return [`${at}: ${JSON.stringify(value)} is not one of ${node.enum.join(", ")}`];
  }
  switch (node.type) {
    case "string":
      return typeof value === "string" ? [] : [`${at}: expected a string`];
    case "boolean":
      return typeof value === "boolean" ? [] : [`${at}: expected a boolean`];
    case "integer": {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return [`${at}: expected an integer`];
      }
      const low = node.minimum !== undefined && value < node.minimum;
      const high = node.maximum !== undefined && value > node.maximum;
      return low || high ? [`${at}: ${value} is outside ${node.minimum}..${node.maximum}`] : [];
    }
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return [`${at}: expected an object`];
      }
      const properties = node.properties ?? {};
      const problems = (node.required ?? [])
        .filter((name) => !(name in value))
        .map((name) => `${at}.${name}: required`);
      for (const [name, child] of Object.entries(value)) {
        const property = properties[name];
        problems.push(
          ...(property === undefined
            ? [`${at}.${name}: not in the definition`]
            : conforms(spec, property, child, `${at}.${name}`)),
        );
      }
      return problems;
    }
    default:
      return [`${at}: type ${String(node.type)} is not one this check reads`];
  }
}
// #endregion conforms
