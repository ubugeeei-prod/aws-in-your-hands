import { describe, expect, it } from "vite-plus/test";
import { savePending, type TabStorage, takePending } from "./pending.ts";

function fakeStorage(): TabStorage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const pending = { state: "state-1", codeVerifier: "v".repeat(43), createdAt: 1_000 };

describe("pending sign-in", () => {
  it("returns the verifier for a matching state", () => {
    const storage = fakeStorage();
    savePending(storage, pending);
    expect(takePending(storage, "state-1", 2_000)).toEqual(pending);
  });

  it("refuses a state this tab did not send", () => {
    // A forged callback link carries the state of the attacker's sign-in.
    const storage = fakeStorage();
    savePending(storage, pending);
    expect(takePending(storage, "attacker-state", 2_000)).toBeUndefined();
  });

  it("can be taken only once", () => {
    const storage = fakeStorage();
    savePending(storage, pending);
    takePending(storage, "state-1", 2_000);
    expect(takePending(storage, "state-1", 2_000)).toBeUndefined();
  });

  it("forgets it even on a mismatch", () => {
    const storage = fakeStorage();
    savePending(storage, pending);
    takePending(storage, "attacker-state", 2_000);
    expect(takePending(storage, "state-1", 2_000)).toBeUndefined();
  });

  it("refuses after ten minutes", () => {
    const storage = fakeStorage();
    savePending(storage, pending);
    expect(takePending(storage, "state-1", 1_000 + 11 * 60 * 1000)).toBeUndefined();
  });

  it("refuses when nothing valid is stored", () => {
    expect(takePending(fakeStorage(), "state-1", 2_000)).toBeUndefined();
    const storage = fakeStorage();
    storage.setItem("aih.auth.pending", "{not json");
    expect(takePending(storage, "state-1", 2_000)).toBeUndefined();
  });
});
