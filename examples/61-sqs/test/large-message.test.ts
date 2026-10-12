import { describe, expect, it } from "vite-plus/test";

import { type BlobStore, MAX_MESSAGE_BYTES, pack, unpack } from "../src/large-message.ts";

function memoryStore() {
  const objects = new Map<string, string>();
  const store: BlobStore = {
    put: async (key, body) => void objects.set(key, body),
    get: async (key) => objects.get(key),
  };
  return { store, objects };
}

describe("a body over the message size limit", () => {
  it("leaves a body within the limit alone", async () => {
    const { store, objects } = memoryStore();
    const body = "x".repeat(MAX_MESSAGE_BYTES);
    expect(await pack(body, "payloads/1", store)).toEqual({ body, stored: false });
    expect(objects.size).toBe(0);
  });

  it("counts bytes, not characters", async () => {
    const { store } = memoryStore();
    // 400,000 characters of three bytes each.
    const packed = await pack("あ".repeat(400_000), "payloads/1", store);
    expect(packed.stored).toBe(true);
  });

  it("stores a larger body and sends where it is, and the consumer gets the body back", async () => {
    const { store, objects } = memoryStore();
    const body = "x".repeat(MAX_MESSAGE_BYTES + 1);
    const packed = await pack(body, "payloads/1", store);

    expect(packed.stored).toBe(true);
    expect(packed.body.length).toBeLessThan(200);
    expect(objects.get("payloads/1")).toBe(body);
    expect(await unpack(packed, store)).toBe(body);
  });

  it("fails, and so leaves the message in the queue, when the object is gone", async () => {
    const { store, objects } = memoryStore();
    const packed = await pack("x".repeat(20), "payloads/1", store, 10);
    objects.clear();
    await expect(unpack(packed, store)).rejects.toThrow("is gone");
  });

  it("fails when the object is not the one that was sent", async () => {
    const { store, objects } = memoryStore();
    const packed = await pack("x".repeat(20), "payloads/1", store, 10);
    objects.set("payloads/1", "y".repeat(20));
    await expect(unpack(packed, store)).rejects.toThrow("not the one");
  });
});
