import {
  DeleteVectorsCommand,
  ListVectorsCommand,
  PutVectorsCommand,
  QueryVectorsCommand,
  type S3VectorsClient,
} from "@aws-sdk/client-s3vectors";
import * as v from "valibot";

import type { VectorIndex } from "./vector-index.ts";

// #region metadata
// What comes back from the index is outside data, like a row from a table.
const metadataSchema = v.object({
  owner: v.pipe(v.string(), v.minLength(1)),
  noteId: v.pipe(v.string(), v.minLength(1)),
  version: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  passage: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
});
// #endregion metadata

/** PutVectors and DeleteVectors take at most 500 vectors a call. */
const BATCH = 500;

function batches<T>(items: T[]): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += BATCH) {
    result.push(items.slice(start, start + BATCH));
  }
  return result;
}

// #region s3vectors
export function createS3VectorsIndex(
  client: Pick<S3VectorsClient, "send">,
  indexArn: string,
): VectorIndex {
  return {
    async put(entries) {
      for (const batch of batches(entries)) {
        await client.send(
          new PutVectorsCommand({
            indexArn,
            vectors: batch.map(({ key, vector, ...metadata }) => ({
              key,
              data: { float32: vector },
              metadata,
            })),
          }),
        );
      }
    },

    async delete(keys) {
      for (const batch of batches(keys)) {
        await client.send(new DeleteVectorsCommand({ indexArn, keys: batch }));
      }
    },

    async query({ vector, owner, topK }) {
      const result = await client.send(
        new QueryVectorsCommand({
          indexArn,
          queryVector: { float32: vector },
          topK,
          // The first of two checks that keep one owner's notes from another. See search.ts.
          filter: { owner: { $eq: owner } },
          returnMetadata: true,
          returnDistance: true,
        }),
      );
      return (result.vectors ?? []).flatMap((hit) => {
        const metadata = v.safeParse(metadataSchema, hit.metadata);
        // A hit that cannot say whose it is belongs to nobody.
        return hit.key === undefined || hit.distance === undefined || !metadata.success
          ? []
          : [{ key: hit.key, distance: hit.distance, ...metadata.output }];
      });
    },

    async *list() {
      let nextToken: string | undefined;
      do {
        const page = await client.send(
          new ListVectorsCommand({ indexArn, returnMetadata: true, nextToken }),
        );
        for (const entry of page.vectors ?? []) {
          const metadata = v.safeParse(metadataSchema, entry.metadata);
          if (entry.key !== undefined) {
            // Unreadable metadata is listed with an owner nobody has, so a reconcile removes it.
            yield metadata.success
              ? { key: entry.key, ...metadata.output }
              : { key: entry.key, owner: "", noteId: "", version: 0, passage: 0 };
          }
        }
        nextToken = page.nextToken;
      } while (nextToken !== undefined);
    },
  };
}
// #endregion s3vectors
