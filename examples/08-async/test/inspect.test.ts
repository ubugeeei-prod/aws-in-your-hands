import { describe, expect, it } from "vite-plus/test";

import { judge, MAX_PIXELS, sniffImage } from "../src/inspect.ts";
import {
  GIF_3X2,
  HTML,
  JPEG_3X2,
  PNG_1X1,
  PNG_3X2,
  pngDeclaring,
  WEBP_LOSSLESS_3X2,
  WEBP_LOSSY_3X2,
  WEBP_VP8X_3X2,
} from "./fixtures.ts";

describe("sniffImage", () => {
  it.each([
    ["PNG", PNG_3X2, "image/png", 170],
    ["JPEG with EXIF before the frame header", JPEG_3X2, "image/jpeg", 719],
    ["GIF", GIF_3X2, "image/gif", 499],
    ["WebP, extended layout", WEBP_VP8X_3X2, "image/webp", 98],
    ["WebP, lossless", WEBP_LOSSLESS_3X2, "image/webp", 36],
    ["WebP, lossy", WEBP_LOSSY_3X2, "image/webp", 64],
  ])("reads type and size from a real %s file", (_name, bytes, type, length) => {
    // The length pins the fixture itself: a damaged copy would not be the file the encoder wrote.
    expect(bytes.byteLength).toBe(length);
    expect(sniffImage(bytes)).toEqual({ type, width: 3, height: 2 });
  });

  it("recognizes nothing in other bytes, or in a file cut short", () => {
    expect(sniffImage(HTML)).toBeUndefined();
    expect(sniffImage(new Uint8Array())).toBeUndefined();
    expect(sniffImage(PNG_3X2.subarray(0, 20))).toBeUndefined();
    expect(sniffImage(JPEG_3X2.subarray(0, 40))).toBeUndefined();
    expect(sniffImage(WEBP_LOSSLESS_3X2.subarray(0, 16))).toBeUndefined();
  });
});

describe("judge", () => {
  it("accepts an image that is what it says it is", () => {
    expect(judge(PNG_1X1, "image/png")).toEqual({ verdict: "ok", width: 1, height: 1 });
  });

  it("rejects an image under another image's name", () => {
    expect(judge(JPEG_3X2, "image/png")).toEqual({ verdict: "rejected", reason: "type_mismatch" });
  });

  it("rejects a size no decoder should be asked to allocate", () => {
    expect(judge(pngDeclaring(8000, 5000), "image/png")).toMatchObject({ verdict: "ok" });
    expect(8000 * 5000).toBe(MAX_PIXELS);
    expect(judge(pngDeclaring(8001, 5000), "image/png")).toEqual({
      verdict: "rejected",
      reason: "too_many_pixels",
    });
    expect(judge(pngDeclaring(0, 10), "image/png")).toEqual({
      verdict: "rejected",
      reason: "not_an_image",
    });
  });
});
