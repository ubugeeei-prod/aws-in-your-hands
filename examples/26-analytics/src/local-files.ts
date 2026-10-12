import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import type { LakeObject } from "./lake.ts";

/** Writes an object under `directory`, at the path its key spells. */
export function saveObject(directory: string, object: LakeObject): string {
  const path = join(directory, object.key);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, object.bytes);
  return path;
}

/** Every file under `directory`, with the key it would have in a bucket. */
export function loadObjects(directory: string): LakeObject[] {
  let entries;
  try {
    entries = readdirSync(directory, { recursive: true, withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .toSorted()
    .map((path) => ({
      key: relative(directory, path).split("\\").join("/"),
      bytes: readFileSync(path),
    }));
}
