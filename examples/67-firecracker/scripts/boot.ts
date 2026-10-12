// vp run firecracker:boot [config.json] [--socket path] [--probe url] [--snapshot]
//
// Sends the boot sequence to a Firecracker process that is already listening on the socket,
// and times the guest's first HTTP answer. Needs Linux with KVM. Nothing here touches AWS.

import { accessSync, constants } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

import { parseArgs } from "../src/args.ts";
import { bootAndMeasure, describeTiming } from "../src/boot.ts";
import { createClient, unixSocketTransport } from "../src/client.ts";
import { snapshotSequence } from "../src/requests.ts";

function refuse(reason: string): never {
  console.error(`firecracker:boot did not run: ${reason}`);
  console.error("vp run firecracker:plan prints the same requests without sending them.");
  process.exit(69);
}

if (process.platform !== "linux") {
  refuse(`Firecracker runs on Linux with KVM, and this is ${process.platform}.`);
}
try {
  accessSync("/dev/kvm", constants.R_OK | constants.W_OK);
} catch {
  refuse("/dev/kvm cannot be read and written by this user.");
}

const { config, socketPath, probeUrl, snapshot } = parseArgs(process.argv.slice(2));
const client = createClient(unixSocketTransport(socketPath));

const before = await client.instance();
console.log(`Firecracker ${await client.version()}, microVM ${before.id}: ${before.state}`);
if (before.state !== "Not started") {
  refuse("this Firecracker process already booted its microVM. Start a new process.");
}

const timing = await bootAndMeasure(config, {
  client,
  probe: async () => {
    try {
      return (await fetch(probeUrl, { signal: AbortSignal.timeout(250) })).ok;
    } catch {
      return false;
    }
  },
  now: () => performance.now(),
  sleep: (ms) => sleep(ms),
});
console.log(describeTiming(timing).join("\n"));

if (snapshot) {
  await client.run(
    snapshotSequence({ snapshotPath: "work/snapshot.state", memFilePath: "work/snapshot.mem" }),
  );
  console.log("snapshot written: work/snapshot.state, work/snapshot.mem");
}
