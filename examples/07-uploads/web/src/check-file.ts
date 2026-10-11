import { IMAGE_TYPES, MAX_UPLOAD_BYTES, type UploadRequest } from "../../api/src/contract.ts";

// #region check-file
export type FileCheck = { ok: true; contentType: UploadRequest["contentType"] } | { ok: false; message: string };

/** Saves a round trip for an honest user. Anyone can skip it, so nothing depends on it. */
export function checkFile(file: { type: string; size: number }): FileCheck {
  const contentType = IMAGE_TYPES.find((type) => type === file.type);
  if (contentType === undefined) {
    return { ok: false, message: "Choose a PNG, JPEG, WebP or GIF image." };
  }
  if (file.size < 1 || file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, message: `The image must be between 1 byte and ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` };
  }
  return { ok: true, contentType };
}
// #endregion check-file
