import { createHash } from "node:crypto";

import { describe, expect, it } from "vite-plus/test";

import { handler } from "../src/lambda-edge/body-digest.ts";

const originRequest = (method: string, body?: { data: string; inputTruncated?: boolean }) => ({
  Records: [
    {
      cf: {
        config: { eventType: "origin-request" },
        request: {
          method,
          uri: "/digest",
          ...(body === undefined
            ? {}
            : {
                body: {
                  action: "read-only",
                  encoding: "base64",
                  inputTruncated: body.inputTruncated ?? false,
                  data: body.data,
                },
              }),
        },
      },
    },
  ],
});

describe("body-digest (Lambda@Edge, origin request)", () => {
  it("answers with the size and SHA-256 of the body it was given", async () => {
    const payload = Buffer.from('{"hello":"edge"}');
    const response = await handler(originRequest("POST", { data: payload.toString("base64") }));

    expect(response.status).toBe("200");
    expect(JSON.parse(response.body ?? "")).toEqual({
      bytes: payload.byteLength,
      sha256: createHash("sha256").update(payload).digest("hex"),
      truncated: false,
    });
    expect(response.headers?.["cache-control"]?.[0]?.value).toBe("no-store");
  });

  it("says so when CloudFront cut the body short", async () => {
    // Past 1 MB, the function sees a prefix. A digest of a prefix must not pass for a digest of the whole.
    const response = await handler(originRequest("POST", { data: "AAAA", inputTruncated: true }));
    expect(JSON.parse(response.body ?? "")).toMatchObject({ bytes: 3, truncated: true });
  });

  it("refuses other methods without asking the origin", async () => {
    const response = await handler(originRequest("GET"));
    expect(response.status).toBe("405");
    expect(response.headers?.["allow"]?.[0]?.value).toBe("POST");
  });

  it("answers 400 to an event that is not a CloudFront request", async () => {
    expect((await handler({ Records: [] })).status).toBe("400");
    expect((await handler({ version: "2.0", rawPath: "/digest" })).status).toBe("400");
  });
});
