import { type AppDeps as NotesAppDeps, createApp as createNotesApp } from "@aih/example-06-auth/api/src/app.ts";
import { bodyLimit } from "hono/body-limit";
import { validator } from "hono/validator";
import { type AttachmentService, withAttachmentCleanup } from "./attachments.ts";
import { type ErrorBody, MAX_ATTACHMENTS_PER_NOTE, uploadRequestSchema } from "./contract.ts";

export type AppDeps = NotesAppDeps & { attachments: AttachmentService };

const failure = (
  code: ErrorBody["error"]["code"],
  message: string,
  requestId: string,
  issues?: { path: string; message: string }[],
) => ({ error: { code, message, requestId, ...(issues === undefined ? {} : { issues }) } }) satisfies ErrorBody;

export function createApp(deps: AppDeps) {
  // Chapter 06's app, unchanged, with four routes added behind its sign-in
  // guard. Its DELETE /notes/:id now reaches the wrapped note service.
  const app = createNotesApp({ ...deps, notes: withAttachmentCleanup(deps.notes, deps.attachments, deps.log) });

  // The image itself never passes through here; only this small JSON does.
  const limit = bodyLimit({
    maxSize: 1024,
    onError: (c) => c.json(failure("payload_too_large", "The request body exceeds 1 KiB.", c.get("requestId")), 413),
  });
  const noNote = "No such note.";

  return (
    app
      // #region routes
      // As in chapter 06, the owner is the token's `sub` and nothing else.
      .post(
        "/notes/:id/attachments",
        limit,
        validator("json", (value, c) => {
          const input = uploadRequestSchema.safeParse(value);
          return input.success
            ? input.data
            : c.json(
                failure(
                  "invalid_request",
                  "The upload request is not valid.",
                  c.get("requestId"),
                  input.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
                ),
                400,
              );
        }),
        async (c) => {
          const result = await deps.attachments.requestUpload(
            c.get("identity").sub,
            c.req.param("id"),
            c.req.valid("json"),
          );
          switch (result.status) {
            case "permitted":
              return c.json(result.permit, 201);
            case "note_not_found":
              return c.json(failure("not_found", noNote, c.get("requestId")), 404);
            case "limit":
              return c.json(
                failure(
                  "attachment_limit",
                  `A note holds at most ${MAX_ATTACHMENTS_PER_NOTE} images.`,
                  c.get("requestId"),
                ),
                409,
              );
          }
        },
      )
      .get("/notes/:id/attachments", async (c) => {
        const attachments = await deps.attachments.list(c.get("identity").sub, c.req.param("id"));
        return attachments === undefined
          ? c.json(failure("not_found", noNote, c.get("requestId")), 404)
          : c.json({ attachments }, 200);
      })
      // PUT, because asking twice is the same as asking once.
      .put("/notes/:id/attachments/:attachmentId", async (c) => {
        const result = await deps.attachments.finish(
          c.get("identity").sub,
          c.req.param("id"),
          c.req.param("attachmentId"),
        );
        switch (result.status) {
          case "attached":
            return c.json(result.attachment, 200);
          case "note_not_found":
            return c.json(failure("not_found", noNote, c.get("requestId")), 404);
          case "upload_missing":
            return c.json(failure("upload_missing", "No upload has arrived for this ID.", c.get("requestId")), 409);
          case "upload_rejected":
            return c.json(failure("upload_rejected", result.reason, c.get("requestId")), 409);
          case "limit":
            return c.json(
              failure(
                "attachment_limit",
                `A note holds at most ${MAX_ATTACHMENTS_PER_NOTE} images.`,
                c.get("requestId"),
              ),
              409,
            );
        }
      })
      .delete("/notes/:id/attachments/:attachmentId", async (c) =>
        (await deps.attachments.remove(c.get("identity").sub, c.req.param("id"), c.req.param("attachmentId")))
          ? c.body(null, 204)
          : c.json(failure("not_found", "No such attachment.", c.get("requestId")), 404),
      )
    // #endregion routes
  );
}

export type App = ReturnType<typeof createApp>;
