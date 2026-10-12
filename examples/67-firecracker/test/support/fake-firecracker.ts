// A stand-in for the Firecracker API server, listening on a real Unix domain socket.
// It is this book's model, not Firecracker. It knows only these rules, each taken from a
// sentence of the specification or of the project's documents:
//   - a body must have the fields its definition requires (the specification's definitions)
//   - machine-config, boot-source, drives and network-interfaces are "Pre-boot only"
//   - InstanceStart "can only be successfully called once", and needs a kernel and a root drive
//   - PATCH /vm works only after boot; a snapshot needs the microVM "in the Paused state"
// It boots nothing, and every other behaviour of the real server is absent.

import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bodyDefinition, conforms, findOperation, type SpecSubset } from "../../src/spec.ts";

export type Recorded = { method: string; path: string; body: unknown };

export async function startFakeFirecracker(spec: SpecSubset) {
  const directory = mkdtempSync(join(tmpdir(), "fc-"));
  const socketPath = join(directory, "api.sock");

  let state: "Not started" | "Running" | "Paused" = "Not started";
  const configured = new Map<string, unknown>();
  const requests: Recorded[] = [];
  const snapshots: unknown[] = [];
  // operationId -> what to do instead of answering, once.
  const dropAnswer = new Set<string>();
  const refuse = new Map<string, string>();

  const fault = (response: ServerResponse, message: string) => {
    response.writeHead(400, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ fault_message: message }));
  };
  const json = (response: ServerResponse, value: unknown) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(value));
  };

  const server = createServer((incoming, response) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", () => {
      const method = incoming.method ?? "GET";
      const path = incoming.url ?? "/";
      const text = Buffer.concat(chunks).toString("utf8");
      let body: unknown;
      try {
        body = text === "" ? undefined : JSON.parse(text);
      } catch {
        return fault(response, "the body is not JSON");
      }
      requests.push({ method, path, body });

      const found = findOperation(spec, method, path);
      if (found === undefined) {
        return fault(response, `no ${method} ${path} in the part of the API this fake knows`);
      }
      const { operation, template } = found;
      const { operationId } = operation;

      const forced = refuse.get(operationId);
      if (forced !== undefined) {
        refuse.delete(operationId);
        return fault(response, forced);
      }

      const definition = bodyDefinition(operation);
      if (definition !== undefined) {
        const problems = conforms(spec, { $ref: `#/definitions/${definition}` }, body);
        if (problems.length > 0) {
          return fault(response, problems.join("; "));
        }
      }

      const fields = (body ?? {}) as Record<string, unknown>;
      switch (operationId) {
        case "describeInstance":
          return json(response, {
            app_name: "Firecracker",
            id: "fake",
            state,
            vmm_version: spec.info.version,
          });
        case "getFirecrackerVersion":
          return json(response, { firecracker_version: spec.info.version });
        case "putMachineConfiguration":
        case "putGuestBootSource":
        case "putGuestDriveByID":
        case "putGuestNetworkInterfaceByID":
          if (state !== "Not started") {
            return fault(response, `${operationId} is pre-boot only and the microVM is ${state}`);
          }
          // "Creates or updates": the same path replaces what was there.
          configured.set(template.includes("{") ? path : template, body);
          break;
        case "createSyncAction": {
          if (fields["action_type"] !== "InstanceStart") {
            break;
          }
          if (state !== "Not started") {
            return fault(response, "InstanceStart can only be called once");
          }
          const rootDrive = [...configured.entries()].some(
            ([key, value]) =>
              key.startsWith("/drives/") &&
              (value as Record<string, unknown>)["is_root_device"] === true,
          );
          if (!configured.has("/boot-source") || !rootDrive) {
            return fault(response, "InstanceStart needs a boot source and a root drive");
          }
          state = "Running";
          break;
        }
        case "patchVm":
          if (state === "Not started") {
            return fault(response, "the microVM is not booted");
          }
          state = fields["state"] === "Paused" ? "Paused" : "Running";
          break;
        case "createSnapshot":
          if (state !== "Paused") {
            return fault(response, `a snapshot needs a Paused microVM and it is ${state}`);
          }
          snapshots.push(body);
          break;
        default:
          return fault(response, `${operationId} is not modelled`);
      }

      if (dropAnswer.delete(operationId)) {
        // Applied, then the connection dies before a byte of the answer leaves.
        return incoming.socket.destroy();
      }
      response.writeHead(204);
      response.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(socketPath, resolve));

  return {
    socketPath,
    requests,
    snapshots,
    configured,
    state: () => state,
    /** The next call of this operation takes effect and gets no answer. */
    dropAnswerOnce: (operationId: string) => dropAnswer.add(operationId),
    /** The next call of this operation is refused with this message and changes nothing. */
    refuseOnce: (operationId: string, message: string) => refuse.set(operationId, message),
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
