import * as v from "valibot";

import { WORKERD } from "./release.ts";

// What this chapter writes into a workerd configuration, and nothing more. workerd.capnp
// has many more fields; a definition that needs one of them has to add it here first.

const name = v.pipe(
  v.string(),
  v.regex(/^[a-z][a-z0-9-]{0,31}$/, "lowercase letters, digits, '-'"),
);

// The text ends up between quotes in the configuration file. Printable ASCII keeps the escaping to two characters.
const printable = v.pipe(v.string(), v.regex(/^[\x20-\x7e]*$/, "printable ASCII only"));

const bindingName = v.pipe(v.string(), v.regex(/^[A-Z][A-Z0-9_]{0,63}$/, "like ALLOWED_ORIGIN"));

// #region binding
export const bindingSchema = v.variant("from", [
  /** The value is written into the configuration. */
  v.object({ from: v.literal("text"), name: bindingName, value: printable }),
  /** The value is the process's environment variable when workerd starts; absent when it is not set. */
  v.object({ from: v.literal("environment"), name: bindingName, variable: bindingName }),
]);
// #endregion binding

// v.isoDate() checks the shape only: it accepts 2026-02-31.
const calendarDate = v.pipe(
  v.string(),
  v.isoDate(),
  v.check(
    (date) => new Date(`${date}T00:00:00Z`).toISOString().startsWith(date),
    "not a date on the calendar",
  ),
);

// #region worker
export const workerSchema = v.object({
  name,
  /** The bundle, next to the configuration file. A bare file name: nothing outside that directory can be embedded. */
  module: v.pipe(v.string(), v.regex(/^[a-z][a-z0-9-]*\.mjs$/, "a file name like notes.mjs")),
  compatibilityDate: v.pipe(
    calendarDate,
    // workerd refuses to start with a date newer than itself.
    v.check(
      (date) => date <= WORKERD.compatibilityDate,
      `workerd ${WORKERD.version} knows no date after ${WORKERD.compatibilityDate}`,
    ),
  ),
  bindings: v.optional(v.array(bindingSchema), []),
});
// #endregion worker

// #region socket
export const socketSchema = v.object({
  name,
  /** "*" is every interface. Only what the chapter uses: an IPv4 address or "*", and a port. */
  address: v.pipe(
    v.string(),
    v.regex(/^(\*|\d{1,3}(\.\d{1,3}){3}):\d{1,5}$/, "like *:8080 or 127.0.0.1:8787"),
    v.check((address) => Number(address.split(":")[1]) <= 65_535, "the port is out of range"),
  ),
  /** The worker that answers on this socket. */
  service: name,
  /** Set behind a load balancer that ends TLS, so that request.url says https when the caller used it. */
  forwardedProtoHeader: v.optional(
    v.pipe(v.string(), v.regex(/^[a-z][a-z0-9-]*$/, "a lowercase header name")),
  ),
});
// #endregion socket

const duplicates = (values: string[]): string[] => [
  ...new Set(values.filter((value, index) => values.indexOf(value) !== index)),
];

// #region deployment
/** One workerd process: the workers it loads, and the sockets that reach them. */
export const deploymentSchema = v.pipe(
  v.object({
    workers: v.pipe(v.array(workerSchema), v.minLength(1)),
    sockets: v.pipe(v.array(socketSchema), v.minLength(1)),
  }),
  v.check(
    ({ workers }) => duplicates(workers.map((worker) => worker.name)).length === 0,
    "two workers share a name",
  ),
  v.check(
    ({ workers }) =>
      workers.every(
        (worker) => duplicates(worker.bindings.map((binding) => binding.name)).length === 0,
      ),
    "a worker has two bindings with one name",
  ),
  v.check(
    ({ sockets }) =>
      duplicates(sockets.map((socket) => socket.name)).length === 0 &&
      duplicates(sockets.map((socket) => socket.address)).length === 0,
    "two sockets share a name or an address",
  ),
  // A worker no socket points at is allowed: it is loaded and unreachable. The reverse is a mistake.
  v.check(
    ({ workers, sockets }) =>
      sockets.every((socket) => workers.some((worker) => worker.name === socket.service)),
    "a socket points at a worker that is not defined",
  ),
);

export type Deployment = v.InferOutput<typeof deploymentSchema>;
export type DeploymentInput = v.InferInput<typeof deploymentSchema>;

/** Throws with every problem named. Everything that becomes a configuration file passes through here. */
export function parseDeployment(input: unknown): Deployment {
  const result = v.safeParse(deploymentSchema, input);
  if (!result.success) {
    const problems = result.issues.map(
      (issue) => `  ${v.getDotPath(issue) ?? "(deployment)"}: ${issue.message}`,
    );
    throw new Error(`Invalid workerd deployment:\n${problems.join("\n")}`);
  }
  return result.output;
}
// #endregion deployment
