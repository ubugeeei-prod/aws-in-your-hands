// vp run firecracker:plan [config.json] [--socket path] [--snapshot]
//
// Prints the requests a boot would send, in order, as curl commands. Sends nothing:
// no socket is opened, so this runs on any machine.

import { parseArgs } from "../src/args.ts";
import { bootSequence, renderCurl, snapshotSequence } from "../src/requests.ts";

try {
  const { config, socketPath, snapshot } = parseArgs(process.argv.slice(2));
  console.log("# Boot. Nothing below is sent by this command.");
  for (const request of bootSequence(config)) {
    console.log(`# ${request.operationId}, expects ${request.expect}`);
    console.log(renderCurl(request, socketPath));
  }
  if (snapshot) {
    console.log("\n# Full snapshot of the running microVM.");
    const files = { snapshotPath: "work/snapshot.state", memFilePath: "work/snapshot.mem" };
    for (const request of snapshotSequence(files)) {
      console.log(`# ${request.operationId}, expects ${request.expect}`);
      console.log(renderCurl(request, socketPath));
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 64;
}
