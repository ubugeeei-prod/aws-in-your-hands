// vp run stream:stop
//   node scripts/stop.ts
//
// Disconnects whatever is broadcasting to the channel (StopStream). An encoder
// set to reconnect will come straight back; to keep it out, deploy with
// `-c streamKey=off`.
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";
import { IvsClient } from "@aws-sdk/client-ivs";
import { stopStream } from "../src/ivs.ts";

try {
  const { target } = await preflight({ access: "mutate", action: "stop the live stream", stack: "AihLive" });
  const channelArn = requireOutput(await readStackOutputs(process.cwd(), "AihLive", target.region), "ChannelArn");
  const stopped = await stopStream(new IvsClient({ region: target.region }), channelArn);
  console.log(stopped ? "StopStream accepted." : "Nothing was live.");
  console.log("Confirm with `vp run stream:status --expect-offline`.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
