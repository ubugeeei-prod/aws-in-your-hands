// #region id
// Note IDs sort in creation order: nine base-36 digits of the creation time in
// milliseconds, then random characters. The table's sort key is built from the
// ID, so "newest first" is a plain reverse read of the key order and needs no
// index. Nine digits last until the year 5188.
export function newNoteId(now: Date, randomSuffix: string): string {
  return `${now.getTime().toString(36).padStart(9, "0")}${randomSuffix}`;
}
// #endregion id
