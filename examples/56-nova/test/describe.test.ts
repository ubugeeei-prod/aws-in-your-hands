import { describe, expect, it } from "vite-plus/test";

import { MAX_UPLOAD_BYTES } from "@aih/example-07-uploads/api/src/contract.ts";

import { ensureDescription, forgetDescription, readDescription } from "../src/describe.ts";
import { scripts } from "../src/fixtures.ts";
import { mediaKeys } from "../src/media.ts";
import { ALICE, settle, setup } from "./helpers.ts";

const KEYS = mediaKeys(ALICE);

describe("one description per attachment", () => {
  it("calls the model once and reuses what it stored", async () => {
    const { deps, model, media } = setup(scripts.described);

    const first = await ensureDescription(deps, ALICE);
    const second = await ensureDescription(deps, ALICE);

    expect(first).toMatchObject({
      status: "ready",
      billed: { inputTokens: 318, outputTokens: 27 },
      description: { outcome: "described", modelId: "jp.amazon.nova-2-lite-v1:0" },
    });
    // The second call paid nothing and got the same document.
    expect(second).toMatchObject({ status: "ready", billed: null });
    expect(second.status === "ready" && second.description).toEqual(
      first.status === "ready" && first.description,
    );
    expect(model.requests).toHaveLength(1);
    expect(media.keys()).toEqual([KEYS.description, KEYS.source]);
  });

  it("makes the second of two simultaneous requests wait instead of paying twice", async () => {
    const { deps, model, media, answer } = setup(scripts.described, { hold: true });

    const first = ensureDescription(deps, ALICE);
    await settle();
    const second = await ensureDescription(deps, ALICE);

    expect(second).toEqual({ status: "in_progress", retryAfterSeconds: 2 });
    expect(await readDescription(deps, ALICE)).toMatchObject({ status: "in_progress" });
    await answer();
    expect(await first).toMatchObject({ status: "ready" });
    expect(model.requests).toHaveLength(1);
    // The claim is gone, and one description is left.
    expect(media.keys()).toEqual([KEYS.description, KEYS.source]);
  });

  it("stores one description when a runner outlives its lease and both finish", async () => {
    const { deps, model, media, answer, advance } = setup(scripts.described, { hold: true });

    const slow = ensureDescription(deps, ALICE);
    await settle();
    // The lease runs out while the first call is still waiting for the model.
    advance(61_000);
    const second = ensureDescription(deps, ALICE);
    await settle();
    expect(model.requests).toHaveLength(2);

    // The slow one finishes first. Its lease is over, so the claim is no longer its to remove.
    await answer();
    const slowResult = await slow;
    expect(media.keys("c/")).toEqual([KEYS.claim]);
    await answer();
    const secondResult = await second;

    // Both were billed. One answer was stored, and both callers got that one.
    expect(slowResult).toMatchObject({ status: "ready", billed: { outputTokens: 27 } });
    expect(secondResult).toMatchObject({ status: "ready", billed: { outputTokens: 27 } });
    expect(secondResult.status === "ready" && secondResult.description).toEqual(
      slowResult.status === "ready" && slowResult.description,
    );
    expect(media.keys()).toEqual([KEYS.description, KEYS.source]);
  });

  it("takes over a claim whose runner died, but not before the lease is over", async () => {
    const { deps, model, media, advance } = setup(scripts.described);
    // A runner wrote its claim and was never heard from again.
    await media.putIfAbsent(
      KEYS.claim,
      JSON.stringify({ claimId: "dead", expiresAt: "2026-10-13T00:01:00.000Z" }),
    );

    expect(await ensureDescription(deps, ALICE)).toEqual({
      status: "in_progress",
      retryAfterSeconds: 2,
    });
    expect(model.requests).toHaveLength(0);

    advance(60_001);
    expect(await readDescription(deps, ALICE)).toEqual({ status: "missing" });
    expect(await ensureDescription(deps, ALICE)).toMatchObject({ status: "ready" });
    expect(model.requests).toHaveLength(1);
    expect(media.keys("c/")).toEqual([]);
  });

  it("gives the claim back when the model fails, so the next request can run", async () => {
    const { deps, model, media } = setup(scripts["throttled-then-described"]);

    expect(await ensureDescription(deps, ALICE)).toEqual({
      status: "failed",
      failure: { code: "throttled", retryable: true },
      billed: null,
    });
    expect(media.keys("c/")).toEqual([]);
    expect(await ensureDescription(deps, ALICE)).toMatchObject({ status: "ready" });
    expect(model.requests).toHaveLength(2);
  });

  it("reports a deadline as a timeout the caller may retry, and gives the claim back", async () => {
    const { deps, media, answer, expire } = setup(scripts.described, { hold: true });

    const running = ensureDescription(deps, ALICE);
    await settle();
    expire();
    // The scripted model, like the SDK, fails once its signal is aborted.
    await answer();

    expect(await running).toEqual({
      status: "failed",
      failure: { code: "timeout", retryable: true },
      billed: null,
    });
    expect(media.keys()).toEqual([KEYS.source]);
  });
});

describe("what is stored", () => {
  it("keeps a refusal, so an image the model declines is not paid for again", async () => {
    const { deps, model } = setup(scripts.refused);

    const first = await ensureDescription(deps, ALICE);
    const second = await ensureDescription(deps, ALICE);

    expect(first).toMatchObject({ status: "ready", description: { outcome: "refused" } });
    expect(first.status === "ready" && "text" in first.description).toBe(false);
    expect(second).toMatchObject({ status: "ready", billed: null });
    expect(model.requests).toHaveLength(1);
  });

  it("does not store an answer that was cut off, and says the call was billed", async () => {
    const { deps, media } = setup(scripts["max-tokens"]);

    expect(await ensureDescription(deps, ALICE)).toEqual({
      status: "failed",
      failure: { code: "bad_output", retryable: false },
      billed: { inputTokens: 318, outputTokens: 300 },
    });
    expect(media.keys()).toEqual([KEYS.source]);
  });

  it.each([
    ["no text at all", { output: { message: { role: "assistant", content: [] } } }],
    ["not a Converse response", { completion: "a desk" }],
    ["longer than alternative text", { text: "あ".repeat(1001) }],
  ])("does not store an answer that is %s", async (_name, shape) => {
    const response =
      "text" in shape
        ? {
            output: { message: { role: "assistant", content: [{ text: shape.text }] } },
            stopReason: "end_turn",
            usage: { inputTokens: 1, outputTokens: 1 },
          }
        : "output" in shape
          ? { ...shape, stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 0 } }
          : shape;
    const { deps, media } = setup({ source: "test", description: "test", steps: [{ response }] });

    expect(await ensureDescription(deps, ALICE)).toMatchObject({
      status: "failed",
      failure: { code: "bad_output" },
    });
    expect(media.keys()).toEqual([KEYS.source]);
  });

  it("records which bytes, which model and which prompt produced the text", async () => {
    const { deps, media } = setup(scripts.described);
    await ensureDescription(deps, ALICE);

    const stored = JSON.parse((await media.getText(KEYS.description))?.text ?? "{}");
    expect(stored).toMatchObject({
      version: 1,
      modelId: "jp.amazon.nova-2-lite-v1:0",
      promptVersion: 1,
      source: { key: "u/alice/note-1/image-1", eTag: '"etag-1"' },
      usage: { inputTokens: 318, outputTokens: 27 },
      createdAt: "2026-10-13T00:00:00.000Z",
    });
  });

  it("forgets the description and leaves the upload alone", async () => {
    const { deps, media, model } = setup(scripts.described);
    await ensureDescription(deps, ALICE);

    await forgetDescription(deps, ALICE);

    expect(media.keys()).toEqual([KEYS.source]);
    expect(await readDescription(deps, ALICE)).toEqual({ status: "missing" });
    // Asking again is a new, billed call.
    await ensureDescription(deps, ALICE);
    expect(model.requests).toHaveLength(2);
  });
});

describe("what the model is allowed to see", () => {
  it("names the caller's own upload by S3 URI, and nothing else", async () => {
    const { deps, model } = setup(scripts.described);
    await ensureDescription(deps, ALICE);

    expect(model.requests[0]?.messages[0]?.content[0]).toEqual({
      image: {
        format: "png",
        source: { s3Location: { uri: "s3://media-bucket/u/alice/note-1/image-1" } },
      },
    });
  });

  it("finds nothing for another owner, and never calls the model", async () => {
    const { deps, model, media } = setup(scripts.described);

    // Bob knows Alice's note and attachment IDs. The owner part of the key is still his.
    const outcome = await ensureDescription(deps, { ...ALICE, owner: "bob" });

    expect(outcome).toEqual({ status: "missing" });
    expect(model.requests).toHaveLength(0);
    expect(media.keys()).toEqual([KEYS.source]);
  });

  it("does not let Bob read what was generated for Alice", async () => {
    const { deps } = setup(scripts.described);
    await ensureDescription(deps, ALICE);

    expect(await readDescription(deps, { ...ALICE, owner: "bob" })).toEqual({ status: "missing" });
  });

  it.each(["../alice", "a/b", "", "note 1", "x".repeat(65)])(
    "refuses %j as a part of a key",
    (hostile) => {
      expect(() => mediaKeys({ ...ALICE, noteId: hostile })).toThrow(/object key/);
      expect(() => mediaKeys({ ...ALICE, owner: hostile })).toThrow(/object key/);
    },
  );

  it.each([
    ["a type Converse does not take", "image/svg+xml", 100, "type"],
    ["more bytes than chapter 07 lets in", "image/png", MAX_UPLOAD_BYTES + 1, "size"],
  ])("refuses %s before claiming or calling", async (_name, contentType, size, reason) => {
    const { deps, model, media } = setup(scripts.described);
    media.seed(KEYS.source, new Uint8Array(size), contentType);

    expect(await ensureDescription(deps, ALICE)).toEqual({ status: "unsupported", reason });
    expect(model.requests).toHaveLength(0);
    expect(media.keys()).toEqual([KEYS.source]);
  });
});
