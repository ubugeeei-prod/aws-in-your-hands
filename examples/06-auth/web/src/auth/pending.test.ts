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
  it("returns the verifier when the redirect carries the state this tab sent", () => {
    const storage = fakeStorage();
    savePending(storage, pending);
    expect(takePending(storage, "state-1", 2_000)).toEqual(pending);
  });

  it("refuses a redirect with a state this tab did not send", () => {
    // What a forged callback link looks like: a valid-looking code, and a
    // state that belongs to the attacker's sign-in, not to this tab.
    const storage = fakeStorage();
    savePending(storage, pending);
    expect(takePending(storage, "attacker-state", 2_000)).toBeUndefined();
  });

  it("can be taken once, so replaying the callback URL does nothing", () => {
    const storage = fakeStorage();
    savePending(storage, pending);
    takePending(storage, "state-1", 2_000);
    expect(takePending(storage, "state-1", 2_000)).toBeUndefined();
  });

  it("forgets the pending sign-in even when the state does not match", () => {
    const storage = fakeStorage();
    savePending(storage, pending);
    takePending(storage, "attacker-state", 2_000);
    expect(takePending(storage, "state-1", 2_000)).toBeUndefined();
  });

  it("refuses a sign-in that was started more than ten minutes ago", () => {
    const storage = fakeStorage();
    savePending(storage, pending);
    expect(takePending(storage, "state-1", 1_000 + 11 * 60 * 1000)).toBeUndefined();
  });

  it("refuses a callback when nothing is pending or the stored value is not valid", () => {
    expect(takePending(fakeStorage(), "state-1", 2_000)).toBeUndefined();
    const storage = fakeStorage();
    storage.setItem("aih.auth.pending", "{not json");
    expect(takePending(storage, "state-1", 2_000)).toBeUndefined();
  });
});
