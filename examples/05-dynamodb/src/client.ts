import { hc } from "hono/client";
import type { z } from "zod";

import type { App } from "./app.ts";
import {
  type CreateNote,
  errorSchema,
  healthSchema,
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

async function parse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const requestId = response.headers.get("x-request-id") ?? undefined;
  const json: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const body = errorSchema.safeParse(json);
    throw body.success
      ? new ApiError(
          response.status,
          body.data.error.code,
          body.data.error.message,
          body.data.error.requestId,
          body.data.error.current,
        )
      : new ApiError(
          response.status,
          "unexpected_response",
          `HTTP ${response.status} without an error body`,
          requestId,
        );
  }
  const body = schema.safeParse(json);
  if (!body.success) {
    throw new ApiError(
      response.status,
      "unexpected_response",
      "The response does not match the contract.",
      requestId,
    );
  }
  return body.data;
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
  const api = hc<App>(baseUrl, { fetch: fetchImpl });
  return {
    health: async () => parse(await api.health.$get(), healthSchema),
    list: async (options: { limit?: number; cursor?: string } = {}) =>
      parse(
        await api.notes.$get({
          query: {
            limit: String(options.limit ?? 20),
            ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
          },
        }),
        noteListSchema,
      ),
    create: async (input: CreateNote) => parse(await api.notes.$post({ json: input }), noteSchema),
    get: async (id: string) => parse(await api.notes[":id"].$get({ param: { id } }), noteSchema),
    // #region update
    async update(id: string, input: UpdateNote): Promise<UpdateOutcome> {
      try {
        return {
          status: "updated",
          note: await parse(
            await api.notes[":id"].$put({ param: { id }, json: input }),
            noteSchema,
          ),
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
      const response = await api.notes[":id"].$delete({ param: { id } });
      if (!response.ok) {
        await parse(response, noteSchema);
      }
    },
  };
}

export type NotesClient = ReturnType<typeof createNotesClient>;
