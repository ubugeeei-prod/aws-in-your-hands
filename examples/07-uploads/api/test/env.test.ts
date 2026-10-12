import { describe, expect, it } from "vite-plus/test";

import { parseUploadsEnv } from "../src/env.ts";

describe("uploads environment", () => {
  it("needs no bucket when uploads are kept in memory", () => {
    expect(parseUploadsEnv({ UPLOADS_STORE: "memory" })).toEqual({ UPLOADS_STORE: "memory" });
  });

  it("requires the bucket name for S3", () => {
    expect(() => parseUploadsEnv({ UPLOADS_STORE: "s3" })).toThrow(/UPLOADS_BUCKET/);
    expect(parseUploadsEnv({ UPLOADS_STORE: "s3", UPLOADS_BUCKET: "bucket" })).toMatchObject({
      UPLOADS_BUCKET: "bucket",
    });
  });

  it("refuses to start without saying where uploads go", () => {
    expect(() => parseUploadsEnv({})).toThrow(/UPLOADS_STORE/);
  });
});
