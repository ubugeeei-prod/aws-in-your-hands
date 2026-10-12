import type { Note } from "@aih/example-05-dynamodb/src/contract.ts";
import type { Inspection } from "@aih/example-08-async/src/inspection.ts";

export const OWNER = "user-1";

type Image = Record<string, { S: string } | { N: string }>;

/** A plain item in DynamoDB's notation, the way a stream record carries it. */
export const marshal = (item: Record<string, string | number>): Image =>
  Object.fromEntries(
    Object.entries(item).map(([name, value]) => [
      name,
      typeof value === "number" ? { N: String(value) } : { S: value },
    ]),
  );

export const note = (id: string, version = 1): Note => ({
  id,
  title: "Shopping",
  body: "milk",
  version,
  createdAt: "2026-10-12T00:00:00.000Z",
  updatedAt: `2026-10-12T00:0${version}:00.000Z`,
});

export const inspection = (verdict: "ok" | "rejected"): Inspection => ({
  noteId: "n1",
  attachmentId: "a1",
  sequencer: "000000000000000055AED6DCD90281E5",
  eTag: "d41d8cd98f00b204e9800998ecf8427e",
  size: 170,
  declaredType: "image/png",
  verdict,
  ...(verdict === "rejected" ? { reason: "not_an_image" as const } : { width: 3, height: 2 }),
  inspectedAt: "2026-10-12T00:05:00.000Z",
});

let sequence = 0;

/** A stream record. Every call gets a new eventID, as every record in a stream has. */
export function streamRecord(
  eventName: "INSERT" | "MODIFY" | "REMOVE",
  sk: string,
  images: { old?: Record<string, string | number>; new?: Record<string, string | number> },
  owner = OWNER,
) {
  sequence += 1;
  const keys = { pk: `OWNER#${owner}`, sk };
  return {
    eventID: `stream-record-${sequence}`,
    eventName,
    eventVersion: "1.1",
    eventSource: "aws:dynamodb",
    awsRegion: "ap-northeast-1",
    dynamodb: {
      ApproximateCreationDateTime: 1_791_763_200,
      Keys: marshal(keys),
      ...(images.new === undefined ? {} : { NewImage: marshal({ ...keys, ...images.new }) }),
      ...(images.old === undefined ? {} : { OldImage: marshal({ ...keys, ...images.old }) }),
      SequenceNumber: String(sequence),
      SizeBytes: 100,
      StreamViewType: "NEW_AND_OLD_IMAGES",
    },
  };
}

export const noteInserted = (id: string, owner = OWNER) =>
  streamRecord("INSERT", `NOTE#${id}`, { new: note(id) }, owner);
export const noteModified = (id: string, from: number, to: number, owner = OWNER) =>
  streamRecord("MODIFY", `NOTE#${id}`, { old: note(id, from), new: note(id, to) }, owner);
export const noteRemoved = (id: string, version = 1, owner = OWNER) =>
  streamRecord("REMOVE", `NOTE#${id}`, { old: note(id, version) }, owner);
export const inspectionWritten = (verdict: "ok" | "rejected") =>
  streamRecord("INSERT", "INSPECTION#n1#a1", { new: inspection(verdict) });
