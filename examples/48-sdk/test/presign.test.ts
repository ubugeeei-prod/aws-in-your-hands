import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { startLocalEndpoint } from "../src/local-endpoint.ts";
import { isolateSdkEnvironment } from "./support.ts";

beforeAll(() => isolateSdkEnvironment());

const get = new GetObjectCommand({ Bucket: "attachments", Key: "u1/a.txt" });
const longTerm = { accessKeyId: "AKIDLOCALEXAMPLE", secretAccessKey: "local-secret" };

describe("a presigned URL", () => {
  it("is computed in this process: nothing is sent to make one", async () => {
    const endpoint = await startLocalEndpoint(() => ({ status: 500 }));
    const s3 = new S3Client({
      endpoint: endpoint.url,
      region: "ap-northeast-1",
      credentials: longTerm,
      forcePathStyle: true,
    });

    const url = new URL(await getSignedUrl(s3, get));

    expect(url.origin).toBe(endpoint.url);
    expect(endpoint.calls).toHaveLength(0);
    await endpoint.close();
  });

  it("lasts 900 seconds unless told otherwise", async () => {
    const s3 = new S3Client({ region: "ap-northeast-1", credentials: longTerm });

    const byDefault = new URL(await getSignedUrl(s3, get));
    const anHour = new URL(await getSignedUrl(s3, get, { expiresIn: 3600 }));

    expect(byDefault.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(anHour.searchParams.get("X-Amz-Expires")).toBe("3600");
  });

  it("names the key that signed it, and carries the session token of temporary credentials", async () => {
    const s3 = new S3Client({
      region: "ap-northeast-1",
      credentials: { accessKeyId: "ASIALOCALEXAMPLE", secretAccessKey: "s", sessionToken: "TOKEN" },
    });

    const url = new URL(await getSignedUrl(s3, get, { expiresIn: 3600 }));

    expect(url.searchParams.get("X-Amz-Credential")).toMatch(/^ASIALOCALEXAMPLE\//);
    // The URL is the role session's, whatever X-Amz-Expires says.
    expect(url.searchParams.get("X-Amz-Security-Token")).toBe("TOKEN");
  });

  it("for PutObject carries a checksum of an empty body, computed before any body exists", async () => {
    const s3 = new S3Client({ region: "ap-northeast-1", credentials: longTerm });

    const url = new URL(
      await getSignedUrl(s3, new PutObjectCommand({ Bucket: "attachments", Key: "u1/a.txt" })),
    );

    expect(url.searchParams.get("x-amz-sdk-checksum-algorithm")).toBe("CRC32");
    // The CRC32 of zero bytes.
    expect(url.searchParams.get("x-amz-checksum-crc32")).toBe("AAAAAA==");
  });

  it("has no token when a long-term key signed it", async () => {
    const s3 = new S3Client({ region: "ap-northeast-1", credentials: longTerm });

    const url = new URL(await getSignedUrl(s3, get));

    expect(url.searchParams.has("X-Amz-Security-Token")).toBe(false);
  });
});
