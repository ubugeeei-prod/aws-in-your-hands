import { ApiError } from "@aih/example-06-auth/api/src/client.ts";
import { hc } from "hono/client";
import type { z } from "zod";
import type { App } from "./app.ts";
import {
  attachmentListSchema,
  attachmentSchema,
  errorSchema,
  type UploadPermit,
  uploadPermitSchema,
  type UploadRequest,
} from "./contract.ts";

async function parse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const requestId = response.headers.get("x-request-id") ?? undefined;
  const json: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const body = errorSchema.safeParse(json);
    throw body.success
      ? new ApiError(response.status, body.data.error.code, body.data.error.message, body.data.error.requestId)
      : new ApiError(
          response.status,
          response.status === 401 || response.status === 403 ? "unauthenticated" : "unexpected_response",
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

export class UploadError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`The storage service refused the upload with HTTP ${status}.`);
    this.name = "UploadError";
    this.status = status;
  }
}

// #region send
/** The one request that does not go to the API, and carries no access token. */
export async function sendUpload(permit: UploadPermit, file: Blob, fetchImpl: typeof fetch = fetch): Promise<void> {
  const form = new FormData();
  for (const [name, value] of Object.entries(permit.upload.fields)) {
    form.append(name, value);
  }
  // S3 ignores every field after the file, so the file goes last.
  form.append("file", file);
  // No Content-Type header here: the browser writes the multipart boundary itself.
  const response = await fetchImpl(permit.upload.url, { method: "POST", body: form });
  if (!response.ok) {
    throw new UploadError(response.status);
  }
}
// #endregion send

// #region client
export function createAttachmentsClient(
  baseUrl: string,
  getToken: () => string | undefined,
  fetchImpl: typeof fetch = fetch,
) {
  const withToken: typeof fetch = (input, init) => {
    const token = getToken();
    const headers = new Headers(init?.headers);
    if (token !== undefined) {
      headers.set("authorization", `Bearer ${token}`);
    }
    return fetchImpl(input, { ...init, headers });
  };
  const api = hc<App>(baseUrl, { fetch: withToken });
  const one = api.notes[":id"].attachments[":attachmentId"];

  const client = {
    requestUpload: async (noteId: string, input: UploadRequest) =>
      parse(await api.notes[":id"].attachments.$post({ param: { id: noteId }, json: input }), uploadPermitSchema),
    finish: async (noteId: string, attachmentId: string) =>
      parse(await one.$put({ param: { id: noteId, attachmentId } }), attachmentSchema),
    list: async (noteId: string) =>
      (await parse(await api.notes[":id"].attachments.$get({ param: { id: noteId } }), attachmentListSchema))
        .attachments,
    remove: async (noteId: string, attachmentId: string) => {
      const response = await one.$delete({ param: { id: noteId, attachmentId } });
      if (!response.ok) {
        await parse(response, attachmentSchema);
      }
    },
    /** Permit, upload, finish. The three steps fail separately; see the chapter. */
    async attach(noteId: string, file: Blob, contentType: UploadRequest["contentType"]) {
      const permit = await client.requestUpload(noteId, { contentType });
      await sendUpload(permit, file, fetchImpl);
      return client.finish(noteId, permit.attachmentId);
    },
  };
  return client;
}

export type AttachmentsClient = ReturnType<typeof createAttachmentsClient>;
// #endregion client
