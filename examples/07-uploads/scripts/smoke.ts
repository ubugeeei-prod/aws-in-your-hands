// vp run uploads:smoke:api
//   node scripts/smoke.ts [--url https://xxxx.execute-api.ap-northeast-1.amazonaws.com]
//
// Without AIH_ACCESS_TOKEN it checks only that the routes turn strangers away.
// With one, it uploads a tiny PNG to the real bucket, tries three uploads
// S3 should refuse, and deletes what it created. The token is never printed.

import { parseArgs } from "node:util";

import { ApiError, createNotesClient } from "@aih/example-06-auth/api/src/client.ts";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { createAttachmentsClient, sendUpload, UploadError } from "../api/src/client.ts";
import { MAX_UPLOAD_BYTES, type UploadPermit } from "../api/src/contract.ts";

const STACK = "AihUploads";
const { values } = parseArgs({ options: { url: { type: "string" } } });
const token = process.env["AIH_ACCESS_TOKEN"];

// A 1x1 PNG. S3 does not look inside the bytes either way.
const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const png = (bytes: Uint8Array) => new Blob([new Uint8Array(bytes)], { type: "image/png" });

const expectRejected = async (label: string, call: Promise<unknown>): Promise<void> => {
  const error = await call.catch((caught: unknown) => caught);
  if (!(error instanceof ApiError) || (error.status !== 401 && error.status !== 403)) {
    throw new Error(`${label}: expected 401 or 403`);
  }
  console.log(`ok   ${label} is turned away with ${error.status}`);
};

const expectRefusedByS3 = async (label: string, call: Promise<unknown>): Promise<void> => {
  const error = await call.catch((caught: unknown) => caught);
  if (!(error instanceof UploadError)) {
    throw new Error(`${label}: S3 accepted an upload it should have refused`);
  }
  console.log(`ok   S3 refuses ${label} with ${error.status}`);
};

try {
  let url = values.url;
  if (url === undefined) {
    const { target } = await preflight({
      access: token === undefined ? "observe" : "mutate",
      action: "smoke test the deployed uploads API",
      stack: STACK,
    });
    url = requireOutput(await readStackOutputs(process.cwd(), STACK, target.region), "ApiUrl");
  }
  console.log(`api: ${url}`);

  const anonymous = createAttachmentsClient(url, () => undefined);
  await expectRejected(
    "a permit request without a token",
    anonymous.requestUpload("x", { contentType: "image/png" }),
  );
  await expectRejected("a list without a token", anonymous.list("x"));

  if (token === undefined) {
    console.log("AIH_ACCESS_TOKEN is not set: the upload path was NOT checked.");
  } else {
    const notes = createNotesClient(url, () => token);
    const attachments = createAttachmentsClient(url, () => token);
    const note = await notes.create({
      title: `upload smoke ${new Date().toISOString()}`,
      body: "",
    });
    try {
      const tampered = (permit: UploadPermit, change: Record<string, string>): UploadPermit => ({
        ...permit,
        upload: { ...permit.upload, fields: { ...permit.upload.fields, ...change } },
      });
      const refused = await attachments.requestUpload(note.id, { contentType: "image/png" });
      await expectRefusedByS3(
        "a file over the size limit",
        sendUpload(refused, png(new Uint8Array(MAX_UPLOAD_BYTES + 1))),
      );
      await expectRefusedByS3(
        "another Content-Type",
        sendUpload(tampered(refused, { "Content-Type": "text/html" }), png(pixel)),
      );
      await expectRefusedByS3(
        "another key",
        sendUpload(tampered(refused, { key: `${refused.upload.fields["key"]}-other` }), png(pixel)),
      );

      const attachment = await attachments.attach(note.id, png(pixel), "image/png");
      console.log(`ok   uploaded and attached ${attachment.id} (${attachment.size} bytes)`);

      const [listed] = await attachments.list(note.id);
      if (listed === undefined) {
        throw new Error("the attachment is missing from the list");
      }
      // No Authorization header: the URL alone must be enough, and must return the bytes.
      const image = await fetch(listed.url);
      const body = new Uint8Array(await image.arrayBuffer());
      if (
        !image.ok ||
        image.headers.get("content-type") !== "image/png" ||
        body.byteLength !== pixel.byteLength
      ) {
        throw new Error(`the view URL answered ${image.status} with ${body.byteLength} bytes`);
      }
      console.log("ok   the view URL returns the image without a token");

      await attachments.remove(note.id, attachment.id);
      const gone = await fetch(listed.url);
      console.log(`ok   removed; the old view URL now answers ${gone.status}`);
    } finally {
      await notes.remove(note.id);
    }
  }
  console.log(`checked at ${new Date().toISOString()}`);
} catch (error) {
  console.error(
    "FAIL",
    error instanceof ApiError
      ? `${error.status} ${error.code} (request ${error.requestId})`
      : error,
  );
  process.exit(1);
}
