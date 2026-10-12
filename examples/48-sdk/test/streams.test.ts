import { Readable } from "node:stream";

import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { readText } from "../src/body.ts";
import {
  type Answer,
  type LocalEndpoint,
  localClientConfig,
  type Script,
  startLocalEndpoint,
  xml,
} from "../src/local-endpoint.ts";
import { isolateSdkEnvironment } from "./support.ts";

beforeAll(() => isolateSdkEnvironment());

let endpoint: LocalEndpoint;
let s3: S3Client;

async function against(script: Script): Promise<void> {
  endpoint = await startLocalEndpoint(script);
  // Path style: the bucket goes in the path, since 127.0.0.1 has no subdomains.
  s3 = new S3Client({ ...localClientConfig(endpoint), forcePathStyle: true });
}

afterEach(async () => {
  vi.restoreAllMocks();
  s3.destroy();
  await endpoint.close();
});

const object = (body: string): Answer => ({
  status: 200,
  headers: { "content-type": "text/plain", etag: '"local"' },
  body,
});
const get = () => new GetObjectCommand({ Bucket: "attachments", Key: "u1/a.txt" });

describe("the Body of GetObject", () => {
  it("is a stream that transformToString reads once, and only once", async () => {
    await against(() => object("hello"));
    const { Body } = await s3.send(get());

    expect(await Body?.transformToString()).toBe("hello");
    await expect(Body?.transformToString()).rejects.toThrow("already been transformed");
  });

  it("is a Node.js stream here, and a web stream on request", async () => {
    await against(() => object("hello"));
    const { Body } = await s3.send(get());

    expect(Body).toBeInstanceOf(Readable);
    const web = Body?.transformToWebStream();
    expect(web).toBeInstanceOf(ReadableStream);
    expect(await new Response(web).text()).toBe("hello");
  });

  it("can be read with a ceiling, and the next call still gets through", async () => {
    await against(() => object("x".repeat(100_000)));
    const first = await s3.send(get());
    const second = await s3.send(get());

    expect(await readText(first.Body!, 1024)).toEqual({ ok: false, reason: "too_large" });
    const whole = await readText(second.Body!, 200_000);
    expect(whole.ok && whole.text.length).toBe(100_000);
  });

  it("is absent on an error, which is a class like any other", async () => {
    await against(() => ({
      status: 404,
      headers: { "content-type": "application/xml" },
      body: "<Error><Code>NoSuchKey</Code><Message>no such key</Message></Error>",
    }));

    await expect(s3.send(get())).rejects.toBeInstanceOf(NoSuchKey);
  });
});

describe("a Body that is sent", () => {
  it("is sent again after a 500 when it is bytes", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    await against(() => ({ status: 500 }));

    await expect(
      s3.send(new PutObjectCommand({ Bucket: "attachments", Key: "k", Body: "bytes" })),
    ).rejects.toMatchObject({ $metadata: { attempts: 3 } });
  });

  it("is not sent again when it is a stream: a stream cannot be read twice", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await against(() => ({ status: 500 }));

    await expect(
      s3.send(
        new PutObjectCommand({
          Bucket: "attachments",
          Key: "k",
          Body: Readable.from([Buffer.from("stream")]),
          ContentLength: 6,
        }),
      ),
    ).rejects.toBeDefined();
    expect(endpoint.calls).toHaveLength(1);
  });
});

// The four requests of a multipart upload, answered with fixed IDs. The parts are not kept.
const multipart: Script = (call) => {
  if (call.method === "POST" && call.query.has("uploads")) {
    return xml(
      "<InitiateMultipartUploadResult><UploadId>U1</UploadId></InitiateMultipartUploadResult>",
    );
  }
  if (call.method === "PUT" && call.query.has("partNumber")) {
    return { status: 200, headers: { etag: `"part-${call.query.get("partNumber")}"` } };
  }
  if (call.method === "POST" && call.query.has("uploadId")) {
    return xml(
      '<CompleteMultipartUploadResult><ETag>"whole"</ETag></CompleteMultipartUploadResult>',
    );
  }
  if (call.method === "DELETE" && call.query.has("uploadId")) {
    return { status: 204 };
  }
  return { status: 200, headers: { etag: '"single"' } };
};

const MIB = 1024 * 1024;
const kindOf = (call: { method: string; query: URLSearchParams }): string => {
  if (call.query.has("uploads")) {
    return "CreateMultipartUpload";
  }
  if (call.query.has("partNumber")) {
    return `UploadPart ${call.query.get("partNumber")}`;
  }
  if (call.query.has("uploadId")) {
    return call.method === "DELETE" ? "AbortMultipartUpload" : "CompleteMultipartUpload";
  }
  return "PutObject";
};

describe("Upload from lib-storage", () => {
  const upload = (bytes: number) =>
    new Upload({
      client: s3,
      params: { Bucket: "attachments", Key: "u1/big", Body: Buffer.alloc(bytes) },
    });

  it("is one PutObject when the body fits in a single part", async () => {
    await against(multipart);

    await upload(5 * MIB).done();

    expect(endpoint.calls.map(kindOf)).toEqual(["PutObject"]);
  });

  it("becomes a multipart upload one byte past 5 MiB, completed with the parts in order", async () => {
    await against(multipart);

    const result = await upload(5 * MIB + 1).done();

    expect(result.ETag).toBe('"whole"');
    expect(endpoint.calls.map(kindOf).toSorted()).toEqual([
      "CompleteMultipartUpload",
      "CreateMultipartUpload",
      "UploadPart 1",
      "UploadPart 2",
    ]);
    const completion = endpoint.calls.at(-1)?.body.toString() ?? "";
    expect(completion.indexOf("<PartNumber>1</PartNumber>")).toBeLessThan(
      completion.indexOf("<PartNumber>2</PartNumber>"),
    );
  });

  it("aborts the multipart upload when a part fails for good", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    await against((call, index) =>
      call.query.get("partNumber") === "2" ? { status: 500 } : multipart(call, index),
    );

    await expect(upload(5 * MIB + 1).done()).rejects.toBeDefined();

    expect(endpoint.calls.map(kindOf)).toContain("AbortMultipartUpload");
    expect(endpoint.calls.map(kindOf)).not.toContain("CompleteMultipartUpload");
  });
});
