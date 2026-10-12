import {
  type GetObjectCommand,
  NotFound,
  PutObjectCommand,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { describe, expect, it } from "vite-plus/test";

import { isKeySegment } from "@aih/example-07-uploads/api/src/keys.ts";

import { ownerFromFunctionUrl } from "../src/identity.ts";
import { S3Media } from "../src/s3-media.ts";

const refusal = (status: number) =>
  new S3ServiceException({
    name: status === 412 ? "PreconditionFailed" : "ConditionalRequestConflict",
    $fault: "client",
    $metadata: { httpStatusCode: status },
    message: "refused",
  });

/** Records what was sent. Answers with `outcome`, or throws it when it is an error. */
function fakeS3(outcome: unknown = {}) {
  const sent: (PutObjectCommand | GetObjectCommand)[] = [];
  const media = new S3Media(
    {
      send: (command: PutObjectCommand | GetObjectCommand) => {
        sent.push(command);
        return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
      },
    } as never,
    "media-bucket",
  );
  return { media, sent };
}

describe("S3Media", () => {
  it("writes a new object with If-None-Match: *", async () => {
    const { media, sent } = fakeS3();

    expect(await media.putIfAbsent("g/a/n/i/description.json", "{}")).toBe("created");
    expect(sent[0]).toBeInstanceOf(PutObjectCommand);
    expect(sent[0]?.input).toEqual({
      Bucket: "media-bucket",
      Key: "g/a/n/i/description.json",
      Body: "{}",
      ContentType: "application/json",
      IfNoneMatch: "*",
    });
  });

  it("replaces an object with If-Match and the ETag it read", async () => {
    const { media, sent } = fakeS3();

    expect(await media.replaceIfMatch("c/a/n/i/description.json", '"abc"', "{}")).toBe("replaced");
    expect(sent[0]?.input).toMatchObject({ IfMatch: '"abc"' });
    expect(sent[0]?.input).not.toHaveProperty("IfNoneMatch");
  });

  it.each([412, 409])(
    "reads a %i as the condition not holding, not as a failure",
    async (status) => {
      const { media } = fakeS3(refusal(status));

      expect(await media.putIfAbsent("k", "{}")).toBe("exists");
      expect(await media.replaceIfMatch("k", '"abc"', "{}")).toBe("changed");
    },
  );

  it("lets any other error through", async () => {
    const { media } = fakeS3(refusal(403));

    await expect(media.putIfAbsent("k", "{}")).rejects.toThrow("refused");
    await expect(media.replaceIfMatch("k", '"abc"', "{}")).rejects.toThrow("refused");
  });

  it("reads a missing object as undefined", async () => {
    const { media } = fakeS3(new NotFound({ $metadata: {}, message: "no" }));

    expect(await media.head("u/a/n/i")).toBeUndefined();
  });
});

describe("the owner behind a function URL", () => {
  const event = (userId: string) => ({ requestContext: { authorizer: { iam: { userId } } } });

  it("is a key segment, even when the IAM ID carries a session name", () => {
    const owner = ownerFromFunctionUrl(event("AROAEXAMPLEID:alice@example.com"));

    expect(owner).toMatch(/^[0-9a-f]{32}$/);
    expect(isKeySegment(owner ?? "")).toBe(true);
  });

  it("is the same for the same caller, and different for another", () => {
    expect(ownerFromFunctionUrl(event("AIDAEXAMPLE1"))).toBe(
      ownerFromFunctionUrl(event("AIDAEXAMPLE1")),
    );
    expect(ownerFromFunctionUrl(event("AIDAEXAMPLE1"))).not.toBe(
      ownerFromFunctionUrl(event("AIDAEXAMPLE2")),
    );
  });

  it("is nobody when the URL did not check a signature", () => {
    expect(ownerFromFunctionUrl({ requestContext: {} })).toBeUndefined();
    expect(ownerFromFunctionUrl(event(""))).toBeUndefined();
    expect(ownerFromFunctionUrl(undefined)).toBeUndefined();
  });
});
