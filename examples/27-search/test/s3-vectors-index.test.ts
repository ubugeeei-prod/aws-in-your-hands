import {
  DeleteVectorsCommand,
  ListVectorsCommand,
  PutVectorsCommand,
  QueryVectorsCommand,
} from "@aws-sdk/client-s3vectors";
import { describe, expect, it } from "vite-plus/test";

import { createS3VectorsIndex } from "../src/s3-vectors-index.ts";

const ARN = "arn:aws:s3vectors:ap-northeast-1:111122223333:bucket/aih-search-notes/index/notes";

/** Records every command and answers from a queue. No network. */
function fakeClient(answers: unknown[] = []) {
  const sent: { name: string; input: Record<string, unknown> }[] = [];
  const client = {
    send: async (command: { constructor: { name: string }; input: unknown }) => {
      sent.push({
        name: command.constructor.name,
        input: command.input as Record<string, unknown>,
      });
      return answers.shift() ?? {};
    },
  };
  return { sent, index: createS3VectorsIndex(client as never, ARN) };
}

const entry = (n: number) => ({
  key: `alice/n1/${n}`,
  vector: [1, 0, 0],
  owner: "alice",
  noteId: "n1",
  version: 2,
  passage: n,
});

describe("the S3 Vectors adapter", () => {
  it("asks only for the caller's vectors, with their metadata and distance", async () => {
    const { sent, index } = fakeClient([{ vectors: [] }]);
    await index.query({ vector: [1, 0, 0], owner: "alice", topK: 30 });
    expect(sent).toEqual([
      {
        name: QueryVectorsCommand.name,
        input: {
          indexArn: ARN,
          queryVector: { float32: [1, 0, 0] },
          topK: 30,
          filter: { owner: { $eq: "alice" } },
          returnMetadata: true,
          returnDistance: true,
        },
      },
    ]);
  });

  it("drops a hit whose metadata does not say whose it is", async () => {
    const { index } = fakeClient([
      {
        vectors: [
          {
            key: "a",
            distance: 0.1,
            metadata: { owner: "alice", noteId: "n1", version: 2, passage: 0 },
          },
          { key: "b", distance: 0.2, metadata: { noteId: "n1", version: 2, passage: 0 } },
          {
            key: "c",
            distance: 0.3,
            metadata: { owner: "alice", noteId: "n1", version: "2", passage: 0 },
          },
          { key: "d", metadata: { owner: "alice", noteId: "n1", version: 2, passage: 0 } },
          { key: "e", distance: 0.4 },
        ],
      },
    ]);
    const hits = await index.query({ vector: [1, 0, 0], owner: "alice", topK: 30 });
    expect(hits).toEqual([
      { key: "a", distance: 0.1, owner: "alice", noteId: "n1", version: 2, passage: 0 },
    ]);
  });

  it("stores the four values the search checks, and no text", async () => {
    const { sent, index } = fakeClient();
    await index.put([entry(0)]);
    expect(sent[0]).toEqual({
      name: PutVectorsCommand.name,
      input: {
        indexArn: ARN,
        vectors: [
          {
            key: "alice/n1/0",
            data: { float32: [1, 0, 0] },
            metadata: { owner: "alice", noteId: "n1", version: 2, passage: 0 },
          },
        ],
      },
    });
  });

  it("splits writes and deletes at the 500 a call may carry", async () => {
    const { sent, index } = fakeClient();
    await index.put(Array.from({ length: 501 }, (_, n) => entry(n)));
    await index.delete(Array.from({ length: 1_000 }, (_, n) => `k${n}`));
    expect(sent.map((call) => call.name)).toEqual([
      PutVectorsCommand.name,
      PutVectorsCommand.name,
      DeleteVectorsCommand.name,
      DeleteVectorsCommand.name,
    ]);
    expect(sent[1]?.input["vectors"]).toHaveLength(1);
    expect(sent[3]?.input["keys"]).toHaveLength(500);
  });

  it("lists every page, and marks unreadable entries so that a reconcile removes them", async () => {
    const { sent, index } = fakeClient([
      {
        vectors: [{ key: "a", metadata: { owner: "alice", noteId: "n1", version: 2, passage: 0 } }],
        nextToken: "more",
      },
      { vectors: [{ key: "junk", metadata: { owner: 7 } }] },
    ]);
    const listed = [];
    for await (const item of index.list()) {
      listed.push(item);
    }
    expect(listed).toEqual([
      { key: "a", owner: "alice", noteId: "n1", version: 2, passage: 0 },
      { key: "junk", owner: "", noteId: "", version: 0, passage: 0 },
    ]);
    expect(sent.map((call) => [call.name, call.input["nextToken"]])).toEqual([
      [ListVectorsCommand.name, undefined],
      [ListVectorsCommand.name, "more"],
    ]);
  });
});
