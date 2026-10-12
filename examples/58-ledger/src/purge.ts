// #region plan
export type HeldVersion = {
  key: string;
  versionId: string;
  deleteMarker: boolean;
  /** When the lock on this version ends. Absent on delete markers and unlocked versions. */
  retainUntil?: Date;
};

/** Which versions can be deleted now without bypassing anything, and which must wait. */
export function purgePlan(versions: HeldVersion[], now: Date) {
  const locked = versions.filter(
    (version) => version.retainUntil !== undefined && version.retainUntil > now,
  );
  return {
    deletable: versions.filter((version) => !locked.includes(version)),
    locked,
    /** The bucket can be deleted only once this moment has passed. */
    emptyAfter: locked
      .map((version) => version.retainUntil as Date)
      .toSorted((a, b) => b.getTime() - a.getTime())[0],
  };
}
// #endregion plan
