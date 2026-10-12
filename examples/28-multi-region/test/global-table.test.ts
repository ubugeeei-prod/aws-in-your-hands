import { describe, expect, it } from "vite-plus/test";

import type { Note } from "@aih/example-05-dynamodb/src/contract.ts";
import { describeRepositoryContract } from "@aih/example-05-dynamodb/test/repository-contract.ts";

import { GlobalTableModel, RegionIsolatedError } from "../src/global-table.ts";
import { createWorld, WITNESS_REGION } from "../src/local.ts";
import { PRIMARY_REGION as TOKYO, REGIONS, STANDBY_REGION as OSAKA } from "../src/regions.ts";
import { ReplicaNoteRepository } from "../src/replica-repository.ts";

const OWNER = "alice";
const LAG = 1000;

const note = (id: string, title = "shopping list"): Note => ({
  id,
  title,
  body: "",
  version: 1,
  createdAt: "2026-10-12T09:00:00.000Z",
  updatedAt: "2026-10-12T09:00:00.000Z",
});

const edit = (title: string, expectedVersion = 1) => ({
  title,
  body: "",
  expectedVersion,
  updatedAt: "2026-10-12T09:05:00.000Z",
});

// Inside one Region nothing changes: chapter 05's promises hold on each copy.
describeRepositoryContract("one replica, eventual mode", async () => ({
  repository: new ReplicaNoteRepository(
    new GlobalTableModel({ mode: "eventual", replicas: REGIONS }).replica(TOKYO),
  ),
  owner: "test",
}));

describeRepositoryContract("one replica, strong mode", async () => ({
  repository: new ReplicaNoteRepository(
    new GlobalTableModel({ mode: "strong", replicas: REGIONS, witness: WITNESS_REGION }).replica(
      OSAKA,
    ),
  ),
  owner: "test",
}));

/** One note, written in Tokyo and already copied to Osaka. */
async function seeded(mode: "eventual" | "strong") {
  const world = createWorld({ mode, lagMs: LAG });
  await world.notes(TOKYO).create(OWNER, note("n1"));
  world.advance(LAG);
  return world;
}

describe("eventual mode (MREC), both Regions healthy", () => {
  it("shows a write in the other Region only after the lag", async () => {
    const world = createWorld({ mode: "eventual", lagMs: LAG });
    await world.notes(TOKYO).create(OWNER, note("n1"));

    expect(await world.notes(OSAKA).get(OWNER, "n1")).toBeUndefined();
    world.advance(LAG - 1);
    expect(await world.notes(OSAKA).get(OWNER, "n1")).toBeUndefined();
    world.advance(1);
    expect(await world.notes(OSAKA).get(OWNER, "n1")).toMatchObject({ title: "shopping list" });
  });

  // #region lost-update
  it("tells two writers in two Regions that both saved, and keeps one edit", async () => {
    const world = await seeded("eventual");

    // Both loaded version 1. Each sends it back to the Region nearest to them.
    const inTokyo = await world.notes(TOKYO).update(OWNER, "n1", edit("milk, eggs"));
    world.advance(LAG / 2);
    const inOsaka = await world.notes(OSAKA).update(OWNER, "n1", edit("bread"));

    // Chapter 05 promised that exactly one of them is told "conflict".
    expect(inTokyo.status).toBe("updated");
    expect(inOsaka.status).toBe("updated");

    world.advance(LAG);
    const stored = await Promise.all(REGIONS.map((region) => world.notes(region).get(OWNER, "n1")));
    // The later write is everywhere. "milk, eggs" is nowhere, and nothing recorded that it was lost.
    expect(stored.map((copy) => copy?.title)).toEqual(["bread", "bread"]);
    expect(stored.map((copy) => copy?.version)).toEqual([2, 2]);
    expect(world.table.undelivered).toBe(0);
  });
  // #endregion lost-update

  it("keeps the promise while every write goes to one Region", async () => {
    const world = await seeded("eventual");

    // Routing, not the table, makes Tokyo the only writer.
    const first = await world.notes(TOKYO).update(OWNER, "n1", edit("milk, eggs"));
    const second = await world.notes(TOKYO).update(OWNER, "n1", edit("bread"));

    expect(first.status).toBe("updated");
    expect(second).toMatchObject({ status: "conflict", current: { title: "milk, eggs" } });
  });

  it("answers a consistent read in the other Region with the old note until the lag has passed", async () => {
    const world = await seeded("eventual");
    await world.notes(TOKYO).update(OWNER, "n1", edit("milk, eggs"));

    // ReplicaNoteRepository.get is chapter 05's ConsistentRead: consistent within Osaka only.
    expect(await world.notes(OSAKA).get(OWNER, "n1")).toMatchObject({ version: 1 });
    world.advance(LAG);
    expect(await world.notes(OSAKA).get(OWNER, "n1")).toMatchObject({ version: 2 });
  });

  it("loses one of two increments made in two Regions", () => {
    const table = new GlobalTableModel({ mode: "eventual", replicas: REGIONS, lagMs: LAG });
    const add = (region: string) => {
      const replica = table.replica(region);
      const count = (replica.get("OWNER#alice|QUOTA")?.["noteCount"] as number | undefined) ?? 0;
      replica.put("OWNER#alice|QUOTA", { noteCount: count + 1 });
    };
    add(TOKYO);
    table.advance(LAG);

    // Chapter 05's per-owner counter: each Region adds one to the 1 it sees.
    add(TOKYO);
    add(OSAKA);
    table.advance(LAG);

    // Whole items are replicated, not "+1". Three notes were counted as two.
    expect(table.replica(TOKYO).get("OWNER#alice|QUOTA")).toEqual({ noteCount: 2 });
    expect(table.replica(OSAKA).get("OWNER#alice|QUOTA")).toEqual({ noteCount: 2 });
  });
});

describe("eventual mode (MREC), Tokyo cut off", () => {
  // #region isolation
  it("drops an edit Tokyo acknowledged, once Osaka has edited the same note", async () => {
    const world = await seeded("eventual");

    // Tokyo says "updated", and is cut off before the write has left the Region.
    const acknowledged = await world.notes(TOKYO).update(OWNER, "n1", edit("milk, eggs"));
    world.table.isolate(TOKYO);
    world.advance(60_000);
    expect(acknowledged.status).toBe("updated");

    // Traffic has moved. Osaka still holds version 1, so the same edit of version 1 passes there.
    const afterFailover = await world.notes(OSAKA).update(OWNER, "n1", edit("bread"));
    expect(afterFailover.status).toBe("updated");

    world.advance(3_600_000);
    world.table.rejoin(TOKYO);
    world.advance(LAG);

    // Tokyo's held write arrives in Osaka and loses to the newer one. Both copies say "bread".
    const stored = await Promise.all(REGIONS.map((region) => world.notes(region).get(OWNER, "n1")));
    expect(stored.map((copy) => copy?.title)).toEqual(["bread", "bread"]);
  });
  // #endregion isolation

  it("delivers a note that only Tokyo had, late and intact", async () => {
    const world = await seeded("eventual");
    await world.notes(TOKYO).create(OWNER, note("n2", "written just before the outage"));
    world.table.isolate(TOKYO);
    world.advance(3_600_000);

    // For an hour the note does not exist as far as Osaka's users can tell.
    expect(await world.notes(OSAKA).get(OWNER, "n2")).toBeUndefined();
    expect(world.table.undelivered).toBe(1);

    world.table.rejoin(TOKYO);
    expect(await world.notes(OSAKA).get(OWNER, "n2")).toMatchObject({
      title: "written just before the outage",
    });
  });

  it("lets both sides keep writing, which is what makes the conflict possible", async () => {
    const world = await seeded("eventual");
    world.table.isolate(TOKYO);

    expect(await world.notes(TOKYO).create(OWNER, note("n2"))).toBe("created");
    expect(await world.notes(OSAKA).create(OWNER, note("n3"))).toBe("created");

    world.table.rejoin(TOKYO);
    world.advance(LAG);
    const ids = async (region: (typeof REGIONS)[number]) =>
      (await world.notes(region).list(OWNER, { limit: 10 })).notes.map((each) => each.id);
    expect(await ids(TOKYO)).toEqual(["n3", "n2", "n1"]);
    expect(await ids(OSAKA)).toEqual(["n3", "n2", "n1"]);
  });
});

describe("strong mode (MRSC)", () => {
  it("refuses the second of two writers, whichever Region each one used", async () => {
    const world = await seeded("strong");

    const inTokyo = await world.notes(TOKYO).update(OWNER, "n1", edit("milk, eggs"));
    const inOsaka = await world.notes(OSAKA).update(OWNER, "n1", edit("bread"));

    expect(inTokyo.status).toBe("updated");
    expect(inOsaka).toMatchObject({ status: "conflict", current: { title: "milk, eggs" } });
  });

  it("stops writes and consistent reads in a Region that is alone", async () => {
    const world = await seeded("strong");
    world.table.isolate(TOKYO);

    await expect(world.notes(TOKYO).update(OWNER, "n1", edit("milk, eggs"))).rejects.toThrow(
      RegionIsolatedError,
    );
    await expect(world.notes(TOKYO).get(OWNER, "n1")).rejects.toThrow(RegionIsolatedError);
    // An eventually consistent read still answers, with what Tokyo last knew.
    expect(world.table.replica(TOKYO).getEventually("OWNER#alice|NOTE#n1")).toMatchObject({
      version: 1,
    });
  });

  it("keeps Osaka writing with the witness, and loses nothing when Tokyo returns", async () => {
    const world = await seeded("strong");
    world.table.isolate(TOKYO);

    const inOsaka = await world.notes(OSAKA).update(OWNER, "n1", edit("bread"));
    expect(inOsaka.status).toBe("updated");

    world.table.rejoin(TOKYO);
    expect(await world.notes(TOKYO).get(OWNER, "n1")).toMatchObject({ title: "bread", version: 2 });
    // Version 1 is gone from Tokyo too, so the stale edit is refused there.
    expect((await world.notes(TOKYO).update(OWNER, "n1", edit("milk, eggs"))).status).toBe(
      "conflict",
    );
  });

  it("stops everywhere when two of the three Regions are unreachable", async () => {
    const world = await seeded("strong");
    world.table.isolate(TOKYO);
    world.table.isolate(WITNESS_REGION);

    await expect(world.notes(OSAKA).update(OWNER, "n1", edit("bread"))).rejects.toThrow(
      RegionIsolatedError,
    );
  });

  it("answers 500 through the API in a Region that is alone, and logs why", async () => {
    const lines: string[] = [];
    const world = createWorld({ mode: "strong", writeLog: (line) => lines.push(line) });
    world.table.isolate(TOKYO);

    const response = await world.apps[TOKYO](new Request("http://api.test/notes/n1"));
    expect(response.status).toBe(500);
    expect(lines.join("\n")).toContain("RegionIsolatedError");
  });

  it("needs exactly three Regions", () => {
    expect(() => new GlobalTableModel({ mode: "strong", replicas: REGIONS })).toThrow(/three/);
  });
});
