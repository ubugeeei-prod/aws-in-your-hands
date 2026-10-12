// vp run dr:demo
//
// A failover and a failback between two sites in memory, twice: once the way that loses
// writes without a word, once the way that accounts for them. No AWS, nothing written to disk.

import { evaluateDrill, summarize } from "../src/drill.ts";
import { freshProgress, NOTES_RECOVERY, runRecovery } from "../src/order.ts";
import { TwoSites } from "../src/sites.ts";

const say = (line: string) => console.log(line);

// #region demo
function story(failback: "naive" | "accounted"): TwoSites {
  const world = new TwoSites();
  world.write("source", "note-1");
  world.write("source", "note-2");
  world.replicate();
  world.write("source", "note-3");
  say(
    `  the source holds 3 notes, the staging area ${world.staging.size}: note-3 is still on its way`,
  );

  world.loseSource();
  world.launchRecovery();
  world.switchAddress("recovery");
  world.write("recovery", "note-4");
  say(`  failover: the recovery instance starts with ${world.staging.size} notes and takes note-4`);

  world.returnSource({ fenced: false });
  world.write("source", "note-5");
  say(
    `  the source is back and unfenced, and an old client writes note-5 to it. Split brain: ${world.splitBrain}`,
  );

  if (failback === "naive") {
    world.failbackNaive();
  } else {
    world.fenceSource();
    for (const entry of world.failbackAccounted({ sourceReadable: true })) {
      say(
        `  accounted: ${entry.kind === "write" ? entry.id : `window after ${entry.after}`} (${entry.reason})`,
      );
    }
  }
  const lost = world.silentlyLost().map((write) => write.id);
  say(
    `  after failback the source serves ${world.source.notes.size} notes. Lost without a record: ${lost.join(", ") || "none"}`,
  );
  return world;
}

say("Failback by overwriting the source:");
story("naive");
say("\nFailback after fencing the source and reading what only it held:");
story("accounted");

say("\nThe order of a recovery, with the app check failing once:");
let attempts = 0;
const execute = async (step: { id: string }) => {
  if (step.id === "verify-app" && ++attempts === 1) {
    throw new Error("notes.service is not active");
  }
};
const first = await runRecovery(NOTES_RECOVERY, freshProgress(NOTES_RECOVERY), execute);
say(
  `  first run:  ran ${first.ran.join(", ")}; ${first.outcome}; never reached ${first.blocked.join(", ")}`,
);
const second = await runRecovery(NOTES_RECOVERY, first.progress, execute);
say(`  second run: ran ${second.ran.join(", ")}; ${second.outcome}`);

say("\nA drill whose instance booted but whose notes were never checked:");
const summary = summarize({
  name: "demo",
  region: "ap-northeast-1",
  kind: "drill",
  objectives: { rpoSeconds: 600, rtoSeconds: 3600 },
  jobID: null,
  timeline: {
    declaredAt: "2026-10-13T09:00:00.000Z",
    startRequestedAt: "2026-10-13T09:02:00.000Z",
    recoveryPointAt: "2026-10-13T08:58:30.000Z",
    launchedAt: "2026-10-13T09:20:00.000Z",
    verifiedAt: null,
    terminatedAt: null,
  },
  checks: [
    { id: "instance-status", outcome: "pass", detail: "" },
    { id: "service-active", outcome: "pass", detail: "" },
  ],
  notes: "times invented for the demo; nothing was launched",
});
say(
  `  RPO ${summary.rpoSeconds} s (${summary.rpo}), RTO ${summary.rto}, checks ${summary.verdict.result}, cleaned up: ${summary.cleanedUp}`,
);
say(
  `  missing: ${evaluateDrill([]).missing.length} checks when none ran, ${summary.verdict.missing.length} here`,
);
// #endregion demo
