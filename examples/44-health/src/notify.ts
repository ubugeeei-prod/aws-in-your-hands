import { classify } from "./classify.ts";
import { parseHealthEvent } from "./event.ts";
import { decide, type Entry, keyOf, type Ledger, type Version, versionOf } from "./ledger.ts";
import { type Message, render, renderUnreadable } from "./message.ts";

// #region deps
export type Deps = {
  ledger: Ledger;
  publish(message: Message): Promise<void>;
  now(): number;
  log(line: Record<string, unknown>): void;
  services: readonly string[];
};

export type Outcome =
  | { action: "sent"; change: string; message: Message }
  | { action: "ignored" | "skipped" | "advanced"; why: string };
// #endregion deps

const ATTEMPTS = 3;

// #region announce
/** Claims the notification in the ledger, sends it, then marks it sent. In that order. */
async function announce(
  deps: Deps,
  key: string,
  version: Version,
  message: (change: "new" | "update" | "closed" | "retry") => Message,
): Promise<Outcome> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const stored = await deps.ledger.read(key);
    const now = deps.now();
    const decision = decide(stored, version, now);
    if (decision.do === "skip") {
      return { action: "skipped", why: decision.why };
    }
    const claim: Entry = {
      ...version,
      notified: decision.do === "advance",
      claimedAt: now,
      writes: (stored?.writes ?? 0) + 1,
    };
    if (!(await deps.ledger.write(key, claim, stored))) {
      // Another copy of this event wrote first. Read again and decide again.
      continue;
    }
    if (decision.do === "advance") {
      return { action: "advanced", why: "newer, with nothing new to say" };
    }
    const sent = message(decision.change);
    // If this throws, the claim stays unsettled and the retry sends it.
    await deps.publish(sent);
    // A crash here costs a second copy of the message on the retry, never a missing one.
    await deps.ledger.write(key, { ...claim, notified: true, writes: claim.writes + 1 }, claim);
    return { action: "sent", change: decision.change, message: sent };
  }
  throw new Error(`the ledger entry for ${key} kept changing; let the invocation be retried`);
}
// #endregion announce

// #region handle
export async function handle(input: unknown, deps: Deps): Promise<Outcome> {
  const parsed = parseHealthEvent(input);
  if (!parsed.ok) {
    const { envelope, issues } = parsed;
    const message = renderUnreadable(envelope, issues);
    deps.log({ message: "unreadable", id: envelope?.id, issues });
    if (envelope === undefined) {
      await deps.publish(message);
      return { action: "sent", change: "new", message };
    }
    return announce(
      deps,
      `unreadable#${envelope.id}`,
      { revision: "unreadable", clock: 0, status: "open" },
      () => message,
    );
  }

  const { event } = parsed;
  const classification = classify(event.detail, deps.services);
  const context = {
    eventArn: event.detail.eventArn,
    service: event.detail.service,
    status: event.detail.statusCode,
    kind: classification.kind,
    reason: classification.reason,
  };
  if (classification.kind === "ignore") {
    deps.log({ message: "ignored", ...context });
    return { action: "ignored", why: classification.reason };
  }

  const outcome = await announce(
    deps,
    keyOf(event),
    versionOf(event, classification.kind),
    (change) => render(event, classification, change),
  );
  deps.log({
    message: outcome.action,
    ...context,
    ...(outcome.action === "sent" ? { change: outcome.change } : { why: outcome.why }),
  });
  return outcome;
}
// #endregion handle
