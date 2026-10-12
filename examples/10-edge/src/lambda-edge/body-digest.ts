import { createHash } from "node:crypto";

import type { CloudFrontResultResponse } from "aws-lambda";
import * as v from "valibot";

// #region event
// Only the fields this function reads. `body` is present because the trigger sets "include body".
const eventSchema = v.object({
  Records: v.pipe(
    v.array(
      v.object({
        cf: v.object({
          request: v.object({
            method: v.string(),
            body: v.optional(
              v.object({
                inputTruncated: v.boolean(),
                encoding: v.picklist(["base64", "text"]),
                data: v.string(),
              }),
            ),
          }),
        }),
      }),
    ),
    v.minLength(1),
  ),
});

type EdgeRequest = v.InferOutput<typeof eventSchema>["Records"][number]["cf"]["request"];
// #endregion event

const json = (status: number, description: string, body: unknown): CloudFrontResultResponse => ({
  status: String(status),
  statusDescription: description,
  headers: {
    "content-type": [{ key: "Content-Type", value: "application/json; charset=utf-8" }],
    "cache-control": [{ key: "Cache-Control", value: "no-store" }],
  },
  body: JSON.stringify(body),
});

// #region digest
/** Answers from the edge with the size and SHA-256 of the request body. The origin is never asked. */
export function digestResponse(request: EdgeRequest): CloudFrontResultResponse {
  if (request.method !== "POST") {
    const response = json(405, "Method Not Allowed", { error: "send a POST with a body" });
    return {
      ...response,
      headers: { ...response.headers, allow: [{ key: "Allow", value: "POST" }] },
    };
  }
  const body = Buffer.from(
    request.body?.data ?? "",
    request.body?.encoding === "text" ? "utf8" : "base64",
  );
  return json(200, "OK", {
    bytes: body.byteLength,
    sha256: createHash("sha256").update(body).digest("hex"),
    // CloudFront passes at most 1 MB of the body to an origin request function.
    truncated: request.body?.inputTruncated ?? false,
  });
}
// #endregion digest

export async function handler(event: unknown): Promise<CloudFrontResultResponse> {
  const parsed = v.safeParse(eventSchema, event);
  if (!parsed.success || parsed.output.Records[0] === undefined) {
    return json(400, "Bad Request", { error: "not a CloudFront request event" });
  }
  return digestResponse(parsed.output.Records[0].cf.request);
}
