import { describe, expect, it } from "vite-plus/test";
import { rotate, type RotationApi } from "../src/rotation.ts";
import { MemorySecretStore } from "../src/secret-source.ts";

const OVERLAP = 600_000;
const at = (ms: number) => new Date(ms);
const key = (n: number) => `key-${n}-${"x".repeat(40)}`;

/** The store behind the two calls, with a switch that loses the response to the next put. */
function fake(createdAt = at(0)) {
  const store = new MemorySecretStore({ versionId: "v1", key: key(1), createdAt });
  const state = { loseNextResponse: false, puts: 0, clock: createdAt };
  const api: RotationApi = {
    versions: async () =>
      store.versions.map((version) => ({
        versionId: version.versionId,
        stages: store.stageOf(version.versionId),
        createdAt: version.createdAt,
      })),
    put: async (versionId, value) => {
      state.puts += 1;
      store.put({ versionId, key: value, createdAt: state.clock });
      if (state.loseNextResponse) {
        state.loseNextResponse = false;
        throw new Error("socket hang up");
      }
    },
  };
  return { store, state, api };
}

describe("rotating the signing secret", () => {
  it("makes the new version current and keeps the old one as previous", async () => {
    const { api, store } = fake();
    const result = await rotate(api, { versionId: "v2", newKey: key(2), now: at(OVERLAP), overlapMs: OVERLAP });
    expect(result).toEqual({ status: "rotated", current: "v2", previous: "v1" });
    expect(store.stageOf("v1")).toEqual(["AWSPREVIOUS"]);
    expect(store.stageOf("v2")).toEqual(["AWSCURRENT"]);
  });

  it("is safe to run again after the response was lost", async () => {
    const { api, store, state } = fake();
    const input = { versionId: "v2", newKey: key(2), now: at(OVERLAP), overlapMs: OVERLAP };
    state.loseNextResponse = true;
    await expect(rotate(api, input)).rejects.toThrow("socket hang up");

    // The write happened. The retry must notice, not rotate a second time and push v1 out of AWSPREVIOUS.
    expect(await rotate(api, input)).toEqual({ status: "already-rotated", current: "v2", previous: "v1" });
    expect(state.puts).toBe(1);
    expect(store.versions).toHaveLength(2);
  });

  it("refuses a second rotation while tokens signed with the outgoing key can still be valid", async () => {
    const { api, state } = fake();
    state.clock = at(OVERLAP);
    await rotate(api, { versionId: "v2", newKey: key(2), now: at(OVERLAP), overlapMs: OVERLAP });

    const soon = await rotate(api, { versionId: "v3", newKey: key(3), now: at(OVERLAP + 60_000), overlapMs: OVERLAP });
    expect(soon).toEqual({ status: "too-soon", current: "v2", waitMs: OVERLAP - 60_000 });
    expect(state.puts).toBe(1);

    state.clock = at(2 * OVERLAP);
    const later = await rotate(api, { versionId: "v3", newKey: key(3), now: at(2 * OVERLAP), overlapMs: OVERLAP });
    expect(later).toMatchObject({ status: "rotated", current: "v3", previous: "v2" });
  });

  it("rotates at once when forced, for a key that has leaked", async () => {
    const { api } = fake();
    const result = await rotate(api, { versionId: "v2", newKey: key(2), now: at(1), overlapMs: OVERLAP, force: true });
    expect(result.status).toBe("rotated");
  });

  it("does not reuse a version id for a different value", async () => {
    const { api, store } = fake();
    store.put({ versionId: "v2", key: key(2), createdAt: at(0) });
    store.put({ versionId: "v3", key: key(3), createdAt: at(0) });
    await expect(
      rotate(api, { versionId: "v2", newKey: "another-value".repeat(4), now: at(OVERLAP), overlapMs: OVERLAP }),
    ).rejects.toMatchObject({ name: "ResourceExistsException" });
  });

  it("stops when the labels did not end up where a rotation puts them", async () => {
    const { api } = fake();
    const silent: RotationApi = { versions: api.versions, put: async () => {} };
    await expect(
      rotate(silent, { versionId: "v2", newKey: key(2), now: at(OVERLAP), overlapMs: OVERLAP }),
    ).rejects.toThrow("AWSCURRENT is v1");
  });
});
