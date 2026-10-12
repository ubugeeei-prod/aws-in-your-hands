import { decide, type Decision } from "./execution-event.ts";
import type { Notifier } from "./notifier.ts";

export type AlertDeps = {
  taskArn: string;
  notifier: Notifier;
  log: (line: Record<string, unknown>) => void;
};

// #region handle
export async function handleExecutionEvent(event: unknown, deps: AlertDeps): Promise<Decision> {
  const decision = decide(event, deps.taskArn);
  deps.log({ level: decision.action === "alert" ? "error" : "info", ...decision });
  if (decision.action === "alert") {
    // A throw here makes Lambda retry the asynchronous invocation, so a failed
    // publish is tried again instead of being lost with the event.
    await deps.notifier.notify(`Archive copy: ${decision.reason}`, decision.message);
  }
  return decision;
}
// #endregion handle
