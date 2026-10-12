// vp run celld:<action>
//   node scripts/fleet.ts <action> [arguments]
//
// Everything that talks to the deployed fleet. Commands reach the nodes through
// Systems Manager Run Command; nothing here opens a port or uses SSH.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

import * as v from "valibot";

import {
  commandResultArgs,
  invocationSchema,
  isFinished,
  sendCommandArgs,
  sentCommandSchema,
  succeeded,
} from "@aih/example-23-ec2/src/remote.ts";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import {
  backupIdFor,
  backupIdSchema,
  type BackupManifest,
  copyOutCall,
  manifestKey,
  manifestSchema,
  restorePlan,
  snapshotArgs,
  snapshotResultSchema,
  waitSnapshotsArgs,
} from "../src/backup.ts";
import { assetOf, PINNED_VERSION, upgradeModeFor, versionSchema } from "../src/celld.ts";
import { CELLD_STACK, type NodeName, nodeNames } from "../src/config.ts";
import { parseDiagnose, parseNodeHealth } from "../src/health.ts";
import { describeReport, joinLedgers, judge } from "../src/ledger.ts";
import { ARTIFACT_TARGET, artifactKey, nodeSpec } from "../src/machine.ts";
import {
  defaultProbePlan,
  lastSeqBefore,
  parseProbeOutput,
  probePlanSchema,
  type ProbeOutput,
} from "../src/probe.ts";
import {
  killArgs,
  nodeCommands,
  startInstanceArgs,
  uploadArtifactArgs,
  waitInstanceArgs,
} from "../src/remote.ts";
import {
  describeRollout,
  drainFleet,
  type FleetOps,
  rollingUpdate,
  stoppedFleetUpdate,
} from "../src/rollout.ts";

const ACTIONS = [
  "status",
  "logs",
  "artifacts",
  "install",
  "start",
  "drain",
  "stop-all",
  "diagnose",
  "cells",
  "smoke",
  "app-deploy",
  "rollout",
  "kill",
  "revive",
  "loss-check",
  "backup",
  "restore",
  "bucket-empty",
] as const;
type Action = (typeof ACTIONS)[number];
const OBSERVING: readonly Action[] = ["status", "logs", "diagnose", "cells"];

const [action, ...rest] = process.argv.slice(2);
const isAction = (value: string | undefined): value is Action =>
  (ACTIONS as readonly string[]).includes(value ?? "");
if (!isAction(action)) {
  console.error(`usage: fleet.ts <${ACTIONS.join("|")}> [arguments]`);
  process.exit(64);
}
const flags = new Set(rest.filter((argument) => argument.startsWith("--")));
const words = rest.filter((argument) => !argument.startsWith("--"));

const spec = nodeSpec();
const commands = nodeCommands(spec);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function aws(args: string[], options: { inherit?: boolean } = {}): string {
  const result = spawnSync("aws", args, {
    encoding: "utf8",
    stdio: ["ignore", options.inherit === true ? "inherit" : "pipe", "inherit"],
  });
  if (result.status !== 0) {
    throw new Error(
      `aws ${args.slice(0, 2).join(" ")} exited with ${result.status ?? result.signal}`,
    );
  }
  return result.stdout ?? "";
}

function nodeArgument(value: string | undefined, known: NodeName[]): NodeName {
  const found = known.find((node) => node === value);
  if (found === undefined) {
    throw new Error(
      `expected one of the deployed nodes (${known.join(", ") || "none"}), got "${value ?? ""}"`,
    );
  }
  return found;
}

try {
  const { target } = await preflight({
    access: OBSERVING.includes(action) ? "observe" : "mutate",
    action: `celld ${action}`,
    stack: CELLD_STACK,
  });
  const { region } = target;
  const outputs = await readStackOutputs(process.cwd(), CELLD_STACK, region);
  const bucket = requireOutput(outputs, "FleetBucketName");
  const backupBucket = requireOutput(outputs, "BackupBucketName");
  const nodes = nodeNames(Number(requireOutput(outputs, "NodeCount")));
  const instanceOf = (node: NodeName): string =>
    requireOutput(outputs, `Node${node.toUpperCase()}InstanceId`);
  const volumeOf = (node: NodeName): string =>
    requireOutput(outputs, `Node${node.toUpperCase()}VolumeId`);

  /** Sends shell lines to one node and waits for them. `quiet` keeps the node's stdout for the caller. */
  async function run(
    node: NodeName,
    lines: string[],
    comment: string,
    options: { quiet?: boolean; maxWaitSeconds?: number } = {},
  ): Promise<{ ok: boolean; stdout: string }> {
    const commandId = send(node, lines, comment);
    return await wait(node, commandId, options);
  }

  function send(node: NodeName, lines: string[], comment: string): string {
    const instanceId = instanceOf(node);
    const sent = v.parse(
      sentCommandSchema,
      JSON.parse(aws(sendCommandArgs({ instanceId, region, commands: lines, comment }))),
    );
    console.error(`[${node}] command ${sent.Command.CommandId} sent to ${instanceId}`);
    return sent.Command.CommandId;
  }

  async function wait(
    node: NodeName,
    commandId: string,
    options: { quiet?: boolean; maxWaitSeconds?: number } = {},
  ): Promise<{ ok: boolean; stdout: string }> {
    const instanceId = instanceOf(node);
    const polls = Math.ceil((options.maxWaitSeconds ?? 300) / 2);
    for (let poll = 0; poll < polls; poll += 1) {
      await sleep(2000);
      const result = spawnSync("aws", commandResultArgs({ commandId, instanceId, region }), {
        encoding: "utf8",
      });
      if (result.status !== 0) {
        // The invocation takes a moment to exist after the command is accepted.
        continue;
      }
      const invocation = v.parse(invocationSchema, JSON.parse(result.stdout));
      if (!isFinished(invocation)) {
        continue;
      }
      if (options.quiet !== true) {
        process.stdout.write(invocation.StandardOutputContent);
      }
      process.stderr.write(invocation.StandardErrorContent);
      console.error(
        `[${node}] status: ${invocation.Status}, exit code: ${invocation.ResponseCode ?? "none"}`,
      );
      return { ok: succeeded(invocation), stdout: invocation.StandardOutputContent };
    }
    throw new Error(`[${node}] command ${commandId} did not finish in time`);
  }

  async function must(node: NodeName, lines: string[], comment: string): Promise<string> {
    const result = await run(node, lines, comment, { quiet: true });
    if (!result.ok) {
      throw new Error(`${comment} failed on node ${node}`);
    }
    return result.stdout;
  }

  // #region ops
  // The real side of FleetOps. src/rollout.ts decides the order; this only carries it out.
  const ops: FleetOps = {
    nodeHealth: async (node) =>
      parseNodeHealth(await must(node, commands.health(), "aih celld health")),
    fleetView: async (via) => {
      // A failing diagnosis still prints its checks, so the output is read whatever the exit code.
      const result = await run(via, commands.diagnose(), "aih celld diagnose", { quiet: true });
      const view = parseDiagnose(result.stdout);
      if (!result.ok && view.failures.length === 0) {
        view.failures.push("celld diagnose exited with an error");
      }
      return view;
    },
    drain: async (node) => void (await must(node, commands.drain(), "aih celld drain")),
    install: async (node, version) =>
      void (await must(node, commands.install(bucket, version), `aih celld install ${version}`)),
    start: async (node) => void (await must(node, commands.start(), "aih celld start")),
    wait: sleep,
  };
  // #endregion ops

  let ok = true;
  const each = async (targets: NodeName[], lines: string[], comment: string): Promise<void> => {
    for (const node of targets) {
      ok = (await run(node, lines, comment)).ok && ok;
    }
  };
  const chosen = (): NodeName[] =>
    words.length === 0 ? nodes : words.map((word) => nodeArgument(word, nodes));

  switch (action) {
    case "status":
      await each(chosen(), [...commands.status(), ...commands.health()], "aih celld:status");
      break;
    case "logs":
      await each(chosen(), commands.logs(), "aih celld:logs");
      break;
    case "diagnose":
      ok = (
        await run(
          nodeArgument(words[0] ?? nodes[0], nodes),
          commands.diagnose(),
          "aih celld:diagnose",
        )
      ).ok;
      break;
    case "smoke":
      ok = (
        await run(nodeArgument(words[0] ?? nodes[0], nodes), commands.smoke(), "aih celld:smoke")
      ).ok;
      break;
    case "cells":
      ok = (
        await run(nodeArgument(words[0] ?? nodes[0], nodes), commands.cells(), "aih celld:cells")
      ).ok;
      break;
    case "artifacts": {
      // What `vp run celld:fetch` downloaded and checked, copied to where the nodes can read it.
      const version = v.parse(versionSchema, words[0] ?? PINNED_VERSION);
      const asset = assetOf(version, ARTIFACT_TARGET);
      const file = `.celld/download/${version}/${asset.file}`;
      if (!existsSync(file)) {
        throw new Error(`${file} is missing. Run: vp run celld:fetch ${version}`);
      }
      aws(
        uploadArtifactArgs({ file, bucket, key: artifactKey(spec, version, asset.file), region }),
      );
      console.log(`uploaded ${asset.file} for ${version}`);
      break;
    }
    case "install": {
      const version = v.parse(versionSchema, words[0] ?? PINNED_VERSION);
      const targets =
        words.length > 1 ? words.slice(1).map((word) => nodeArgument(word, nodes)) : nodes;
      await each(targets, commands.install(bucket, version), `aih celld:install ${version}`);
      break;
    }
    case "start":
      await each(chosen(), commands.start(), "aih celld:start");
      break;
    case "drain":
      ok = (await run(nodeArgument(words[0], nodes), commands.drain(), "aih celld:drain")).ok;
      break;
    case "stop-all": {
      const result = await drainFleet(nodes, ops);
      console.log(describeRollout(result).join("\n"));
      ok = result.ok;
      break;
    }
    case "app-deploy": {
      // The one step that runs celld on your machine, with your credentials on the fleet bucket.
      const binary = ".celld/bin/celld";
      const project = ".celld/app/counter";
      if (!existsSync(binary) || !existsSync(`${project}/wrangler.jsonc`)) {
        throw new Error(
          "the local celld binary or the counter example is missing. Run: vp run celld:fetch --host",
        );
      }
      const args = [
        "deploy",
        project,
        "--bucket",
        `s3://${bucket}/${spec.fleetPrefix}`,
        "--region",
        region,
      ];
      console.error(`$ ${binary} ${args.join(" ")}`);
      ok =
        spawnSync(binary, args, {
          stdio: "inherit",
          env: { ...process.env, CELLD_ESBUILD: `${process.cwd()}/node_modules/.bin/esbuild` },
        }).status === 0;
      break;
    }
    case "rollout": {
      const version = v.parse(versionSchema, words[0] ?? PINNED_VERSION);
      const running = new Set<string>();
      for (const node of nodes) {
        running.add((await ops.nodeHealth(node)).version ?? "unknown");
      }
      const decisions = [...running].map((from) => upgradeModeFor(from, version));
      for (const decision of decisions) {
        console.error(decision.reason);
      }
      if (decisions.some((decision) => decision.mode === "unknown")) {
        throw new Error(
          "Read the upgrade notes for this pair (https://celld.dev/docs#upgrade-notes), add it to src/celld.ts, and run again.",
        );
      }
      const stopAll = decisions.some((decision) => decision.mode === "stop-all");
      if (stopAll && !flags.has("--stopped")) {
        throw new Error(
          "This pair needs a stopped fleet: vp run celld:stop-all, vp run celld:backup, then vp run celld:rollout <version> --stopped",
        );
      }
      const result = await (stopAll ? stoppedFleetUpdate : rollingUpdate)({
        nodes,
        target: version,
        ops,
      });
      console.log(describeRollout(result).join("\n"));
      ok = result.ok;
      break;
    }
    case "kill": {
      const node = nodeArgument(words[0], nodes);
      aws(killArgs({ instanceId: instanceOf(node), region }), { inherit: true });
      console.error(
        `[${node}] stop requested without an OS shutdown. Bring it back with: vp run celld:revive ${node}`,
      );
      break;
    }
    case "revive": {
      const node = nodeArgument(words[0], nodes);
      aws(startInstanceArgs({ instanceId: instanceOf(node), region }), { inherit: true });
      aws(waitInstanceArgs({ instanceId: instanceOf(node), region, state: "running" }));
      console.error(
        `[${node}] running. celld starts with the machine; check with: vp run celld:status ${node}`,
      );
      break;
    }
    // #region loss-check
    case "loss-check": {
      const victim = nodeArgument(words[0], nodes);
      const survivors = nodes.filter((node) => node !== victim);
      const witness = survivors[0];
      if (witness === undefined) {
        throw new Error(
          "losing the only node proves nothing here: there is nobody left to ask. Deploy with -c nodes=2 or more.",
        );
      }
      const runId = Date.now().toString(36);
      const plan = defaultProbePlan(runId);
      // 1. A client on a surviving node starts writing. It keeps writing through everything below.
      const probe = send(witness, commands.probe(plan), `aih celld:loss-check probe ${runId}`);
      // 2. Let some writes be acknowledged first, then take the victim away without a shutdown.
      const lead = Math.ceil((plan.rounds / 3) * plan.pauseSeconds);
      await sleep(lead * 1000);
      aws(killArgs({ instanceId: instanceOf(victim), region }), { inherit: true });
      console.error(`[${victim}] stopped without an OS shutdown, about ${lead} s into the probe`);
      const main = await wait(witness, probe, { quiet: true, maxWaitSeconds: 1800 });
      const ledger = parseProbeOutput(main.stdout);
      // 3. Read every counter once more through each node that is left: two owners would disagree here.
      const outputs: ProbeOutput[] = [ledger];
      for (const node of survivors) {
        const sweep = v.parse(probePlanSchema, { ...plan, rounds: 2, pauseSeconds: 0 });
        const result = await run(
          node,
          commands.probe(sweep),
          `aih celld:loss-check sweep ${runId}`,
          { quiet: true },
        );
        outputs.push(parseProbeOutput(result.stdout));
      }
      const report = judge(joinLedgers(outputs), {
        cells: plan.cells,
        faultAtSeq: lastSeqBefore(plan, lead) + 1,
      });
      console.log(describeReport(report).join("\n"));
      mkdirSync("../../reports/celld", { recursive: true });
      writeFileSync(
        `../../reports/celld/loss-check-${runId}.json`,
        JSON.stringify({ victim, plan, report }, null, 2),
      );
      console.error(
        `report: reports/celld/loss-check-${runId}.json. The victim is still stopped: vp run celld:revive ${victim}`,
      );
      ok = report.verdict === "held";
      break;
    }
    // #endregion loss-check
    case "backup": {
      // Only a stopped fleet: a node disk can hold acknowledged writes the bucket does not have yet.
      const versions = new Map<NodeName, string | null>();
      for (const node of nodes) {
        const health = await ops.nodeHealth(node);
        if (health.active) {
          throw new Error(
            `node ${node} is running. Stop the whole fleet first: vp run celld:stop-all`,
          );
        }
        versions.set(node, health.version);
        await must(node, commands.flush(), "aih celld:backup flush");
      }
      const id = backupIdFor(new Date());
      const snapshots = nodes.map((node) => ({
        node,
        volumeId: volumeOf(node),
        snapshotId: v.parse(
          snapshotResultSchema,
          JSON.parse(aws(snapshotArgs({ volumeId: volumeOf(node), node, id, region }))),
        ).SnapshotId,
        celldVersion: versions.get(node) ?? null,
      }));
      const copy = copyOutCall({ bucket, prefix: spec.fleetPrefix, backupBucket, id, region });
      console.error(copy.describe);
      aws(copy.args, { inherit: true });
      aws(waitSnapshotsArgs({ snapshotIds: snapshots.map((entry) => entry.snapshotId), region }));
      const manifest: BackupManifest = v.parse(manifestSchema, {
        id,
        createdAt: new Date().toISOString(),
        region,
        source: { bucket, prefix: spec.fleetPrefix },
        nodes: snapshots,
      });
      mkdirSync("../../reports/celld", { recursive: true });
      const file = `../../reports/celld/backup-${id}.json`;
      writeFileSync(file, JSON.stringify(manifest, null, 2));
      aws([
        "s3",
        "cp",
        file,
        `s3://${backupBucket}/${manifestKey(id)}`,
        "--region",
        region,
        "--only-show-errors",
      ]);
      console.log(
        `backup ${id}: ${snapshots.length} snapshot(s) and a copy of s3://${bucket}/${spec.fleetPrefix}/`,
      );
      break;
    }
    case "restore": {
      const id = v.parse(backupIdSchema, words[0]);
      const execute = flags.has("--yes");
      for (const node of nodes) {
        if ((await ops.nodeHealth(node)).active) {
          throw new Error(
            `node ${node} is running. Stop the whole fleet first: vp run celld:stop-all`,
          );
        }
      }
      const manifest = v.parse(
        manifestSchema,
        JSON.parse(
          aws(["s3", "cp", `s3://${backupBucket}/${manifestKey(id)}`, "-", "--region", region]),
        ),
      );
      if (!execute) {
        console.error("Dry run. Pass --yes to overwrite the fleet bucket with the backup.");
      }
      for (const step of restorePlan({ manifest, bucket, backupBucket, nodes, execute })) {
        if (step.kind === "aws") {
          console.error(step.call.describe);
          aws(step.call.args, { inherit: true });
        } else {
          console.log(`Next, by hand: ${step.describe}\n  ${step.command}`);
        }
      }
      break;
    }
    case "bucket-empty": {
      const which = words[0] === "backups" ? backupBucket : bucket;
      const args = ["s3", "rm", `s3://${which}/`, "--recursive", "--region", region];
      if (!flags.has("--yes")) {
        args.push("--dryrun");
        console.error(`Listing only. Pass --yes to delete every object in ${which}.`);
      }
      ok = spawnSync("aws", args, { stdio: "inherit" }).status === 0;
      break;
    }
  }
  process.exit(ok ? 0 : 1);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
