import * as v from "valibot";

import {
  type CreateNote,
  errorSchema,
  healthSchema,
  MAX_PAGE_SIZE,
  type Note,
  noteListSchema,
  noteSchema,
  type UpdateNote,
} from "./contract.ts";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;
  readonly current: Note | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    requestId: string | undefined,
    current?: Note,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.current = current;
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
          body.output.error.current,
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

// #region outcome
export type UpdateOutcome =
  | { status: "updated"; note: Note }
  // Someone else's change is stored. Nothing of the caller's was written.
  | { status: "conflict"; current: Note };

// After a lost response, the retry conflicts with the caller's own first
// write. One version ahead with exactly what was sent: that write landed.
export function isOwnWrite(sent: UpdateNote, current: Note): boolean {
  // The server trims the title before storing it.
  return (
    current.version === sent.expectedVersion + 1 &&
    current.title === sent.title.trim() &&
    current.body === sent.body
  );
}
// #endregion outcome

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
    list: async (options: { limit?: number; cursor?: string } = {}) => {
      const query = new URLSearchParams({
        limit: String(options.limit ?? MAX_PAGE_SIZE),
        ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      });
      return parse(await call("GET", `/notes?${query}`), noteListSchema);
    },
    create: async (input: CreateNote) => parse(await call("POST", "/notes", input), noteSchema),
    get: async (id: string) => parse(await call("GET", note(id)), noteSchema),
    // #region update
    async update(id: string, input: UpdateNote): Promise<UpdateOutcome> {
      try {
        return {
          status: "updated",
          note: await parse(await call("PUT", note(id), input), noteSchema),
        };
      } catch (error) {
        if (error instanceof ApiError && error.code === "conflict" && error.current !== undefined) {
          return isOwnWrite(input, error.current)
            ? { status: "updated", note: error.current }
            : { status: "conflict", current: error.current };
        }
        throw error;
      }
    },
    // #endregion update
    remove: async (id: string) => {
      const response = await call("DELETE", note(id));
      if (!response.ok) {
        await parse(response, noteSchema);
      }
    },
  };
}

export type NotesClient = ReturnType<typeof createNotesClient>;
