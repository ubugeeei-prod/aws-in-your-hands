import * as v from "valibot";

import {
  type CreateNote,
  errorSchema,
  healthSchema,
  noteListSchema,
  noteSchema,
} from "./contract.ts";

// #region client
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;

  constructor(status: number, code: string, message: string, requestId: string | undefined) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

// A type cannot know which server actually answers, so every response is
// checked against the schema before it is returned.
async function parse<Schema extends v.GenericSchema>(
  response: Response,
  schema: Schema,
): Promise<v.InferOutput<Schema>> {
  const requestId = response.headers.get("x-request-id") ?? undefined;
  const json: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const body = v.safeParse(errorSchema, json);
    throw body.success
      ? new ApiError(
          response.status,
          body.output.error.code,
          body.output.error.message,
          body.output.error.requestId,
        )
      : new ApiError(
          response.status,
          "unexpected_response",
          `HTTP ${response.status} without an error body`,
          requestId,
        );
  }
  const body = v.safeParse(schema, json);
  if (!body.success) {
    throw new ApiError(
      response.status,
      "unexpected_response",
      "The response does not match the contract.",
      requestId,
    );
  }
  return body.output;
}

export function createNotesClient(baseUrl: string, fetchImpl: typeof fetch = fetch) {
  const call = (method: string, path: string, json?: unknown): Promise<Response> =>
    fetchImpl(`${baseUrl.replace(/\/$/, "")}${path}`, {
      method,
      ...(json === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(json) }),
    });
  const note = (id: string): string => `/notes/${encodeURIComponent(id)}`;
  return {
    health: async () => parse(await call("GET", "/health"), healthSchema),
    list: async () => (await parse(await call("GET", "/notes"), noteListSchema)).notes,
    create: async (input: CreateNote) => parse(await call("POST", "/notes", input), noteSchema),
    get: async (id: string) => parse(await call("GET", note(id)), noteSchema),
    remove: async (id: string) => {
      const response = await call("DELETE", note(id));
      if (!response.ok) {
        await parse(response, noteSchema);
      }
    },
  };
}

export type NotesClient = ReturnType<typeof createNotesClient>;
// #endregion client
