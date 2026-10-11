// #region id
// Time first (nine base-36 digits of milliseconds, enough until the year 5188),
// so IDs sort in creation order and "newest first" needs no index.
export function newNoteId(now: Date, randomSuffix: string): string {
  return `${now.getTime().toString(36).padStart(9, "0")}${randomSuffix}`;
}
// #endregion id
