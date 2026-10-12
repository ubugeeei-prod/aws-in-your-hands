import {
  DeleteObjectTaggingCommand,
  HeadObjectCommand,
  NotFound,
  S3Client,
} from "@aws-sdk/client-s3";
import * as v from "valibot";
import { describe, expect, it, vi } from "vite-plus/test";

import { S3ObjectStore } from "../src/s3-object-store.ts";

// Signing is arithmetic on made-up credentials: nothing here reaches AWS. So
// these show what S3 is asked to enforce, not that S3 enforces it.
const client = () =>
  new S3Client({
    region: "ap-northeast-1",
    credentials: {
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "not-a-real-secret",
      sessionToken: "session-token",
    },
  });

const policySchema = v.object({
  expiration: v.pipe(v.string(), v.isoTimestamp()),
  conditions: v.array(v.unknown()),
});

describe("the upload form", () => {
  it("asks S3 to enforce the key, the type, the size range, the tag, and an expiry", async () => {
    const before = Date.now();
    const form = await new S3ObjectStore(client(), "uploads-bucket").presignUpload({
      key: "u/alice/n1/a1",
      contentType: "image/png",
      maxBytes: 5 * 1024 * 1024,
      expiresInSeconds: 300,
    });
    const policy = v.parse(
      policySchema,
      JSON.parse(Buffer.from(form.fields["Policy"] ?? "", "base64").toString("utf8")),
    );

    expect(policy.conditions).toContainEqual({ bucket: "uploads-bucket" });
    expect(policy.conditions).toContainEqual({ key: "u/alice/n1/a1" });
    expect(policy.conditions).toContainEqual({ "Content-Type": "image/png" });
    expect(policy.conditions).toContainEqual(["content-length-range", 1, 5 * 1024 * 1024]);
    expect(policy.conditions).toContainEqual({
      tagging:
        "<Tagging><TagSet><Tag><Key>upload-state</Key><Value>pending</Value></Tag></TagSet></Tagging>",
    });
    // No "starts-with": nothing is left for the browser to choose.
    expect(JSON.stringify(policy.conditions)).not.toContain("starts-with");

    const lifetime = new Date(policy.expiration).getTime() - before;
    expect(lifetime).toBeGreaterThan(298_000);
    expect(lifetime).toBeLessThan(302_000);
  });

  it("carries every field the policy names, and the session token of temporary credentials", async () => {
    const form = await new S3ObjectStore(client(), "uploads-bucket").presignUpload({
      key: "u/alice/n1/a1",
      contentType: "image/png",
      maxBytes: 1024,
      expiresInSeconds: 300,
    });
    expect(form.url).toBe("https://uploads-bucket.s3.ap-northeast-1.amazonaws.com/");
    expect(form.fields).toMatchObject({
      key: "u/alice/n1/a1",
      "Content-Type": "image/png",
      "X-Amz-Security-Token": "session-token",
    });
    expect(Object.keys(form.fields)).toContain("X-Amz-Signature");
  });
});

describe("the view URL", () => {
  it("is a GET for one key that lasts five minutes", async () => {
    const url = new URL(
      await new S3ObjectStore(client(), "uploads-bucket").presignView("u/alice/n1/a1", 300),
    );
    expect(url.origin + url.pathname).toBe(
      "https://uploads-bucket.s3.ap-northeast-1.amazonaws.com/u/alice/n1/a1",
    );
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(url.searchParams.get("X-Amz-Security-Token")).toBe("session-token");
  });
});

describe("calls to S3", () => {
  it("reads a missing object as undefined, and any other failure as a failure", async () => {
    const s3 = client();
    const send = vi.spyOn(s3, "send");
    const store = new S3ObjectStore(s3, "uploads-bucket");

    send.mockImplementationOnce(async () => {
      throw new NotFound({ message: "Not Found", $metadata: { httpStatusCode: 404 } });
    });
    expect(await store.head("u/alice/n1/a1")).toBeUndefined();

    // Without s3:ListBucket, S3 answers 403 for a missing key. That must not read as "missing".
    send.mockImplementationOnce(async () => {
      throw Object.assign(new Error("Forbidden"), {
        name: "403",
        $metadata: { httpStatusCode: 403 },
      });
    });
    await expect(store.head("u/alice/n1/a1")).rejects.toThrow("Forbidden");
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(HeadObjectCommand);
  });

  it("takes the pending tag off when an upload is attached", async () => {
    const s3 = client();
    const send = vi.spyOn(s3, "send").mockImplementation(async () => ({ $metadata: {} }));
    await new S3ObjectStore(s3, "uploads-bucket").markAttached("u/alice/n1/a1");
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(DeleteObjectTaggingCommand);
    expect(command?.input).toEqual({ Bucket: "uploads-bucket", Key: "u/alice/n1/a1" });
  });
});
