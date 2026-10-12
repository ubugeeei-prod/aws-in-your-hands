// #region interface
/**
 * Who is launching the runner for a job. One claim per job: a job that was claimed
 * and launched is never launched again, however many times its delivery arrives.
 */
export type Claims = {
  /** True if the caller now holds the job. False if someone else holds it or it was launched. */
  claim(key: string, now: number): Promise<boolean>;
  /** The launch succeeded. The claim stays, as the record that it happened. */
  complete(key: string, taskArn: string, now: number): Promise<void>;
  /** The launch failed and was undone. The next delivery may try again. */
  release(key: string): Promise<void>;
};
// #endregion interface

export const claimKey = (repository: string, jobId: number): string => `JOB#${repository}#${jobId}`;

type Entry = { state: "launching"; leaseUntil: number } | { state: "launched"; taskArn: string };

// #region memory
/** The same rules as the DynamoDB table, in a Map. Times are seconds. */
export function memoryClaims(leaseSeconds: number): Claims & { entries: Map<string, Entry> } {
  const entries = new Map<string, Entry>();
  return {
    entries,
    async claim(key, now) {
      const held = entries.get(key);
      // A claim whose holder died is free again once its lease has run out.
      if (held !== undefined && !(held.state === "launching" && held.leaseUntil < now)) {
        return false;
      }
      entries.set(key, { state: "launching", leaseUntil: now + leaseSeconds });
      return true;
    },
    async complete(key, taskArn) {
      entries.set(key, { state: "launched", taskArn });
    },
    async release(key) {
      entries.delete(key);
    },
  };
}
// #endregion memory
