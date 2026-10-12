import { describe, expect, it } from "vite-plus/test";

import { BucketModel, Replication } from "../src/bucket-replication.ts";
import { GlobalTableModel } from "../src/global-table.ts";
import { PRIMARY_REGION as TOKYO, REGIONS, STANDBY_REGION as OSAKA } from "../src/regions.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const KEY = "u/alice/n1/a1";
const LAG = 5000;

function pair(rule: { deleteMarkers?: boolean } = {}) {
  const tokyo = new BucketModel("tokyo");
  const osaka = new BucketModel("osaka");
  const replication = new Replication(tokyo, osaka, {
    deleteMarkers: rule.deleteMarkers ?? false,
    lagMs: LAG,
  });
  return { tokyo, osaka, replication };
}

describe("replication from Tokyo to Osaka", () => {
  it("copies a new object with its version ID, after the lag", () => {
    const { tokyo, osaka, replication } = pair();
    const uploaded = tokyo.put(KEY, PNG);
    expect(uploaded.replicationStatus).toBe("PENDING");
    expect(osaka.current(KEY)).toBeUndefined();

    replication.advance(LAG);
    expect(osaka.current(KEY)).toEqual(PNG);
    expect(osaka.versions(KEY)).toEqual([
      { key: KEY, versionId: uploaded.versionId, body: PNG, replicationStatus: "REPLICA" },
    ]);
    expect(uploaded.replicationStatus).toBe("COMPLETED");
  });

  it("leaves behind what was uploaded before the rule existed", () => {
    const tokyo = new BucketModel("tokyo");
    const osaka = new BucketModel("osaka");
    tokyo.put(KEY, PNG);

    const replication = new Replication(tokyo, osaka, { deleteMarkers: false, lagMs: LAG });
    tokyo.put("u/alice/n1/a2", PNG);
    replication.advance(LAG);

    expect(osaka.current(KEY)).toBeUndefined();
    expect(osaka.current("u/alice/n1/a2")).toEqual(PNG);
  });

  // #region delete-marker
  it("keeps an image in Osaka that was deleted in Tokyo", () => {
    const { tokyo, osaka, replication } = pair();
    tokyo.put(KEY, PNG);
    replication.advance(LAG);

    tokyo.delete(KEY);
    replication.advance(LAG);

    // The default protects the copy from a mistaken delete. It also means that
    // after a failover, a user sees an image they had removed.
    expect(tokyo.current(KEY)).toBeUndefined();
    expect(osaka.current(KEY)).toEqual(PNG);
  });

  it("carries the delete along when delete marker replication is on, mistakes included", () => {
    const { tokyo, osaka, replication } = pair({ deleteMarkers: true });
    tokyo.put(KEY, PNG);
    tokyo.delete(KEY);
    replication.advance(LAG);

    expect(osaka.current(KEY)).toBeUndefined();
    // Still a marker, not an erasure: chapter 22's restore works in Osaka too.
    expect(osaka.versions(KEY).map((version) => version.body !== undefined)).toEqual([true, false]);
  });
  // #endregion delete-marker

  it("never forwards a delete that names a version", () => {
    const { tokyo, osaka, replication } = pair({ deleteMarkers: true });
    const uploaded = tokyo.put(KEY, PNG);
    replication.advance(LAG);

    tokyo.deleteVersion(KEY, uploaded.versionId);
    replication.advance(LAG);

    expect(tokyo.versions(KEY)).toEqual([]);
    expect(osaka.current(KEY)).toEqual(PNG);
  });

  it("holds uploads while the Regions cannot talk, and delivers them afterwards", () => {
    const { tokyo, osaka, replication } = pair();
    replication.pause();
    const uploaded = tokyo.put(KEY, PNG);
    replication.advance(3_600_000);

    expect(uploaded.replicationStatus).toBe("PENDING");
    expect(replication.pending).toBe(1);
    expect(osaka.current(KEY)).toBeUndefined();

    replication.resume();
    expect(osaka.current(KEY)).toEqual(PNG);
  });
});

describe("two-way replication", () => {
  it("copies in both directions without sending a replica back", () => {
    const tokyo = new BucketModel("tokyo");
    const osaka = new BucketModel("osaka");
    const out = new Replication(tokyo, osaka, { deleteMarkers: false, lagMs: LAG });
    const back = new Replication(osaka, tokyo, { deleteMarkers: false, lagMs: LAG });

    tokyo.put(KEY, PNG);
    osaka.put("u/alice/n1/after-failover", PNG);
    for (let round = 0; round < 3; round++) {
      out.advance(LAG);
      back.advance(LAG);
    }

    expect(tokyo.current("u/alice/n1/after-failover")).toEqual(PNG);
    expect(osaka.current(KEY)).toEqual(PNG);
    // One version of each on each side: a replica is not replicated again.
    expect(tokyo.versions(KEY)).toHaveLength(1);
    expect(osaka.versions(KEY)).toHaveLength(1);
    expect(out.pending + back.pending).toBe(0);
  });
});

describe("the table and the bucket replicate at different speeds", () => {
  // #region skew
  it("leaves Osaka with an attachment record whose image has not arrived", () => {
    const table = new GlobalTableModel({ mode: "eventual", replicas: REGIONS, lagMs: 1000 });
    const { tokyo, osaka, replication } = pair();

    // Chapter 07's order: the bytes first, then the record that points at them.
    tokyo.put(KEY, PNG);
    table.replica(TOKYO).put(`OWNER#alice|ATTACHMENT#${KEY}`, { key: KEY, size: PNG.byteLength });

    // Two seconds later Tokyo stops answering. The record took one second, the image needs five.
    table.advance(2000);
    replication.advance(2000);
    table.isolate(TOKYO);
    replication.pause();

    expect(table.replica(OSAKA).get(`OWNER#alice|ATTACHMENT#${KEY}`)).toEqual({
      key: KEY,
      size: 4,
    });
    expect(osaka.current(KEY)).toBeUndefined();
  });
  // #endregion skew
});
