import { describe, expect, it } from "vite-plus/test";

import { MAX_UPLOAD_BYTES } from "../../api/src/contract.ts";
import { checkFile } from "./check-file.ts";

describe("file check in the browser", () => {
  it("passes the four image types up to the size limit", () => {
    expect(checkFile({ type: "image/webp", size: MAX_UPLOAD_BYTES })).toEqual({
      ok: true,
      contentType: "image/webp",
    });
  });

  it("stops other types, SVG included, and files outside the size range", () => {
    for (const file of [
      { type: "image/svg+xml", size: 10 },
      { type: "", size: 10 },
      { type: "image/png", size: 0 },
      { type: "image/png", size: MAX_UPLOAD_BYTES + 1 },
    ]) {
      expect(checkFile(file), JSON.stringify(file)).toMatchObject({ ok: false });
    }
  });
});
