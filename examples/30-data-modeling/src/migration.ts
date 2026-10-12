import * as v from "valibot";

import {
  attachmentSk,
  INDEX_PK,
  INDEX_SK,
  isNoteSk,
  parseLegacyAttachmentSk,
  recentSk,
} from "./keys.ts";
import { taggedNoteSchema } from "./model.ts";
import type { Item, Key, Table, Write } from "./table.ts";

// #region plan
/**
 * What one stored item still needs to have the new shape. Nothing for an item
 * that already has it, so the backfill can be run as often as it takes.
 */
export function planBackfill(item: Item): Write[] {
  const { pk, sk, ...rest } = item;

  if (isNoteSk(sk) && item[INDEX_PK] === undefined) {
    const note = v.safeParse(taggedNoteSchema, rest);
    if (!note.success) {
      return [];
    }
    return [
      {
        kind: "update",
        key: { pk, sk },
        set: { [INDEX_PK]: pk, [INDEX_SK]: recentSk(note.output.updatedAt, note.output.id) },
        // If the app saved the note since it was scanned, the app already wrote these two.
        condition: { kind: "equals", attribute: "version", value: note.output.version },
      },
    ];
  }

  const legacy = parseLegacyAttachmentSk(sk);
  if (legacy !== undefined) {
    return [
      // Still there when the copy is written. Without this, an attachment
      // deleted after the scan would come back under its new key.
      { kind: "check", key: { pk, sk }, condition: { kind: "exists" } },
      {
        kind: "put",
        item: { ...rest, pk, sk: attachmentSk(legacy.noteId, legacy.id) },
        condition: { kind: "not_exists" },
      },
    ];
  }
  return [];
}
// #endregion plan

// #region backfill
export type BackfillReport = {
  scanned: number;
  written: number;
  /** Already moved, or changed by the app after the scan saw it. */
  skipped: number;
  /** Where to resume. Undefined once the whole table has been read. */
  next: Key | undefined;
};

export async function backfill(
  table: Table,
  options: { pageSize: number; after?: Key | undefined; maxPages?: number; dryRun?: boolean },
): Promise<BackfillReport> {
  const report: BackfillReport = { scanned: 0, written: 0, skipped: 0, next: options.after };
  for (let page = 0; page < (options.maxPages ?? Number.POSITIVE_INFINITY); page++) {
    const { items, last } = await table.scan({
      limit: options.pageSize,
      ...(report.next === undefined ? {} : { after: report.next }),
    });
    for (const item of items) {
      report.scanned++;
      const writes = planBackfill(item);
      const [only] = writes;
      if (only === undefined) {
        continue;
      }
      if (options.dryRun === true) {
        report.written++;
        continue;
      }
      const done =
        writes.length === 1 && only.kind !== "check"
          ? (await table.write(only)) === "ok"
          : (await table.transact(writes)).ok;
      report.written += done ? 1 : 0;
      report.skipped += done ? 0 : 1;
    }
    // Saved by the caller after every page: a run that stops resumes from here.
    report.next = last;
    if (last === undefined) {
      break;
    }
  }
  return report;
}
// #endregion backfill

// #region verify
/** What the next phase may not find. Empty before reads are switched to the new keys. */
export async function verify(table: Table, pageSize = 100): Promise<Key[]> {
  const missing: Key[] = [];
  let after: Key | undefined;
  do {
    const { items, last } = await table.scan({
      limit: pageSize,
      ...(after === undefined ? {} : { after }),
    });
    for (const item of items) {
      if (isNoteSk(item.sk) && item[INDEX_PK] === undefined) {
        missing.push({ pk: item.pk, sk: item.sk });
      }
      const legacy = parseLegacyAttachmentSk(item.sk);
      if (legacy !== undefined) {
        const twin = { pk: item.pk, sk: attachmentSk(legacy.noteId, legacy.id) };
        if ((await table.get(twin, { consistent: true })) === undefined) {
          missing.push(twin);
        }
      }
    }
    after = last;
  } while (after !== undefined);
  return missing;
}
// #endregion verify

// #region contract
/** The last step: removes each old attachment item whose copy exists. Only once nothing reads the old keys. */
export async function removeLegacy(
  table: Table,
  options: { pageSize: number; dryRun?: boolean },
): Promise<{ removed: number; kept: number }> {
  const result = { removed: 0, kept: 0 };
  let after: Key | undefined;
  do {
    const { items, last } = await table.scan({
      limit: options.pageSize,
      ...(after === undefined ? {} : { after }),
    });
    for (const item of items) {
      const legacy = parseLegacyAttachmentSk(item.sk);
      if (legacy === undefined) {
        continue;
      }
      const twin = { pk: item.pk, sk: attachmentSk(legacy.noteId, legacy.id) };
      const done =
        options.dryRun === true
          ? (await table.get(twin, { consistent: true })) !== undefined
          : (
              await table.transact([
                { kind: "check", key: twin, condition: { kind: "exists" } },
                { kind: "delete", key: { pk: item.pk, sk: item.sk } },
              ])
            ).ok;
      result.removed += done ? 1 : 0;
      result.kept += done ? 0 : 1;
    }
    after = last;
  } while (after !== undefined);
  return result;
}
// #endregion contract
