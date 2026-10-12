// vp run calls:end          lists the rooms that have a meeting on record (reads AWS)
// vp run calls:end --yes    ends those meetings (changes AWS)
//   node scripts/end-meetings.ts [--yes]
//
// A meeting is not part of the stack, and Chime has no call that lists meetings. The table
// is the only place their IDs are, so run this before `calls:infra:destroy`.

import { parseArgs } from "node:util";

import { ChimeSDKMeetingsClient } from "@aws-sdk/client-chime-sdk-meetings";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, paginateScan } from "@aws-sdk/lib-dynamodb";
import * as v from "valibot";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { createChimeMeetings } from "../api/src/chime-meetings.ts";
import { DynamoDbRoomStore } from "../api/src/dynamodb-room-store.ts";

const STACK = "AihCalls";
const { values } = parseArgs({ options: { yes: { type: "boolean", default: false } } });
const rowSchema = v.object({ id: v.string(), meetingId: v.string() });

try {
  const { target } = await preflight({
    access: values.yes ? "mutate" : "observe",
    action: "end every meeting the rooms table knows",
    stack: STACK,
  });
  const outputs = await readStackOutputs(process.cwd(), STACK, target.region);
  const tableName = requireOutput(outputs, "TableName");
  const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: target.region }));

  const rooms: v.InferOutput<typeof rowSchema>[] = [];
  const pages = paginateScan(
    { client: dynamodb },
    {
      TableName: tableName,
      FilterExpression: "begins_with(pk, :room) AND attribute_exists(meetingId)",
      ExpressionAttributeValues: { ":room": "ROOM#" },
      ProjectionExpression: "id, meetingId",
    },
  );
  for await (const page of pages) {
    rooms.push(...(page.Items ?? []).map((item) => v.parse(rowSchema, item)));
  }
  for (const room of rooms) {
    console.log(`room ${room.id}: meeting ${room.meetingId}`);
  }
  console.log(`${rooms.length} room(s) with a meeting on record`);
  if (!values.yes) {
    console.log(
      "Nothing was ended. A meeting on record may have ended by itself already. Pass --yes to end them.",
    );
    process.exit(0);
  }

  const meetings = createChimeMeetings(
    new ChimeSDKMeetingsClient({ region: target.region }),
    requireOutput(outputs, "MediaRegion"),
  );
  const store = new DynamoDbRoomStore(dynamodb, tableName);
  for (const room of rooms) {
    // Chime first, as in the API: the ID is forgotten only once the meeting is gone.
    await meetings.deleteMeeting(room.meetingId);
    await store.setMeeting(room.id, room.meetingId, undefined);
    console.log(`ended ${room.meetingId}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
