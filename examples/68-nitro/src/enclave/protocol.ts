import * as v from "valibot";

// #region protocol
// Everything that crosses the vsock is JSON of one of these shapes. The enclave checks the
// request, the parent checks the answer: neither side trusts the other's bytes.
const id = v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{1,64}$/));
const base64 = v.pipe(v.string(), v.regex(/^[A-Za-z0-9+/]*={0,2}$/), v.maxLength(120_000));

// The parent reads the role's temporary credentials from IMDSv2 and passes them in. In the
// model the role's ARN stands for them.
const credentials = v.object({ roleArn: v.pipe(v.string(), v.minLength(1), v.maxLength(2048)) });

export const sealedSchema = v.object({
  wrappedKey: base64,
  iv: base64,
  ciphertext: base64,
  tag: base64,
});
export type Sealed = v.InferOutput<typeof sealedSchema>;

export const requestSchema = v.variant("op", [
  v.object({
    op: v.literal("seal"),
    credentials,
    owner: id,
    noteId: id,
    // 64 KiB of UTF-16 code units: a note, not a file.
    body: v.pipe(v.string(), v.maxLength(65_536)),
  }),
  v.object({ op: v.literal("open"), credentials, owner: id, noteId: id, sealed: sealedSchema }),
]);
export type EnclaveRequest = v.InferOutput<typeof requestSchema>;

export const responseSchema = v.variant("ok", [
  v.object({ ok: v.literal(true), sealed: sealedSchema }),
  v.object({ ok: v.literal(true), body: v.string() }),
  v.object({
    ok: v.literal(false),
    error: v.picklist(["bad-request", "key-refused", "not-authentic"]),
  }),
]);
export type EnclaveResponse = v.InferOutput<typeof responseSchema>;
// #endregion protocol
