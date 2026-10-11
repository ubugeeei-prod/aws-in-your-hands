// Real files, 3 pixels wide and 2 high, written by macOS `sips` (PNG, JPEG,
// GIF) and by `cwebp` (WebP), so the header parsing in src/inspect.ts is checked
// against what encoders actually emit, not against bytes typed in by hand.
const decode = (base64: string): Uint8Array => new Uint8Array(Buffer.from(base64, "base64"));

export const PNG_3X2 = decode(
  "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAA6ADAAQAAAABAAAAAgAAAABqvnfpAAAAFElEQVQIHWNkYPhfzwAFTDAGiAYAIiEBgrsG/REAAAAASUVORK5CYII=",
);

/** Chapter 07's smoke-test pixel. */
export const PNG_1X1 = decode(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
);

// The frame header sits after an EXIF block here, as it does in photos from a phone.
export const JPEG_3X2 = decode(
  "/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAA6ADAAQAAAABAAAAAgAAAAD/wAARCAACAAMDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9sAQwACAgICAgIDAgIDBQMDAwUGBQUFBQYIBgYGBgYICggICAgICAoKCgoKCgoKDAwMDAwMDg4ODg4PDw8PDw8PDw8P/9sAQwECAgIEBAQHBAQHEAsJCxAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ/90ABAAB/9oADAMBAAIRAxEAPwDuKKKK/wBAD5c//9k=",
);

export const GIF_3X2 = decode(
  "R0lGODdhAwACAJEAAAAAAAAA/////wAAACH5BAkAAAMAIf8LWE1QIERhdGFYTVD/PHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iWE1QIENvcmUgNi4wLjAiPgogICA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPgogICAgICA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIgogICAgICAgICAgICB4bWxuczpleGlmPSJodHRwOi8vbnMuYWRvYmUuY29tL2V4aWYvMS4wLyI+CiAgICAgICAgIDxleGlmOkNvbG9yU3BhY2U+MTwvZXhpsmY6Q29sb3JTcGFjZT4KICAgICAgICAgPGV4aWY6UGl4ZWxYRGltZW5zaW9uPjM8L2V4aWY6UGl4ZWxYRGltZW5zaW9uPgogICAgICAgICA8ZXhpZjpQaXhlbFlEaW1lbnNpb24+MjwvZXhpZjpQaXhlbFlEaW1lbnNpb24+CiAgICAgIDwvcmRmOkRlc2NyaXB0aW9uPgogICA8L3JkZjpSREY+CjwveDp4bXBtZXRhPgoALAAAAAADAAIAAAICjF8AOw==",
);

/** Lossy with alpha: the extended (VP8X) layout, with a VP8 chunk further in. */
export const WEBP_VP8X_3X2 = decode(
  "UklGRloAAABXRUJQVlA4WAoAAAAQAAAAAgAAAQAAQUxQSAcAAAAAf39/f39/AFZQOCAsAAAAkAEAnQEqAwACAAIANCWgAnS6AAOYAP75k2//kB//kB//kB//ID/iF3sgMAA=",
);

export const WEBP_LOSSLESS_3X2 = decode("UklGRhwAAABXRUJQVlA4TA8AAAAvAkAAEAcQ0f/+BSKi/wEA");

/** The plain lossy layout: the VP8 chunk of the file above, in a container of its own. */
export const WEBP_LOSSY_3X2 = (() => {
  const chunk = WEBP_VP8X_3X2.subarray(46);
  const file = new Uint8Array(12 + chunk.byteLength);
  file.set(new TextEncoder().encode("RIFF"), 0);
  new DataView(file.buffer).setUint32(4, 4 + chunk.byteLength, true);
  file.set(new TextEncoder().encode("WEBP"), 8);
  file.set(chunk, 12);
  return file;
})();

export const HTML = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");

/** A PNG header that declares the given size, and nothing after it. */
export function pngDeclaring(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(PNG_1X1.subarray(0, 33));
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}
