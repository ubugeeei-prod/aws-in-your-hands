import * as v from "valibot";

import { utcTimestamp } from "@aih/example-04-http-api/src/timestamp.ts";
import { MAX_UPLOAD_BYTES } from "@aih/example-07-uploads/api/src/contract.ts";
import type { KeyParts } from "@aih/example-07-uploads/api/src/keys.ts";
import type { Failure } from "@aih/example-17-ai/src/contract.ts";
import { converseResponseSchema } from "@aih/example-17-ai/src/converse-stream.ts";
import { classifyError } from "@aih/example-17-ai/src/failure.ts";

import type { Usage } from "./cost.ts";
import { buildDescribeRequest, type Language, PROMPT_VERSION } from "./image.ts";
import { type Media, mediaKeys } from "./media.ts";
import type { ModelGateway } from "./model.ts";

// #region document
/** How soon a waiting caller should ask again. A description takes seconds, not the whole lease. */
export const POLL_SECONDS = 2;

/** Alternative text longer than this is not alternative text. */
export const MAX_DESCRIPTION_CHARS = 1_000;

const count = v.pipe(v.number(), v.safeInteger(), v.minValue(0));

// Where the text came from. A model's output carries no mark of its own, so the app keeps one.
const provenance = {
  version: v.literal(1),
  modelId: v.pipe(v.string(), v.minLength(1)),
  promptVersion: count,
  /** The bytes that were described: the upload's key and its ETag at the time. */
  source: v.object({ key: v.string(), eTag: v.string() }),
  usage: v.object({ inputTokens: count, outputTokens: count }),
  createdAt: utcTimestamp,
};

export const descriptionSchema = v.variant("outcome", [
  v.object({
    outcome: v.literal("described"),
    text: v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_DESCRIPTION_CHARS)),
    ...provenance,
  }),
  // The model declined. Stored like a description, so the same image is not paid for again.
  v.object({ outcome: v.literal("refused"), ...provenance }),
]);
export type Description = v.InferOutput<typeof descriptionSchema>;

const claimSchema = v.object({
  claimId: v.pipe(v.string(), v.minLength(1)),
  expiresAt: utcTimestamp,
});
// #endregion document

export type DescribeDeps = {
  media: Media;
  model: ModelGateway;
  modelId: string;
  maxOutputTokens: number;
  language: Language;
  /** How long one runner may hold a claim. Longer than `timeoutMs`, or two runners overlap. */
  leaseMs: number;
  timeoutMs: number;
  /** `s3://bucket/key` for the model to read, and the account that owns the bucket. */
  locate: (key: string) => { uri: string; bucketOwner?: string };
  now: () => Date;
  newClaimId: () => string;
  /** `AbortSignal.timeout` in production. */
  timeoutSignal: (ms: number) => AbortSignal;
};

export type Outcome =
  /** `billed` is what this call paid the model for: null when it did not call it. */
  | { status: "ready"; description: Description; billed: Usage | null }
  | { status: "in_progress"; retryAfterSeconds: number }
  /** Nothing is stored under this owner's key for the attachment. */
  | { status: "missing" }
  | { status: "unsupported"; reason: "type" | "size" }
  | { status: "failed"; failure: Failure; billed: Usage | null };

async function stored(media: Media, key: string): Promise<Description | undefined> {
  const object = await media.getText(key);
  return object === undefined ? undefined : v.parse(descriptionSchema, JSON.parse(object.text));
}

// #region read
/** What is known without calling the model: the stored description, or that one is on its way. */
export async function readDescription(
  deps: Pick<DescribeDeps, "media" | "now">,
  parts: KeyParts,
): Promise<Outcome> {
  const keys = mediaKeys(parts);
  const description = await stored(deps.media, keys.description);
  if (description !== undefined) {
    return { status: "ready", description, billed: null };
  }
  const claim = await deps.media.getText(keys.claim);
  if (claim !== undefined) {
    const left = Date.parse(v.parse(claimSchema, JSON.parse(claim.text)).expiresAt) - +deps.now();
    if (left > 0) {
      return { status: "in_progress", retryAfterSeconds: POLL_SECONDS };
    }
  }
  return { status: "missing" };
}
// #endregion read

// #region check
/**
 * Makes sure one description is stored for the attachment. Safe to call any number of
 * times, together or apart: one description is under the key afterwards, whoever wrote it.
 */
export async function ensureDescription(deps: DescribeDeps, parts: KeyParts): Promise<Outcome> {
  const keys = mediaKeys(parts);

  // 1. Already described? Then nobody pays again.
  const existing = await stored(deps.media, keys.description);
  if (existing !== undefined) {
    return { status: "ready", description: existing, billed: null };
  }

  // 2. The upload itself, as chapter 07 left it under the owner's prefix.
  const source = await deps.media.head(keys.source);
  if (source === undefined) {
    return { status: "missing" };
  }
  if (source.size > MAX_UPLOAD_BYTES) {
    return { status: "unsupported", reason: "size" };
  }
  const built = buildDescribeRequest(
    [
      {
        contentType: source.contentType,
        size: source.size,
        source: { s3Location: deps.locate(keys.source) },
      },
    ],
    deps,
  );
  if (!built.ok) {
    return { status: "unsupported", reason: built.reason === "type" ? "type" : "size" };
  }

  // #endregion check

  // #region claim
  // 3. Claim the work, so that a second request waits instead of calling the model too.
  const expiresAt = +deps.now() + deps.leaseMs;
  const claim = JSON.stringify({
    claimId: deps.newClaimId(),
    expiresAt: new Date(expiresAt).toISOString(),
  });
  if ((await deps.media.putIfAbsent(keys.claim, claim)) === "exists") {
    const held = await deps.media.getText(keys.claim);
    const live =
      held !== undefined &&
      Date.parse(v.parse(claimSchema, JSON.parse(held.text)).expiresAt) > +deps.now();
    // A live claim, or one that vanished or was taken over while we looked: somebody is on it.
    if (
      held === undefined ||
      live ||
      (await deps.media.replaceIfMatch(keys.claim, held.eTag, claim)) === "changed"
    ) {
      return { status: "in_progress", retryAfterSeconds: POLL_SECONDS };
    }
  }
  // Only while the lease lasts is the claim certainly ours to remove.
  const release = async (): Promise<void> => {
    if (+deps.now() < expiresAt) {
      await deps.media.delete(keys.claim);
    }
  };

  // #endregion claim

  // #region call
  // 4. The model. Nothing is stored yet: stopping here loses a claim that expires by itself.
  const deadline = deps.timeoutSignal(deps.timeoutMs);
  let raw: unknown;
  try {
    raw = await deps.model.converse(built.request, deadline);
  } catch (error) {
    await release();
    const failure: Failure = deadline.aborted
      ? { code: "timeout", retryable: true }
      : (classifyError(error) ?? { code: "internal", retryable: false });
    return { status: "failed", failure, billed: null };
  }
  const answer = v.safeParse(converseResponseSchema, raw);
  if (!answer.success) {
    await release();
    return { status: "failed", failure: { code: "bad_output", retryable: false }, billed: null };
  }
  const { stopReason, usage } = answer.output;
  const billed = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
  const text = answer.output.output.message.content
    .map((block) => block.text ?? "")
    .join("")
    .trim();
  const refused = stopReason === "content_filtered";
  // Anything but a finished answer of a sane length is not stored: a cut-off sentence
  // kept under this key would be served as the description from then on.
  if (
    !refused &&
    (stopReason !== "end_turn" || text === "" || text.length > MAX_DESCRIPTION_CHARS)
  ) {
    await release();
    return { status: "failed", failure: { code: "bad_output", retryable: false }, billed };
  }
  const description: Description = {
    ...(refused ? { outcome: "refused" } : { outcome: "described", text }),
    version: 1,
    modelId: deps.modelId,
    promptVersion: PROMPT_VERSION,
    source: { key: keys.source, eTag: source.eTag },
    usage: billed,
    createdAt: deps.now().toISOString(),
  };

  // #endregion call

  // #region store
  // 5. Store, on the condition that nothing is there. A runner that outlived its lease
  //    finds the other runner's description here, and hands that one back.
  const written = await deps.media.putIfAbsent(keys.description, JSON.stringify(description));
  await release();
  if (written === "created") {
    return { status: "ready", description, billed };
  }
  // This call paid too, but its answer is thrown away: the stored one is the description.
  const winner = await stored(deps.media, keys.description);
  return winner === undefined
    ? // Stored and already deleted again. The next request starts over.
      { status: "failed", failure: { code: "interrupted", retryable: true }, billed }
    : { status: "ready", description: winner, billed };
  // #endregion store
}

/** Removes what the model wrote. The upload is chapter 07's to delete. */
export async function forgetDescription(
  deps: Pick<DescribeDeps, "media">,
  parts: KeyParts,
): Promise<void> {
  await deps.media.delete(mediaKeys(parts).description);
}
