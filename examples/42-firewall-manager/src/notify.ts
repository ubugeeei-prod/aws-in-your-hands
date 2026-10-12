import { type Notice, subjectLine, summarize } from "./finding.ts";

// #region notify
export type NotifyDeps = {
  publish: (subject: string, body: string) => Promise<void>;
  log: (entry: Record<string, unknown>) => void;
};

/**
 * One finding in, one message out. An event this code cannot read is published too, as
 * what it is: a retry cannot fix a changed shape, and silence would look like compliance.
 */
export function createNotifier(deps: NotifyDeps) {
  return async (event: unknown): Promise<{ published: number }> => {
    const summary = summarize(event);
    const notices: Notice[] = summary.ok
      ? summary.notices
      : [
          {
            status: "unstated",
            subject: subjectLine("[unreadable] A Firewall Manager finding could not be read"),
            body: ["The event did not have the expected shape:", ...summary.problems].join("\n"),
          },
        ];
    if (!summary.ok) {
      deps.log({ level: "error", message: "unreadable finding event", problems: summary.problems });
    }
    for (const notice of notices) {
      await deps.publish(notice.subject, notice.body);
      deps.log({ level: "info", message: "published", status: notice.status });
    }
    return { published: notices.length };
  };
}
// #endregion notify
