// #region expired
export type RunningTask = { taskArn: string; createdAt: Date };

/**
 * The tasks that have lived past the limit. A runner whose job was cancelled while it
 * was starting waits for a job that never comes, and Fargate has no time limit of its own.
 */
export function expired(tasks: readonly RunningTask[], now: Date, maxSeconds: number): string[] {
  return tasks
    .filter((task) => now.getTime() - task.createdAt.getTime() > maxSeconds * 1000)
    .map((task) => task.taskArn);
}
// #endregion expired
