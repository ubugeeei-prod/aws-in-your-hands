// A client for the calls in requests.ts. HTTP over a Unix domain socket, as the specification says.

import { request as httpRequest } from "node:http";

import * as v from "valibot";

import { type ApiRequest, describeInstance, getVersion, instanceStart } from "./requests.ts";

// #region schemas
// Error, InstanceInfo and FirecrackerVersion of the specification. A test compares these with it.
const errorSchema = v.object({ fault_message: v.optional(v.string()) });

export const INSTANCE_STATES = ["Not started", "Running", "Paused"] as const;
export const instanceInfoSchema = v.object({
  app_name: v.string(),
  id: v.string(),
  state: v.picklist(INSTANCE_STATES),
  vmm_version: v.string(),
});
export type InstanceInfo = v.InferOutput<typeof instanceInfoSchema>;

export const versionSchema = v.object({ firecracker_version: v.string() });
// #endregion schemas

export type Transport = (call: {
  method: string;
  path: string;
  body: string | undefined;
}) => Promise<{ status: number; body: string }>;

/** Firecracker answered, and the answer was not the success the specification names. */
export class FirecrackerApiError extends Error {
  readonly operationId: string;
  readonly status: number;
  readonly faultMessage: string | undefined;

  constructor(request: ApiRequest, status: number, faultMessage: string | undefined) {
    super(
      `${request.operationId} (${request.method} ${request.path}) answered ${status}${faultMessage === undefined ? "" : `: ${faultMessage}`}`,
    );
    this.name = "FirecrackerApiError";
    this.operationId = request.operationId;
    this.status = status;
    this.faultMessage = faultMessage;
  }
}

/** No answer arrived. Whether Firecracker acted on the request is not known. */
export class NoAnswerError extends Error {
  readonly operationId: string;

  constructor(request: ApiRequest, cause: unknown) {
    super(`${request.operationId} (${request.method} ${request.path}) got no answer`, { cause });
    this.name = "NoAnswerError";
    this.operationId = request.operationId;
  }
}

// #region transport
export function unixSocketTransport(socketPath: string, timeoutMs = 5000): Transport {
  return ({ method, path, body }) =>
    new Promise((resolve, reject) => {
      const outgoing = httpRequest(
        {
          socketPath,
          method,
          path,
          // One connection per call: the API is local and the calls are few.
          agent: false,
          headers: {
            Accept: "application/json",
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }),
          },
          timeout: timeoutMs,
        },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
          incoming.on("error", reject);
          incoming.on("end", () =>
            resolve({
              status: incoming.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf8"),
            }),
          );
        },
      );
      outgoing.on("timeout", () => outgoing.destroy(new Error(`no answer in ${timeoutMs} ms`)));
      outgoing.on("error", reject);
      outgoing.end(body);
    });
}
// #endregion transport

function faultOf(body: string): string | undefined {
  try {
    const parsed = v.safeParse(errorSchema, JSON.parse(body));
    return parsed.success ? parsed.output.fault_message : undefined;
  } catch {
    return undefined;
  }
}

export type FirecrackerClient = ReturnType<typeof createClient>;

export function createClient(transport: Transport) {
  // #region send
  async function send(request: ApiRequest): Promise<string> {
    let answer: Awaited<ReturnType<Transport>>;
    try {
      answer = await transport({
        method: request.method,
        path: request.path,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
      });
    } catch (error) {
      throw new NoAnswerError(request, error);
    }
    if (answer.status !== request.expect) {
      throw new FirecrackerApiError(request, answer.status, faultOf(answer.body));
    }
    return answer.body;
  }

  async function read<T>(request: ApiRequest, schema: v.GenericSchema<unknown, T>): Promise<T> {
    const body = await send(request);
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch (error) {
      throw new Error(`${request.operationId} did not answer with JSON`, { cause: error });
    }
    return v.parse(schema, json);
  }
  // #endregion send

  const instance = () => read(describeInstance, instanceInfoSchema);

  // #region start-once
  /**
   * InstanceStart succeeds once. When its answer is lost, sending it again would be refused
   * although the guest runs, so the state is read instead.
   */
  async function startOnce(): Promise<"started" | "was-running"> {
    try {
      await send(instanceStart);
      return "started";
    } catch (error) {
      if (!(error instanceof NoAnswerError)) {
        throw error;
      }
      const { state } = await instance();
      if (state === "Running") {
        return "was-running";
      }
      throw error;
    }
  }
  // #endregion start-once

  return {
    send,
    instance,
    startOnce,
    version: async () => (await read(getVersion, versionSchema)).firecracker_version,
    /** In order, stopping at the first refusal: nothing after it is sent. */
    async run(sequence: readonly ApiRequest[]): Promise<void> {
      for (const request of sequence) {
        await send(request);
      }
    },
  };
}
