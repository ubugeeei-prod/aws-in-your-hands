import { z } from "zod";

import { errorCodes as noteErrorCodes, noteSchema } from "@aih/example-06-auth/api/src/contract.ts";

// #region limits
// SVG is left out on purpose: it can carry script.
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** A soft limit: two uploads finishing at the same moment can both pass the count. */
export const MAX_ATTACHMENTS_PER_NOTE = 10;
// #endregion limits

// #region upload
// The caller chooses the type of the image and nothing else. Not the key, not
// the bucket, not the size limit.
export const uploadRequestSchema = z.object({ contentType: z.enum(IMAGE_TYPES) });
export type UploadRequest = z.infer<typeof uploadRequestSchema>;

export const uploadPermitSchema = z.object({
  attachmentId: z.string().min(1),
  /** Sent as multipart/form-data: every field as given, then the file as the last field. */
  upload: z.object({
    url: z.url({ protocol: /^https?$/ }),
    fields: z.record(z.string(), z.string()),
  }),
  maxBytes: z.number().int().positive(),
  expiresAt: z.iso.datetime(),
});
export type UploadPermit = z.infer<typeof uploadPermitSchema>;
// #endregion upload

// #region attachment
export const attachmentSchema = z.object({
  id: z.string().min(1),
  noteId: z.string().min(1),
  contentType: z.enum(IMAGE_TYPES),
  size: z.number().int().positive(),
  createdAt: z.iso.datetime(),
});
export type Attachment = z.infer<typeof attachmentSchema>;

export const attachmentViewSchema = attachmentSchema.extend({
  /** Works for anyone who holds it, without signing in, until `urlExpiresAt`. */
  url: z.url({ protocol: /^https?$/ }),
  urlExpiresAt: z.iso.datetime(),
});
export type AttachmentView = z.infer<typeof attachmentViewSchema>;

export const attachmentListSchema = z.object({ attachments: z.array(attachmentViewSchema) });
// #endregion attachment

// #region error
export const errorCodes = [
  ...noteErrorCodes,
  // Nothing has arrived under this attachment's key.
  "upload_missing",
  // Something arrived, but too late, or it is not what the permit allowed.
  "upload_rejected",
  "attachment_limit",
] as const;

export const errorSchema = z.object({
  error: z.object({
    code: z.enum(errorCodes),
    message: z.string(),
    requestId: z.string(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
    current: noteSchema.optional(),
  }),
});
export type ErrorBody = z.infer<typeof errorSchema>;
// #endregion error
