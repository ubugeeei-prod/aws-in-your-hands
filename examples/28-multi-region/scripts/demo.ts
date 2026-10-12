// vp run mr:demo
//
// Two Regions in memory: the same edit conflict under each consistency mode,
// an outage, and the arithmetic behind the recovery targets. No AWS, no
// credentials, nothing written to disk.

import { BucketModel, Replication } from "../src/bucket-replication.ts";
import { createWorld, type World } from "../src/local.ts";
import { failoverBudget, HEALTH_CHECK, TARGETS } from "../src/objectives.ts";
import { REGION_HEADER } from "../src/regional-app.ts";
import { PRIMARY_REGION as TOKYO, type Region, STANDBY_REGION as OSAKA } from "../src/regions.ts";

const say = (line = "") => console.log(line);
const LAG = 1000;

async function createNote(world: World): Promise<string> {
  const response = await world.apps[TOKYO](
    new Request("http://api.test/notes", {
      method: "POST",
      body: JSON.stringify({ title: "shopping list" }),
    }),
  );
  world.advance(LAG);
  return ((await response.json()) as { id: string }).id;
}

// #region edit
async function edit(world: World, region: Region, id: string, title: string): Promise<void> {
  const response = await world.apps[region](
    new Request(`http://api.test/notes/${id}`, {
      method: "PUT",
      body: JSON.stringify({ title, body: "", expectedVersion: 1 }),
    }),
  );
  const from = response.headers.get(REGION_HEADER);
  say(`  PUT "${title}" (expects version 1) -> ${response.status} from ${from}`);
}
// #endregion edit

async function show(world: World, id: string): Promise<void> {
  for (const region of [TOKYO, OSAKA] as const) {
    const note = world.table.replica(region).getEventually(`OWNER#anonymous|NOTE#${id}`);
    say(`  ${region} holds: "${String(note?.["title"])}", version ${String(note?.["version"])}`);
  }
}

say("1. Eventual mode (MREC). Two people edit version 1, one in each Region.");
{
  const world = createWorld({ mode: "eventual", lagMs: LAG });
  const id = await createNote(world);
  await edit(world, TOKYO, id, "milk, eggs");
  world.advance(LAG / 2);
  await edit(world, OSAKA, id, "bread");
  world.advance(LAG);
  await show(world, id);
  say("  Both were told 200. One edit is gone, and no response said so.");
}

say();
say("2. Eventual mode, every write sent to Tokyo.");
{
  const world = createWorld({ mode: "eventual", lagMs: LAG });
  const id = await createNote(world);
  await edit(world, TOKYO, id, "milk, eggs");
  await edit(world, TOKYO, id, "bread");
  say("  Chapter 05's check works again, because one copy sees both writes.");
}

say();
say("3. Eventual mode. Tokyo acknowledges an edit and is cut off before it replicates.");
{
  const world = createWorld({ mode: "eventual", lagMs: LAG });
  const id = await createNote(world);
  await edit(world, TOKYO, id, "milk, eggs");
  world.table.isolate(TOKYO);
  world.advance(60_000);
  await edit(world, OSAKA, id, "bread");
  say(`  writes waiting for the two Regions to reconnect: ${world.table.undelivered}`);
  world.advance(3_600_000);
  world.table.rejoin(TOKYO);
  world.advance(LAG);
  await show(world, id);
  say("  Tokyo's edit arrived an hour late and lost to the newer one.");
}

say();
say("4. Strong mode (MRSC), three Regions. The same two edits.");
{
  const world = createWorld({ mode: "strong" });
  const id = await createNote(world);
  await edit(world, TOKYO, id, "milk, eggs");
  await edit(world, OSAKA, id, "bread");
  world.table.isolate(TOKYO);
  await edit(world, TOKYO, id, "butter");
  say("  The second edit gets its 409. Alone, Tokyo fails the request instead of guessing.");
}

say();
say("5. The bucket. An image is deleted in Tokyo; another is uploaded 2 s before an outage.");
{
  const tokyo = new BucketModel("tokyo");
  const osaka = new BucketModel("osaka");
  const replication = new Replication(tokyo, osaka, { deleteMarkers: false, lagMs: 5000 });
  tokyo.put("u/alice/n1/old", new Uint8Array(4));
  replication.advance(5000);
  tokyo.delete("u/alice/n1/old");
  tokyo.put("u/alice/n1/new", new Uint8Array(4));
  replication.advance(2000);
  replication.pause();
  const present = (key: string) => (osaka.current(key) === undefined ? "missing" : "present");
  say(
    `  in Osaka: deleted image ${present("u/alice/n1/old")}, new image ${present("u/alice/n1/new")}`,
  );
  say(`  waiting in Tokyo: ${replication.pending} object`);
}

say();
say("6. The targets, and what they are made of.");
{
  const budget = failoverBudget({
    healthCheck: HEALTH_CHECK,
    dnsTtlSeconds: 60,
    clientSeconds: 60,
  });
  say(
    `  RTO ${TARGETS.rtoSeconds} s: detect ${budget.detectSeconds} s + DNS ${budget.dnsSeconds} s + client ${budget.clientSeconds} s = ${budget.totalSeconds} s (${budget.withinTarget ? "within" : "over"})`,
  );
  say(
    `  RPO notes ${TARGETS.rpoTableSeconds} s, images ${TARGETS.rpoBucketSeconds} s. Assumed, not measured.`,
  );
}
