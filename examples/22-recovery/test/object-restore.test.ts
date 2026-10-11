import { describe, expect, it } from "vite-plus/test";
import { planObjectRestore, restoreObjects } from "../src/object-restore.ts";
import { MemoryVersionedBucket, type ObjectVersion } from "../src/versioned-bucket.ts";
import { failingOn } from "./world.ts";

const at = (minute: number): Date => new Date(Date.UTC(2026, 9, 12, 9, minute));
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

function bucketAt() {
  let clock = at(0);
  const bucket = new MemoryVersionedBucket(() => clock);
  return { bucket, setMinute: (minute: number) => void (clock = at(minute)) };
}

const current = async (bucket: MemoryVersionedBucket): Promise<Record<string, string>> => {
  const result: Record<string, string> = {};
  for await (const object of bucket.listCurrent("")) {
    result[object.key] = object.eTag;
  }
  return result;
};

describe("planObjectRestore", () => {
  it("takes the delete marker off a key deleted after the point", async () => {
    const { bucket, setMinute } = bucketAt();
    bucket.put("u/a/n/1", bytes("one"), "image/png");
    setMinute(10);
    await bucket.delete("u/a/n/1");

    const plan = await restoreObjects(bucket, { prefix: "u/", point: at(5), dryRun: true });
    expect(plan.steps).toMatchObject([{ type: "remove_delete_marker", key: "u/a/n/1" }]);
    expect(await current(bucket)).toEqual({});
  });

  it("takes every marker off when the key was deleted more than once", async () => {
    const { bucket, setMinute } = bucketAt();
    bucket.put("u/a/n/1", bytes("one"), "image/png");
    setMinute(10);
    await bucket.delete("u/a/n/1");
    setMinute(11);
    // A second plain delete does not remove the first marker: it adds another.
    await bucket.delete("u/a/n/1");

    const plan = await restoreObjects(bucket, { prefix: "u/", point: at(5), dryRun: false });
    expect(plan.steps).toHaveLength(2);
    expect(Object.keys(await current(bucket))).toEqual(["u/a/n/1"]);
  });

  it("copies the old bytes on top of a key overwritten after the point, and removes nothing", async () => {
    const { bucket, setMinute } = bucketAt();
    bucket.put("u/a/n/1", bytes("good"), "image/png");
    const good = (await current(bucket))["u/a/n/1"];
    setMinute(10);
    bucket.put("u/a/n/1", bytes("damaged"), "image/png");
    setMinute(20);

    const plan = await restoreObjects(bucket, { prefix: "u/", point: at(5), dryRun: false });
    expect(plan.steps).toMatchObject([{ type: "copy_version", key: "u/a/n/1" }]);
    expect(await current(bucket)).toEqual({ "u/a/n/1": good });

    const history: ObjectVersion[] = [];
    for await (const version of bucket.listVersions("u/")) {
      history.push(version);
    }
    expect(history).toHaveLength(3);
  });

  it("leaves alone what was created after the point, and names it", async () => {
    const { bucket, setMinute } = bucketAt();
    setMinute(10);
    bucket.put("u/a/n/new", bytes("new"), "image/png");

    const plan = await restoreObjects(bucket, { prefix: "u/", point: at(5), dryRun: false });
    expect(plan).toEqual({ steps: [], newerThanPoint: ["u/a/n/new"], unchanged: 0 });
    expect(Object.keys(await current(bucket))).toEqual(["u/a/n/new"]);
  });

  it("does not bring back what was already deleted at the point", async () => {
    const { bucket, setMinute } = bucketAt();
    bucket.put("u/a/n/1", bytes("one"), "image/png");
    setMinute(2);
    await bucket.delete("u/a/n/1");

    expect(await restoreObjects(bucket, { prefix: "u/", point: at(5), dryRun: false })).toEqual({
      steps: [],
      newerThanPoint: [],
      unchanged: 1,
    });
  });

  it("orders versions by time, whatever order the listing gave them in", () => {
    const version = (versionId: string, minute: number, deleteMarker: boolean, isLatest = false): ObjectVersion => ({
      key: "u/a/n/1",
      versionId,
      deleteMarker,
      isLatest,
      lastModified: at(minute),
      ...(deleteMarker ? {} : { eTag: versionId }),
    });
    // S3 returns versions and delete markers as two lists.
    const listing = [version("old", 1, false), version("mid", 3, false), version("marker", 10, true, true)];

    expect(planObjectRestore(listing, at(5)).steps).toEqual([
      { type: "remove_delete_marker", key: "u/a/n/1", versionId: "marker" },
    ]);
    expect(planObjectRestore(listing.toReversed(), at(2)).steps).toEqual([
      { type: "copy_version", key: "u/a/n/1", versionId: "old" },
    ]);
  });
});

describe("restoreObjects", () => {
  async function damaged() {
    const { bucket, setMinute } = bucketAt();
    bucket.put("u/a/n/1", bytes("one"), "image/png");
    bucket.put("u/a/n/2", bytes("two"), "image/png");
    bucket.put("u/a/n/3", bytes("three"), "image/png");
    const before = await current(bucket);
    setMinute(10);
    await bucket.delete("u/a/n/1");
    bucket.put("u/a/n/2", bytes("damaged"), "image/png");
    await bucket.delete("u/a/n/3");
    setMinute(20);
    return { bucket, before };
  }

  it("plans nothing the second time", async () => {
    const { bucket, before } = await damaged();
    await restoreObjects(bucket, { prefix: "u/", point: at(5), dryRun: false });
    expect(await current(bucket)).toEqual(before);

    const again = await restoreObjects(bucket, { prefix: "u/", point: at(5), dryRun: false });
    expect(again).toEqual({ steps: [], newerThanPoint: [], unchanged: 3 });
  });

  it("is finished by running it again after it stopped halfway", async () => {
    const { bucket, before } = await damaged();
    const flaky = failingOn(bucket, "copyVersion", 1);

    await expect(restoreObjects(flaky, { prefix: "u/", point: at(5), dryRun: false })).rejects.toThrow(
      "injected failure",
    );
    expect(await current(bucket)).not.toEqual(before);

    await restoreObjects(bucket, { prefix: "u/", point: at(5), dryRun: false });
    expect(await current(bucket)).toEqual(before);
  });
});
