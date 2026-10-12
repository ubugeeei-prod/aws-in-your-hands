import * as v from "valibot";

import { ApiError } from "@aih/example-06-auth/api/src/client.ts";

import {
  attachmentListSchema,
  attachmentSchema,
  errorSchema,
  type UploadPermit,
  uploadPermitSchema,
  type UploadRequest,
} from "./contract.ts";

// As in chapter 06, with this chapter's error codes.
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
          response.status === 401 || response.status === 403
            ? "unauthenticated"
            : "unexpected_response",
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
export async function sendUpload(
  permit: UploadPermit,
  file: Blob,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
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
  const call = (method: string, path: string, json?: unknown): Promise<Response> => {
    const token = getToken();
    const headers = new Headers();
    if (token !== undefined) {
      headers.set("authorization", `Bearer ${token}`);
    }
    if (json !== undefined) {
      headers.set("content-type", "application/json");
    }
    return fetchImpl(`${baseUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers,
      ...(json === undefined ? {} : { body: JSON.stringify(json) }),
    });
  };
  const all = (noteId: string): string => `/notes/${encodeURIComponent(noteId)}/attachments`;
  const one = (noteId: string, attachmentId: string): string =>
    `${all(noteId)}/${encodeURIComponent(attachmentId)}`;

  const client = {
    requestUpload: async (noteId: string, input: UploadRequest) =>
      parse(await call("POST", all(noteId), input), uploadPermitSchema),
    finish: async (noteId: string, attachmentId: string) =>
      parse(await call("PUT", one(noteId, attachmentId)), attachmentSchema),
    list: async (noteId: string) =>
      (await parse(await call("GET", all(noteId)), attachmentListSchema)).attachments,
    remove: async (noteId: string, attachmentId: string) => {
      const response = await call("DELETE", one(noteId, attachmentId));
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
