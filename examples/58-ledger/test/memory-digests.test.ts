import { describe, expect, it } from "vite-plus/test";

import { MemoryDigests } from "../src/memory-digests.ts";
import { DAY, at } from "./support.ts";

// The rules are the ones the S3 user guide states for Object Lock, versioning,
// and conditional writes. Nothing here was observed on S3.
const bucket = () => new MemoryDigests({ mode: "governance", retentionMs: DAY, now: () => at(0) });

describe("the model of a locked, versioned bucket", () => {
  it("refuses a conditional write to a key that has an object", async () => {
    const digests = bucket();
    expect(await digests.put("k", "one")).toBe("ok");
    expect(await digests.put("k", "two")).toBe("exists");
    expect(await digests.list("")).toHaveLength(1);
  });

  it("accepts a conditional write once a delete marker is on top", async () => {
    const digests = bucket();
    await digests.put("k", "one");
    digests.remove("k");
    expect(await digests.put("k", "two")).toBe("ok");
    expect((await digests.list("")).map((version) => version.deleteMarker)).toEqual([
      false,
      true,
      false,
    ]);
  });

  it("keeps the locked version when the key is written again without the condition", async () => {
    const digests = bucket();
    await digests.put("k", "one");
    digests.overwrite("k", "two");
    const [newest, oldest] = await digests.list("");
    expect(await digests.get("k", newest?.versionId ?? "")).toBe("two");
    expect(await digests.get("k", oldest?.versionId ?? "")).toBe("one");
  });

  it("lists by prefix, in key order", async () => {
    const digests = bucket();
    await digests.put("digests/b/1", "x");
    await digests.put("digests/a/2", "x");
    await digests.put("digests/a/1", "x");
    expect((await digests.list("digests/a/")).map((version) => version.key)).toEqual([
      "digests/a/1",
      "digests/a/2",
    ]);
  });
});
