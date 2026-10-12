import type { IMAGE_TYPES } from "@aih/example-07-uploads/api/src/contract.ts";

export type ImageType = (typeof IMAGE_TYPES)[number];
export type Sniffed = { type: ImageType; width: number; height: number };

const ascii = (bytes: Uint8Array, at: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(at, at + length));
const view = (bytes: Uint8Array): DataView =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

// #region sniff
// Reads the type and the pixel size from the first bytes of the file, and
// decodes nothing. That is why no image library, and no native code, is needed.
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function png(bytes: Uint8Array): Sniffed | undefined {
  if (
    bytes.length < 24 ||
    PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte) ||
    ascii(bytes, 12, 4) !== "IHDR"
  ) {
    return undefined;
  }
  return { type: "image/png", width: view(bytes).getUint32(16), height: view(bytes).getUint32(20) };
}

function gif(bytes: Uint8Array): Sniffed | undefined {
  if (bytes.length < 10 || !["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6))) {
    return undefined;
  }
  return {
    type: "image/gif",
    width: view(bytes).getUint16(6, true),
    height: view(bytes).getUint16(8, true),
  };
}

function jpeg(bytes: Uint8Array): Sniffed | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return undefined;
  }
  // Segments follow: FF, a marker byte, and (for most markers) a two-byte length.
  // The size is in the frame header (SOF), which can sit after a large EXIF block.
  let offset = 2;
  while (offset + 9 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      return undefined;
    }
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Start of scan or end of image before any frame header: not a usable JPEG.
    if (marker === 0xda || marker === 0xd9) {
      return undefined;
    }
    const isFrameHeader =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrameHeader) {
      return {
        type: "image/jpeg",
        height: view(bytes).getUint16(offset + 5),
        width: view(bytes).getUint16(offset + 7),
      };
    }
    offset += 2 + view(bytes).getUint16(offset + 2);
  }
  return undefined;
}

function webp(bytes: Uint8Array): Sniffed | undefined {
  if (bytes.length < 30 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") {
    return undefined;
  }
  const data = view(bytes);
  switch (ascii(bytes, 12, 4)) {
    case "VP8 ":
      return {
        type: "image/webp",
        width: data.getUint16(26, true) & 0x3fff,
        height: data.getUint16(28, true) & 0x3fff,
      };
    case "VP8L": {
      const bits = data.getUint32(21, true);
      return {
        type: "image/webp",
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
      };
    }
    case "VP8X": {
      const uint24 = (at: number) => data.getUint16(at, true) | ((bytes[at + 2] ?? 0) << 16);
      return { type: "image/webp", width: uint24(24) + 1, height: uint24(27) + 1 };
    }
    default:
      return undefined;
  }
}

export function sniffImage(bytes: Uint8Array): Sniffed | undefined {
  return png(bytes) ?? gif(bytes) ?? jpeg(bytes) ?? webp(bytes);
}
// #endregion sniff

// #region judge
// A 5 MB file can declare any size it likes. Whatever decodes this image
// later (a browser, a thumbnailer) allocates memory for the declared pixels.
export const MAX_PIXELS = 40_000_000;

export type Verdict =
  | { verdict: "ok"; width: number; height: number }
  | { verdict: "rejected"; reason: "not_an_image" | "type_mismatch" | "too_many_pixels" };

/** `declaredType` is what the upload claimed; S3 stored it without looking inside. */
export function judge(bytes: Uint8Array, declaredType: string): Verdict {
  const sniffed = sniffImage(bytes);
  if (sniffed === undefined || sniffed.width < 1 || sniffed.height < 1) {
    return { verdict: "rejected", reason: "not_an_image" };
  }
  if (sniffed.type !== declaredType) {
    return { verdict: "rejected", reason: "type_mismatch" };
  }
  if (sniffed.width * sniffed.height > MAX_PIXELS) {
    return { verdict: "rejected", reason: "too_many_pixels" };
  }
  return { verdict: "ok", width: sniffed.width, height: sniffed.height };
}
// #endregion judge
