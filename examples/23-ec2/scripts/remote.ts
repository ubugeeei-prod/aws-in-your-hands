// vp run ec2:<action>
//   node scripts/remote.ts <action> [arguments]
//
// Everything that talks to the deployed instance. There is no SSH here: the
// commands go through Systems Manager Run Command, which the instance polls.
// Each action reads AWS, and most of them change something on the instance.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import * as v from "valibot";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { EC2_STACK, parseEc2Config } from "../src/config.ts";
import { machineFor } from "../src/machine.ts";
import { releaseKey, releaseVersion } from "../src/release.ts";
import {
  commandResultArgs,
  forwardArgs,
  instanceInformationSchema,
  invocationSchema,
  isFinished,
  remoteCommands,
  sendCommandArgs,
  sentCommandSchema,
  sessionArgs,
  succeeded,
  uploadArgs,
} from "../src/remote.ts";

const ACTIONS = [
  "status",
  "release",
  "rollback",
  "smoke",
  "logs",
  "session",
  "forward",
  "unmount",
  "mount",
  "patch-check",
  "patch-apply",
  "releases-empty",
] as const;
type Action = (typeof ACTIONS)[number];

const [action, ...rest] = process.argv.slice(2);
const isAction = (value: string | undefined): value is Action =>
  (ACTIONS as readonly string[]).includes(value ?? "");
if (!isAction(action)) {
  console.error(`usage: remote.ts <${ACTIONS.join("|")}> [arguments]`);
  process.exit(64);
}

const machine = machineFor(parseEc2Config({}));
const commands = remoteCommands(machine);

function aws(args: string[]): string {
  const result = spawnSync("aws", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  if (result.status !== 0) {
    throw new Error(
      `aws ${args.slice(0, 2).join(" ")} exited with ${result.status ?? result.signal}`,
    );
  }
  return result.stdout;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Sends shell lines to the instance, waits, prints what they wrote, and returns whether they succeeded. */
async function run(
  instanceId: string,
  region: string,
  lines: string[],
  comment: string,
): Promise<boolean> {
  const sent = v.parse(
    sentCommandSchema,
    JSON.parse(aws(sendCommandArgs({ instanceId, region, commands: lines, comment }))),
  );
  const commandId = sent.Command.CommandId;
  console.error(`command ${commandId} sent to ${instanceId}`);
  for (let attempt = 0; attempt < 150; attempt += 1) {
    await sleep(2000);
    const poll = spawnSync("aws", commandResultArgs({ commandId, instanceId, region }), {
      encoding: "utf8",
    });
    if (poll.status !== 0) {
      // The invocation takes a moment to exist after the command is accepted.
      continue;
    }
    const invocation = v.parse(invocationSchema, JSON.parse(poll.stdout));
    if (!isFinished(invocation)) {
      continue;
    }
    process.stdout.write(invocation.StandardOutputContent);
    process.stderr.write(invocation.StandardErrorContent);
    console.error(`status: ${invocation.Status}, exit code: ${invocation.ResponseCode ?? "none"}`);
    return succeeded(invocation);
  }
  throw new Error(`command ${commandId} did not finish within five minutes`);
}

try {
  const { target } = await preflight({
    access: action === "status" || action === "logs" ? "observe" : "mutate",
    action: `ec2 ${action}`,
    stack: EC2_STACK,
  });
  const { region } = target;
  const outputs = await readStackOutputs(process.cwd(), EC2_STACK, region);
  const instanceId = requireOutput(outputs, "InstanceId");
  const bucket = requireOutput(outputs, "ReleaseBucketName");
  let ok = true;

  switch (action) {
    case "status": {
      const info = v.parse(
        instanceInformationSchema,
        JSON.parse(
          aws([
            "ssm",
            "describe-instance-information",
            "--filters",
            `Key=InstanceIds,Values=${instanceId}`,
            "--region",
            region,
            "--output",
            "json",
          ]),
        ),
      ).InstanceInformationList[0];
      if (info === undefined) {
        console.log(
          `${instanceId} is not registered with Systems Manager. Check, in this order: the instance is running; ` +
            "it can reach ssm, ssmmessages, and ec2messages (vp run ec2:plan); its role has AmazonSSMManagedInstanceCore.",
        );
        ok = false;
        break;
      }
      console.log(
        `${info.InstanceId}: ${info.PingStatus}, SSM Agent ${info.AgentVersion ?? "?"}, ${info.PlatformName ?? "?"} ${info.PlatformVersion ?? ""}`,
      );
      ok = await run(instanceId, region, commands.status(), "aih ec2:status");
      break;
    }
    case "release": {
      const file = "dist/server.mjs";
      const version = releaseVersion(readFileSync(file), new Date());
      aws(uploadArgs({ file, bucket, key: releaseKey(version), region }));
      console.error(`uploaded ${version}`);
      ok = await run(
        instanceId,
        region,
        commands.release(bucket, version),
        `aih ec2:app:release ${version}`,
      );
      break;
    }
    case "rollback": {
      const version = rest[0];
      if (version === undefined) {
        throw new Error(
          "usage: remote.ts rollback <version>   (a version that ec2:app:release printed earlier)",
        );
      }
      ok = await run(
        instanceId,
        region,
        commands.release(bucket, version),
        `aih ec2:app:rollback ${version}`,
      );
      break;
    }
    case "smoke":
      ok = await run(instanceId, region, commands.smoke(), "aih ec2:smoke");
      break;
    case "logs":
      ok = await run(instanceId, region, commands.logs(), "aih ec2:logs");
      break;
    case "unmount":
      ok = await run(instanceId, region, commands.unmount(), "aih ec2:data:unmount");
      break;
    case "mount":
      ok = await run(instanceId, region, commands.mount(), "aih ec2:data:mount");
      break;
    case "patch-check":
      ok = await run(instanceId, region, commands.patchCheck(), "aih ec2:patch:check");
      break;
    case "patch-apply": {
      const releasever = rest[0];
      if (releasever === undefined) {
        throw new Error(
          "usage: remote.ts patch-apply <releasever>   (from ec2:patch:check, for example 2023.12.20260930)",
        );
      }
      ok = await run(
        instanceId,
        region,
        commands.patchApply(releasever),
        `aih ec2:patch:apply ${releasever}`,
      );
      break;
    }
    case "session":
    case "forward": {
      const args =
        action === "session"
          ? sessionArgs({ instanceId, region })
          : forwardArgs({ instanceId, region, port: machine.port });
      console.error(`$ aws ${args.join(" ")}`);
      ok = spawnSync("aws", args, { stdio: "inherit" }).status === 0;
      break;
    }
    case "releases-empty": {
      const args = ["s3", "rm", `s3://${bucket}/releases/`, "--recursive", "--region", region];
      if (!rest.includes("--yes")) {
        args.push("--dryrun");
        console.error("Listing only. Pass --yes to delete the uploaded releases.");
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
