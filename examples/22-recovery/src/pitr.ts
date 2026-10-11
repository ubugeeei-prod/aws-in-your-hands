// #region plan
export type ContinuousBackups = {
  enabled: boolean;
  earliestRestorable: Date | undefined;
  latestRestorable: Date | undefined;
};

export type TableRestorePlan =
  | {
      ok: true;
      targetTableName: string;
      /** The input of RestoreTableToPointInTime. */
      input: {
        SourceTableName: string;
        TargetTableName: string;
        RestoreDateTime?: Date;
        UseLatestRestorableTime?: boolean;
      };
    }
  | { ok: false; reason: string };

/** Marks a table as made by this drill, and by nothing else. cleanup refuses names without it. */
export const RESTORED_MARK = "-restored-";

const stamp = (date: Date): string =>
  date
    .toISOString()
    .replaceAll(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");

/**
 * Point-in-time recovery never writes into the source table: it makes a new
 * one. The name carries the time of the request, so that two attempts never
 * collide and every leftover is recognizable.
 */
export function planTableRestore(options: {
  sourceTableName: string;
  backups: ContinuousBackups;
  /** Omitted: the latest point DynamoDB can restore to, usually about five minutes ago. */
  at?: Date | undefined;
  now: Date;
}): TableRestorePlan {
  const { sourceTableName, backups, at, now } = options;
  if (sourceTableName.includes(RESTORED_MARK)) {
    return { ok: false, reason: `${sourceTableName} is itself a restored table. Restore from the table it came from.` };
  }
  if (!backups.enabled) {
    return {
      ok: false,
      reason: `Point-in-time recovery is not enabled on ${sourceTableName}. There is nothing to restore from.`,
    };
  }
  const targetTableName = `${sourceTableName}${RESTORED_MARK}${stamp(now)}`;
  if (targetTableName.length > 255) {
    return { ok: false, reason: "The name of the restored table would be longer than 255 characters." };
  }
  if (at === undefined) {
    return {
      ok: true,
      targetTableName,
      input: { SourceTableName: sourceTableName, TargetTableName: targetTableName, UseLatestRestorableTime: true },
    };
  }
  const { earliestRestorable, latestRestorable } = backups;
  if (
    earliestRestorable === undefined ||
    latestRestorable === undefined ||
    at < earliestRestorable ||
    at > latestRestorable
  ) {
    return {
      ok: false,
      reason:
        `${at.toISOString()} is outside what can be restored: ` +
        `${earliestRestorable?.toISOString() ?? "unknown"} to ${latestRestorable?.toISOString() ?? "unknown"}.`,
    };
  }
  return {
    ok: true,
    targetTableName,
    input: { SourceTableName: sourceTableName, TargetTableName: targetTableName, RestoreDateTime: at },
  };
}
// #endregion plan
