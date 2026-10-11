// vp run stream:key [--show]
//   node scripts/key.ts
//
// Prints what to enter in the encoder. The stream key itself is printed only
// with --show, and only to this terminal: it is never written to a file.
import { parseArgs } from "node:util";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";
import { IvsClient } from "@aws-sdk/client-ivs";
import { channelSettings, maxVideoKbps, rtmpsServer } from "../src/channel.ts";
import { getStreamKeyValue } from "../src/ivs.ts";

const { values } = parseArgs({ options: { show: { type: "boolean", default: false } } });

try {
  const { target } = await preflight({
    access: "observe",
    action: values.show ? "read the stream key (a secret)" : "read the ingest settings",
    stack: "AihLive",
  });
  const outputs = await readStackOutputs(process.cwd(), "AihLive", target.region);
  const streamKeyArn = requireOutput(outputs, "StreamKeyArn");

  console.log(`server:      ${rtmpsServer(requireOutput(outputs, "IngestEndpoint"))}`);
  console.log(
    `video:       H.264, keyframe every 2 s, at most ${maxVideoKbps(channelSettings.type, { width: 1280, height: 720 })} kbps at 720p`,
  );
  console.log(`stream key:  ${streamKeyArn}`);
  if (values.show) {
    const value = await getStreamKeyValue(new IvsClient({ region: target.region }), streamKeyArn);
    console.log(`             ${value}`);
    console.log("Anyone who has this value can broadcast to the channel. Clear your scrollback when you are done.");
  } else {
    console.log("             (value hidden; run `vp run stream:key --show` to print it once)");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
