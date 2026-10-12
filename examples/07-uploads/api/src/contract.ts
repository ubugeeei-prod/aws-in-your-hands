import * as v from "valibot";

import { utcTimestamp } from "@aih/example-04-http-api/src/timestamp.ts";
import { errorCodes as noteErrorCodes, noteSchema } from "@aih/example-06-auth/api/src/contract.ts";

// #region limits
// SVG is left out on purpose: it can carry script.
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** A soft limit: two uploads finishing at the same moment can both pass the count. */
export const MAX_ATTACHMENTS_PER_NOTE = 10;
// Each permit can leave up to MAX_UPLOAD_BYTES in the bucket for a day, whether or not it is finished.
export const MAX_UPLOAD_PERMITS_PER_OWNER_PER_DAY = 100;
// #endregion limits

// #region upload
// v.url() alone would accept "javascript:alert(1)". One of these ends up in an <img>.
const httpUrl = v.pipe(
  v.string(),
  v.url(),
  v.regex(/^https?:\/\//, "Must be an http or https URL."),
);
const timestamp = utcTimestamp;
const positiveInteger = v.pipe(v.number(), v.safeInteger(), v.minValue(1));
const id = v.pipe(v.string(), v.minLength(1));

// The caller chooses the type of the image and nothing else. Not the key, not
// the bucket, not the size limit.
export const uploadRequestSchema = v.object({ contentType: v.picklist(IMAGE_TYPES) });
export type UploadRequest = v.InferOutput<typeof uploadRequestSchema>;

export const uploadPermitSchema = v.object({
  attachmentId: id,
  /** Sent as multipart/form-data: every field as given, then the file as the last field. */
  upload: v.object({
    url: httpUrl,
    fields: v.record(v.string(), v.string()),
  }),
  maxBytes: positiveInteger,
  expiresAt: timestamp,
});
export type UploadPermit = v.InferOutput<typeof uploadPermitSchema>;
// #endregion upload

// #region attachment
export const attachmentSchema = v.object({
  id,
  noteId: id,
  contentType: v.picklist(IMAGE_TYPES),
  size: positiveInteger,
  createdAt: timestamp,
});
export type Attachment = v.InferOutput<typeof attachmentSchema>;

export const attachmentViewSchema = v.object({
  ...attachmentSchema.entries,
  /** Works for anyone who holds it, without signing in, until `urlExpiresAt`. */
  url: httpUrl,
  urlExpiresAt: timestamp,
});
export type AttachmentView = v.InferOutput<typeof attachmentViewSchema>;

export const attachmentListSchema = v.object({ attachments: v.array(attachmentViewSchema) });
// #endregion attachment

// #region error
export const errorCodes = [
  ...noteErrorCodes,
  // Nothing has arrived under this attachment's key.
  "upload_missing",
  // Something arrived, but too late, or it is not what the permit allowed.
  "upload_rejected",
  "attachment_limit",
  // The owner has asked for as many upload permits as one day allows.
  "upload_quota_exceeded",
] as const;

export const errorSchema = v.object({
  error: v.object({
    code: v.picklist(errorCodes),
    message: v.string(),
    requestId: v.string(),
    issues: v.optional(v.array(v.object({ path: v.string(), message: v.string() }))),
    current: v.optional(noteSchema),
  }),
});
export type ErrorBody = v.InferOutput<typeof errorSchema>;
// #endregion error
