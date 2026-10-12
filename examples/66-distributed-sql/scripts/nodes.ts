// vp run distsql:<action>
//   node scripts/nodes.ts <action> [node]
//
// Everything that talks to the deployed nodes. Commands reach them through
// Systems Manager Run Command; nothing here opens a port or uses SSH.
// Needs AWS credentials and a deployed AihDistSql stack with `-c nodes=3`.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import * as v from "valibot";

import {
  commandResultArgs,
  instanceIdSchema,
  invocationSchema,
  sendCommandArgs,
  sessionArgs,
  sentCommandSchema,
  isFinished,
  succeeded,
  uploadArgs,
} from "@aih/example-23-ec2/src/remote.ts";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { caArgs, extensionsFor, nodeAddressSchema, signArgs } from "../src/certs.ts";
import { DISTSQL_STACK } from "../src/config.ts";
import { ARTIFACT_TARGET, artifactKey } from "../src/machine.ts";
import { type Addresses, fullyReplicated, healthSchema, nodeCommands } from "../src/remote.ts";
import { NODE_NAMES, type NodeName } from "../src/topology.ts";
import { assetOf } from "../src/yugabyte.ts";

const ACTIONS = [
  "status",
  "logs",
  "health",
  "artifact",
  "install",
  "certs",
  "configure",
  "start",
  "stop",
  "session",
] as const;
type Action = (typeof ACTIONS)[number];
const OBSERVING: readonly Action[] = ["status", "logs", "health"];

const [action, nodeText] = process.argv.slice(2);
const isAction = (value: string | undefined): value is Action =>
  (ACTIONS as readonly string[]).includes(value ?? "");
if (!isAction(action)) {
  console.error(`usage: nodes.ts <${ACTIONS.join("|")}> [a|b|c]`);
  process.exit(64);
}
const only = v.parse(v.optional(v.picklist(NODE_NAMES)), nodeText);
const targets: readonly NodeName[] = only === undefined ? NODE_NAMES : [only];
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function aws(args: string[]): string {
  const result = spawnSync("aws", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  if (result.status !== 0) {
    throw new Error(
      `aws ${args.slice(0, 2).join(" ")} exited with ${result.status ?? result.signal}`,
    );
  }
  return result.stdout ?? "";
}

const describedSchema = v.object({
  Reservations: v.array(
    v.object({ Instances: v.array(v.object({ PrivateIpAddress: nodeAddressSchema })) }),
  ),
});

try {
  const { target } = await preflight({
    access: OBSERVING.includes(action) ? "observe" : "mutate",
    action: `distsql ${action}`,
    stack: DISTSQL_STACK,
  });
  const { region } = target;
  const outputs = await readStackOutputs(process.cwd(), DISTSQL_STACK, region);
  if (requireOutput(outputs, "NodeCount") !== "3") {
    throw new Error("The stack has no nodes. Deploy it with `-c nodes=3` first.");
  }
  const bucket = requireOutput(outputs, "BucketName");
  const instanceOf = (node: NodeName): string =>
    v.parse(instanceIdSchema, requireOutput(outputs, `Node${node.toUpperCase()}InstanceId`));

  /** Sends shell lines to one node, waits, and returns what it printed. Throws when the node says no. */
  async function run(node: NodeName, lines: string[], comment: string): Promise<string> {
    const instanceId = instanceOf(node);
    const sent = v.parse(
      sentCommandSchema,
      JSON.parse(aws(sendCommandArgs({ instanceId, region, commands: lines, comment }))),
    );
    const commandId = sent.Command.CommandId;
    for (let poll = 0; poll < 450; poll += 1) {
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
      process.stderr.write(invocation.StandardErrorContent);
      if (!succeeded(invocation)) {
        throw new Error(`[${node}] ${comment}: ${invocation.Status}`);
      }
      return invocation.StandardOutputContent;
    }
    throw new Error(`[${node}] ${comment} did not finish in time`);
  }

  function addresses(): Addresses {
    const addressOf = (node: NodeName): string => {
      const described = v.parse(
        describedSchema,
        JSON.parse(
          aws([
            "ec2",
            "describe-instances",
            "--instance-ids",
            instanceOf(node),
            "--region",
            region,
            "--output",
            "json",
          ]),
        ),
      );
      const address = described.Reservations[0]?.Instances[0]?.PrivateIpAddress;
      if (address === undefined) {
        throw new Error(`node ${node} has no private address`);
      }
      return address;
    };
    return { a: addressOf("a"), b: addressOf("b"), c: addressOf("c") };
  }

  switch (action) {
    case "status":
      for (const node of targets) {
        console.log(`-- node ${node}\n${await run(node, nodeCommands.status(), "status")}`);
      }
      break;
    case "logs":
      for (const node of targets) {
        for (const name of ["master", "tserver"] as const) {
          console.log(
            `-- node ${node}, yb-${name}\n${await run(node, nodeCommands.logs(name), "logs")}`,
          );
        }
      }
      break;
    case "health": {
      const node = targets[0] ?? "a";
      const health = v.parse(
        healthSchema,
        JSON.parse(await run(node, nodeCommands.health(addresses()[node]), "health")),
      );
      console.log(JSON.stringify(health));
      console.log(
        fullyReplicated(health)
          ? "fully replicated"
          : "NOT fully replicated: do not stop another node",
      );
      process.exitCode = fullyReplicated(health) ? 0 : 1;
      break;
    }
    case "artifact": {
      const file = `.yugabyte/download/${assetOf(ARTIFACT_TARGET).file}`;
      if (!existsSync(file)) {
        throw new Error(`${file} is not here. Run \`vp run distsql:fetch --nodes\` first.`);
      }
      aws(uploadArgs({ file, bucket, key: artifactKey(), region }));
      console.log(`s3://${bucket}/${artifactKey()}`);
      break;
    }
    case "install":
      for (const node of targets) {
        process.stdout.write(await run(node, nodeCommands.install(bucket), "install"));
      }
      break;
    // #region certs
    case "certs": {
      // The CA's key stays on this machine. Each node's key is made on that node and stays there.
      const caDirectory = ".yugabyte/ca-aws";
      mkdirSync(caDirectory, { recursive: true });
      if (!existsSync(`${caDirectory}/ca.key`)) {
        execFileSync("openssl", caArgs(caDirectory), { stdio: ["ignore", "ignore", "inherit"] });
      }
      const ca = readFileSync(`${caDirectory}/ca.crt`).toString("base64");
      const known = addresses();
      for (const node of targets) {
        const request = `${caDirectory}/${node}.csr`;
        const extensions = `${caDirectory}/${node}.ext`;
        const certificate = `${caDirectory}/${node}.crt`;
        writeFileSync(request, await run(node, nodeCommands.csr(), "signing request"));
        writeFileSync(extensions, extensionsFor(known[node]));
        execFileSync("openssl", signArgs({ caDirectory, request, extensions, out: certificate }), {
          stdio: ["ignore", "ignore", "inherit"],
        });
        const signed = readFileSync(certificate).toString("base64");
        process.stdout.write(
          await run(node, nodeCommands.certificate(signed, ca), "install certificate"),
        );
      }
      break;
    }
    // #endregion certs
    case "configure": {
      const known = addresses();
      for (const node of targets) {
        process.stdout.write(await run(node, nodeCommands.configure(node, known), "configure"));
      }
      break;
    }
    case "start":
      // Masters first, on every node: a tablet server registers with them.
      for (const name of ["master", "tserver"] as const) {
        for (const node of targets) {
          console.log(
            `[${node}] yb-${name}: ${(await run(node, nodeCommands.start(name), "start")).trim()}`,
          );
        }
      }
      break;
    case "session":
      if (only === undefined) {
        throw new Error("session takes one node: a, b, or c");
      }
      // An interactive shell on the node. Needs the Session Manager plugin, which the devShell lacks.
      spawnSync("aws", sessionArgs({ instanceId: instanceOf(only), region }), { stdio: "inherit" });
      break;
    case "stop":
      if (only === undefined) {
        throw new Error(
          "stop takes one node: a, b, or c. Stopping two ends the cluster's service.",
        );
      }
      for (const name of ["tserver", "master"] as const) {
        process.stdout.write(await run(only, nodeCommands.stop(name), "stop"));
      }
      break;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
