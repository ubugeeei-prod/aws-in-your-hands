import { hc } from "hono/client";
import type { z } from "zod";
import type { App } from "./app.ts";
import { type CreateNote, errorSchema, healthSchema, noteListSchema, noteSchema } from "./contract.ts";

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

// hc<App> types the call. It cannot know which server actually answers, so
// every response is checked against the schema before it is returned.
async function parse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const requestId = response.headers.get("x-request-id") ?? undefined;
  const json: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const body = errorSchema.safeParse(json);
    throw body.success
      ? new ApiError(response.status, body.data.error.code, body.data.error.message, body.data.error.requestId)
      : new ApiError(
          response.status,
          "unexpected_response",
          `HTTP ${response.status} without an error body`,
          requestId,
        );
  }
  const body = schema.safeParse(json);
  if (!body.success) {
    throw new ApiError(response.status, "unexpected_response", "The response does not match the contract.", requestId);
  }
  return body.data;
}

export function createNotesClient(baseUrl: string, fetchImpl: typeof fetch = fetch) {
  const api = hc<App>(baseUrl, { fetch: fetchImpl });
  return {
    health: async () => parse(await api.health.$get(), healthSchema),
    list: async () => (await parse(await api.notes.$get(), noteListSchema)).notes,
    create: async (input: CreateNote) => parse(await api.notes.$post({ json: input }), noteSchema),
    get: async (id: string) => parse(await api.notes[":id"].$get({ param: { id } }), noteSchema),
    remove: async (id: string) => {
      const response = await api.notes[":id"].$delete({ param: { id } });
      if (!response.ok) {
        await parse(response, noteSchema);
      }
    },
  };
}

export type NotesClient = ReturnType<typeof createNotesClient>;
// #endregion client
