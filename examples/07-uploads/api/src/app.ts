import * as v from "valibot";

import { readJson } from "@aih/example-04-http-api/src/http/body.ts";
import { type Route, route } from "@aih/example-04-http-api/src/http/router.ts";
import {
  type App,
  type AppDeps as NotesAppDeps,
  createApp as createNotesApp,
  type SignedIn,
} from "@aih/example-06-auth/api/src/app.ts";

import { type AttachmentService, withAttachmentCleanup } from "./attachments.ts";
import {
  type ErrorBody,
  MAX_ATTACHMENTS_PER_NOTE,
  MAX_UPLOAD_PERMITS_PER_OWNER_PER_DAY,
  uploadRequestSchema,
} from "./contract.ts";

export type AppDeps = NotesAppDeps & { attachments: AttachmentService };
export type { App };

const failure = (
  status: number,
  code: ErrorBody["error"]["code"],
  message: string,
  { requestId }: SignedIn,
  issues?: { path: string; message: string }[],
) =>
  Response.json(
    {
      error: { code, message, requestId, ...(issues === undefined ? {} : { issues }) },
    } satisfies ErrorBody,
    { status },
  );

// The image itself never passes through here; only this small JSON does.
const MAX_BODY_BYTES = 1024;
const noNote = "No such note.";

/** `more` is for the chapters after this one, as in chapter 06. */
export function createApp(deps: AppDeps, more: Route<SignedIn>[] = []): App {
  // #region routes
  // As in chapter 06, the owner is the token's `sub` and nothing else.
  const attachments: Route<SignedIn>[] = [
    route("POST", "/notes/:id/attachments", async (request, context, { id = "" }) => {
      const body = await readJson(request, MAX_BODY_BYTES);
      if (!body.ok) {
        return body.reason === "too_large"
          ? failure(413, "payload_too_large", "The request body exceeds 1 KiB.", context)
          : failure(400, "invalid_request", "The request body is not valid JSON.", context);
      }
      const input = v.safeParse(uploadRequestSchema, body.value);
      if (!input.success) {
        return failure(
          400,
          "invalid_request",
          "The upload request is not valid.",
          context,
          input.issues.map((issue) => ({
            path: v.getDotPath(issue) ?? "",
            message: issue.message,
          })),
        );
      }
      const result = await deps.attachments.requestUpload(context.identity.sub, id, input.output);
      switch (result.status) {
        case "permitted":
          return Response.json(result.permit, { status: 201 });
        case "note_not_found":
          return failure(404, "not_found", noNote, context);
        case "limit":
          return failure(
            409,
            "attachment_limit",
            `A note holds at most ${MAX_ATTACHMENTS_PER_NOTE} images.`,
            context,
          );
        case "quota":
          // 429: nothing is wrong with the request. It is one too many for today.
          return failure(
            429,
            "upload_quota_exceeded",
            `An account may start at most ${MAX_UPLOAD_PERMITS_PER_OWNER_PER_DAY} uploads a day.`,
            context,
          );
      }
    }),
    route("GET", "/notes/:id/attachments", async (_request, context, { id = "" }) => {
      const list = await deps.attachments.list(context.identity.sub, id);
      return list === undefined
        ? failure(404, "not_found", noNote, context)
        : Response.json({ attachments: list });
    }),
    // PUT, because asking twice is the same as asking once.
    route(
      "PUT",
      "/notes/:id/attachments/:attachmentId",
      async (_request, context, { id = "", attachmentId = "" }) => {
        const result = await deps.attachments.finish(context.identity.sub, id, attachmentId);
        switch (result.status) {
          case "attached":
            return Response.json(result.attachment);
          case "note_not_found":
            return failure(404, "not_found", noNote, context);
          case "upload_missing":
            return failure(409, "upload_missing", "No upload has arrived for this ID.", context);
          case "upload_rejected":
            return failure(409, "upload_rejected", result.reason, context);
          case "limit":
            return failure(
              409,
              "attachment_limit",
              `A note holds at most ${MAX_ATTACHMENTS_PER_NOTE} images.`,
              context,
            );
        }
      },
    ),
    route(
      "DELETE",
      "/notes/:id/attachments/:attachmentId",
      async (_request, context, { id = "", attachmentId = "" }) =>
        (await deps.attachments.remove(context.identity.sub, id, attachmentId))
          ? new Response(null, { status: 204 })
          : failure(404, "not_found", "No such attachment.", context),
    ),
  ];
  // #endregion routes

  // #region compose
  // Chapter 06's app, unchanged. The four routes go in as its second argument,
  // which puts them behind its sign-in guard and inside its error catch.
  // Its DELETE /notes/:id now reaches the wrapped note service.
  return createNotesApp(
    { ...deps, notes: withAttachmentCleanup(deps.notes, deps.attachments, deps.log) },
    [...attachments, ...more],
  );
  // #endregion compose
}
