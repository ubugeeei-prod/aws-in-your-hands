import { describe, expect, it } from "vite-plus/test";

import { parentsFirst } from "../src/shard-order.ts";

const ids = (shards: { shardId: string }[]) => shards.map((shard) => shard.shardId);

describe("parentsFirst", () => {
  it("puts a split's parent before both children, however they were listed", () => {
    expect(
      ids(
        parentsFirst([
          { shardId: "child-b", parentShardId: "parent" },
          { shardId: "child-a", parentShardId: "parent" },
          { shardId: "parent" },
        ]),
      ),
    ).toEqual(["parent", "child-b", "child-a"]);
  });

  it("puts both parents of a merge before the shard they became", () => {
    expect(
      ids(
        parentsFirst([
          { shardId: "merged", parentShardId: "left", adjacentParentShardId: "right" },
          { shardId: "right" },
          { shardId: "left" },
        ]),
      ),
    ).toEqual(["right", "left", "merged"]);
  });

  it("does not wait for a parent that has expired and is no longer listed", () => {
    expect(ids(parentsFirst([{ shardId: "child", parentShardId: "gone" }]))).toEqual(["child"]);
  });

  it("follows a chain of splits from the oldest shard down", () => {
    expect(
      ids(
        parentsFirst([
          { shardId: "c", parentShardId: "b" },
          { shardId: "b", parentShardId: "a" },
          { shardId: "a" },
        ]),
      ),
    ).toEqual(["a", "b", "c"]);
  });
});
