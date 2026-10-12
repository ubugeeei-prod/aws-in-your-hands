import { objectKey } from "@aih/example-07-uploads/api/src/keys.ts";

import { MemoryBucket } from "../src/memory-bucket.ts";
import { ARCHIVE_TASK, type ArchiveTask, type TaskOptions } from "../src/task.ts";

/** Two buckets on one clock that moves a second with every write. */
export function world() {
  let tick = Date.parse("2026-10-13T00:00:00Z");
  const now = () => new Date((tick += 1000));
  return { source: new MemoryBucket(now), archive: new MemoryBucket(now) };
}

// Keys in the shape chapter 07 gives its attachments.
export const key = (owner: string, attachmentId: string): string =>
  objectKey({ owner, noteId: "n1", attachmentId });

export const taskWith = (
  options: Partial<TaskOptions> = {},
  filters: Partial<Pick<ArchiveTask, "includes" | "excludes">> = {},
): ArchiveTask => ({
  ...ARCHIVE_TASK,
  ...filters,
  options: { ...ARCHIVE_TASK.options, ...options },
});

export const text = (bucket: MemoryBucket, objectKeyName: string): string | undefined => {
  const body = bucket.get(objectKeyName);
  return body === undefined ? undefined : new TextDecoder().decode(body);
};
