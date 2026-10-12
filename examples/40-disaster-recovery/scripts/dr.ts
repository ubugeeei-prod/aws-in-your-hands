// vp run dr:status | dr:drill | dr:job | dr:terminate | dr:billed
//
// The steps Elastic Disaster Recovery has no resource for. Everything that changes AWS prints
// what it would do, and does it only with --apply. None of this was run while writing the book.

import { parseArgs } from "node:util";

import { DrsClient } from "@aws-sdk/client-drs";

import { preflight } from "@aih/tools/aws/preflight.ts";

import { AwsDrs, drillInstances, protectedServers } from "../src/adapter.ts";
import { NOT_VISIBLE_HERE, nothingBilled, stillBilled } from "../src/billing.ts";
import { planDrill, startRecoveryInput } from "../src/drill.ts";

// #region flags
const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    // Without it, every command that changes AWS only prints what it would do.
    apply: { type: "boolean", default: false },
    // The objective the plan is judged against, in seconds.
    rpo: { type: "string", default: "600" },
    // A point in time, ISO 8601. Without it: the most recent data.
    at: { type: "string" },
    // Goes into the job's tags and the drill record.
    name: { type: "string", default: `drill-${new Date().toISOString().slice(0, 10)}` },
    job: { type: "string" },
  },
});
// #endregion flags

const command = positionals[0];
const changes = command === "drill" || command === "terminate";

async function connect() {
  const { target } = await preflight({
    access: changes && flags.apply ? "mutate" : "observe",
    action: `dr ${command}`,
  });
  return new AwsDrs(new DrsClient({ region: target.region }));
}

function target(): "latest" | Date {
  if (flags.at === undefined) {
    return "latest";
  }
  const at = new Date(flags.at);
  if (Number.isNaN(at.getTime())) {
    throw new Error(`--at ${flags.at} is not a time. Use ISO 8601, such as 2026-10-13T09:00:00Z.`);
  }
  return at;
}

function rpoSeconds(): number {
  const value = Number(flags.rpo);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`--rpo ${flags.rpo} is not a number of seconds.`);
  }
  return value;
}

async function plan(api: AwsDrs) {
  const servers = await protectedServers(api);
  const drill = planDrill(servers, { target: target(), rpoSeconds: rpoSeconds(), now: new Date() });
  for (const server of drill.servers) {
    if (server.decision === "blocked") {
      console.log(`${server.sourceServerID}  BLOCKED  ${server.reason}`);
      continue;
    }
    console.log(
      `${server.sourceServerID}  launch from ${server.recoverySnapshotID ?? "an on-demand snapshot"}` +
        `  recovery point ${server.recoveryPointAt ?? "unknown"}` +
        `  loss ${server.lossSeconds === null ? "unknown" : `${server.lossSeconds} s`}` +
        `  within RPO ${rpoSeconds()} s: ${server.withinRpo}`,
    );
    for (const note of server.notes) {
      console.log(`    ${note}`);
    }
  }
  console.log(
    drill.meetsObjective ? "The objective would be met." : "The objective is NOT shown to be met.",
  );
  return drill;
}

// #region commands
async function main(): Promise<number> {
  switch (command) {
    case "status": {
      const drill = await plan(await connect());
      return drill.meetsObjective ? 0 : 2;
    }
    case "drill": {
      const api = await connect();
      const input = startRecoveryInput(await plan(api), { isDrill: true, name: flags.name });
      console.log(`StartRecovery ${JSON.stringify(input)}`);
      if (!flags.apply) {
        console.log("Nothing was started. Add --apply to launch the drill instances.");
        return 0;
      }
      const job = await api.startRecovery(input);
      console.log(`Started ${job.jobID}. Follow it with: vp run dr:job --job ${job.jobID}`);
      return 0;
    }
    case "job": {
      if (flags.job === undefined) {
        throw new Error("Pass the job: --job drsjob-...");
      }
      const job = await (await connect()).job(flags.job);
      if (job === undefined) {
        throw new Error(`No job ${flags.job} in this Region.`);
      }
      console.log(
        `${job.jobID}  ${job.status ?? "?"}  created ${job.creationDateTime ?? "?"}  ended ${job.endDateTime ?? "-"}`,
      );
      for (const server of job.participatingServers) {
        console.log(
          `  ${server.sourceServerID ?? "?"}  ${server.launchStatus ?? "?"}  ${server.recoveryInstanceID ?? ""}`,
        );
      }
      // COMPLETED says the job ended, not that every launch worked.
      const launched = job.participatingServers.every(
        (server) => server.launchStatus === "LAUNCHED",
      );
      return job.status === "COMPLETED" && launched ? 0 : 2;
    }
    case "terminate": {
      const api = await connect();
      const drills = drillInstances(await api.recoveryInstances());
      if (drills.length === 0) {
        console.log("No drill instance exists.");
        return 0;
      }
      for (const instance of drills) {
        console.log(
          `${instance.recoveryInstanceID}  drill of ${instance.sourceServerID ?? "?"}  ${instance.ec2InstanceState ?? "?"}`,
        );
      }
      if (!flags.apply) {
        console.log("Nothing was terminated. Add --apply to terminate these drill instances.");
        return 0;
      }
      const job = await api.terminateRecoveryInstances(
        drills.map((instance) => instance.recoveryInstanceID),
      );
      console.log(`Terminating in ${job.jobID}.`);
      return 0;
    }
    case "billed": {
      const api = await connect();
      const lines = stillBilled(await api.sourceServers(), await api.recoveryInstances());
      for (const line of lines) {
        console.log(
          `${line.billed.padEnd(12)} ${line.resource}  ${line.what}\n${"".padEnd(13)}next: ${line.next}`,
        );
      }
      console.log("\nNot visible to these two calls:");
      for (const item of NOT_VISIBLE_HERE) {
        console.log(`  - ${item}`);
      }
      return nothingBilled(lines) ? 0 : 2;
    }
    default:
      throw new Error(
        "usage: dr.ts status|drill|job|terminate|billed [--apply] [--rpo s] [--at time] [--job id]",
      );
  }
}
// #endregion commands

try {
  process.exit(await main());
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
