import { handle } from "./events.ts";

// #region handler
// Invoked by the EventBridge rule. It writes one JSON line and holds no permission but logging.
export async function handler(event: unknown): Promise<void> {
  const { ok, line } = handle(event);
  console.log(JSON.stringify(ok ? line : { ...line, event }));
}
// #endregion handler
