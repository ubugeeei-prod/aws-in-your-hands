import { describe, expect, it } from "vite-plus/test";

import { type AckRule, crash, elect, newGroup, read, restart, write } from "../src/model/quorum.ts";
import { NODE_NAMES, type NodeName } from "../src/topology.ts";

// These tests run the model in src/model/quorum.ts, not a database. What the
// real cluster did when a node was killed is in scripts/verify.ts.

const followerSets: NodeName[][] = [[], ["b"], ["c"], ["b", "c"]];

/** Writes two entries, loses one node between them, elects, and reports what was acknowledged and what is left. */
function scenario(rule: AckRule, first: NodeName[], lost: NodeName, second: NodeName[]) {
  const group = newGroup();
  const acknowledged: string[] = [];
  if (write(group, "w1", rule, first) === "acknowledged") {
    acknowledged.push("w1");
  }
  crash(group, lost);
  elect(group);
  if (write(group, "w2", rule, second) === "acknowledged") {
    acknowledged.push("w2");
  }
  return { group, acknowledged, visible: read(group) };
}

describe("a write acknowledged only after a majority holds it (the model)", () => {
  it("survives the loss of any one node, whichever followers the write had reached", () => {
    for (const first of followerSets) {
      for (const lost of NODE_NAMES) {
        for (const second of followerSets) {
          const { acknowledged, visible } = scenario("majority", first, lost, second);
          const label = `reached ${first.join("") || "nobody"}, lost ${lost}`;
          expect(visible, label).not.toBe("unavailable");
          expect(visible, label).toEqual(expect.arrayContaining(acknowledged));
        }
      }
    }
  });

  it("is not acknowledged while only the leader holds it", () => {
    const group = newGroup();
    expect(write(group, "w1", "majority", [])).toBe("not acknowledged");
    expect(write(group, "w2", "majority", ["b"])).toBe("acknowledged");
  });

  it("stops answering with two nodes lost, instead of answering wrongly", () => {
    const group = newGroup();
    expect(write(group, "w1", "majority", ["b", "c"])).toBe("acknowledged");
    crash(group, "a");
    crash(group, "b");
    expect(elect(group)).toBeUndefined();
    expect(read(group)).toBe("unavailable");
    expect(write(group, "w2", "majority", [])).toBe("not acknowledged");
    restart(group, "b");
    elect(group);
    expect(read(group)).toEqual(["w1"]);
  });

  it("may keep or drop a write that was never acknowledged", () => {
    // The leader wrote it and died. Whether it exists afterwards depends on who is elected.
    const kept = newGroup();
    write(kept, "w1", "majority", []);
    crash(kept, "b");
    crash(kept, "c");
    restart(kept, "b");
    elect(kept);
    expect(read(kept)).toEqual(["w1"]);

    const dropped = newGroup();
    write(dropped, "w1", "majority", []);
    crash(dropped, "a");
    elect(dropped);
    expect(read(dropped)).toEqual([]);
  });

  it("does not bring back a deposed leader's unacknowledged write over a later acknowledged one", () => {
    const group = newGroup();
    write(group, "stale", "majority", []);
    crash(group, "a");
    elect(group);
    expect(write(group, "w2", "majority", ["b", "c"])).toBe("acknowledged");
    crash(group, "c");
    crash(group, "b");
    restart(group, "a");
    restart(group, "b");
    elect(group);
    // a's log is as long as b's, but b's last entry is from a later term.
    expect(read(group)).toEqual(["w2"]);
  });
});

describe("a write acknowledged as soon as the leader holds it (asynchronous replication, the model)", () => {
  it("shows a write, acknowledges it, and then loses it with the leader", () => {
    const group = newGroup();
    expect(write(group, "w1", "leader-only", [])).toBe("acknowledged");
    expect(read(group)).toEqual(["w1"]);
    crash(group, "a");
    elect(group);
    expect(read(group)).toEqual([]);
  });
});
