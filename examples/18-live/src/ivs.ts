import { GetStreamCommand, GetStreamKeyCommand, type IvsClient, StopStreamCommand } from "@aws-sdk/client-ivs";
import { z } from "zod";
import { type GetStreamOutcome, interpretGetStream, type StreamStatus } from "./stream.ts";

const errorName = (error: unknown): string => (error instanceof Error ? error.name : "UnknownError");

// #region get-stream
export async function getStreamStatus(client: IvsClient, channelArn: string): Promise<StreamStatus> {
  let outcome: GetStreamOutcome;
  try {
    outcome = { kind: "response", stream: (await client.send(new GetStreamCommand({ channelArn }))).stream };
  } catch (error) {
    outcome = { kind: "error", name: errorName(error) };
  }
  return interpretGetStream(outcome);
}
// #endregion get-stream

const streamKeySchema = z.object({ value: z.string().regex(/^sk_/) });

/** The secret itself. Callers decide whether it may reach a terminal. */
export async function getStreamKeyValue(client: IvsClient, streamKeyArn: string): Promise<string> {
  const response = await client.send(new GetStreamKeyCommand({ arn: streamKeyArn }));
  return streamKeySchema.parse(response.streamKey).value;
}

/** Disconnects the encoder. Returns false when nothing was live. */
export async function stopStream(client: IvsClient, channelArn: string): Promise<boolean> {
  try {
    await client.send(new StopStreamCommand({ channelArn }));
    return true;
  } catch (error) {
    if (errorName(error) === "ChannelNotBroadcasting") {
      return false;
    }
    throw error;
  }
}
