import { createHash } from "node:crypto";

import type { Digest } from "../src/reference.ts";

/** A digest for a made-up image. No image was built: only the shape is real. */
export const digestOf = (label: string): Digest =>
  `sha256:${createHash("sha256").update(label).digest("hex")}`;
