import * as v from "valibot";

import type { NotificationState } from "./contract.ts";
import type { Logger } from "./log.ts";
import { NOTIFICATION_TAG } from "./message.ts";
import { normalizeAddress, type NotificationStore, type Suppression } from "./store.ts";

// #region schema
// Only the fields this code acts on. SES sends many more, and may add new ones.
const mailSchema = v.object({
  messageId: v.string(),
  tags: v.optional(v.record(v.string(), v.array(v.string())), {}),
});
const recipientSchema = v.object({ emailAddress: v.pipe(v.string(), v.minLength(1)) });
const timestamp = v.pipe(v.string(), v.isoTimestamp());

export const sesEventSchema = v.variant("eventType", [
  v.object({
    eventType: v.literal("Bounce"),
    mail: mailSchema,
    bounce: v.object({
      bounceType: v.picklist(["Permanent", "Transient", "Undetermined"]),
      bounceSubType: v.string(),
      bouncedRecipients: v.pipe(v.array(recipientSchema), v.minLength(1)),
      timestamp,
      feedbackId: v.string(),
    }),
  }),
  v.object({
    eventType: v.literal("Complaint"),
    mail: mailSchema,
    complaint: v.object({
      complainedRecipients: v.pipe(v.array(recipientSchema), v.minLength(1)),
      timestamp,
      feedbackId: v.string(),
    }),
  }),
  v.object({
    eventType: v.literal("Delivery"),
    mail: mailSchema,
    delivery: v.object({ timestamp }),
  }),
]);
export type SesEvent = v.InferOutput<typeof sesEventSchema>;

const HANDLED = new Set<string>(
  sesEventSchema.options.map((option) => option.entries.eventType.literal),
);
// #endregion schema

export type ParsedSesMessage =
  | { kind: "event"; event: SesEvent }
  | { kind: "ignored"; eventType: string }
  | { kind: "invalid"; problem: string };

/** `message` is the JSON text SES publishes: the `Message` field of the SNS notification. */
export function parseSesMessage(message: string): ParsedSesMessage {
  let json: unknown;
  try {
    json = JSON.parse(message);
  } catch {
    return { kind: "invalid", problem: "not JSON" };
  }
  const type = v.safeParse(v.object({ eventType: v.string() }), json);
  if (!type.success) {
    return { kind: "invalid", problem: "no eventType" };
  }
  if (!HANDLED.has(type.output.eventType)) {
    return { kind: "ignored", eventType: type.output.eventType };
  }
  const event = v.safeParse(sesEventSchema, json);
  return event.success
    ? { kind: "event", event: event.output }
    : {
        kind: "invalid",
        problem: event.issues
          .map((issue) => `${v.getDotPath(issue) ?? ""}: ${issue.message}`)
          .join("; "),
      };
}

// #region plan
export type EventAction =
  | { kind: "suppress"; suppression: Suppression }
  | {
      kind: "advance";
      notificationId: string;
      next: Exclude<NotificationState, "claimed" | "rejected" | "sent">;
      at: string;
    };

// "Jane <jane@example.com>" and "jane@example.com" are the same mailbox.
const bareAddress = (value: string): string =>
  normalizeAddress(/<([^<>]+)>\s*$/.exec(value)?.[1] ?? value);

/** What one event asks for. No I/O, so every branch is a plain test. */
export function planEventActions(event: SesEvent): EventAction[] {
  const tagged = event.mail.tags[NOTIFICATION_TAG]?.[0];
  const notificationId =
    tagged !== undefined && /^[A-Za-z0-9_-]{1,64}$/.test(tagged) ? tagged : undefined;
  const advance = (next: "delivered" | "bounced" | "complained", at: string): EventAction[] =>
    notificationId === undefined ? [] : [{ kind: "advance", notificationId, next, at }];

  switch (event.eventType) {
    case "Delivery":
      return advance("delivered", event.delivery.timestamp);
    case "Bounce": {
      const { bounceType, bouncedRecipients, timestamp, feedbackId } = event.bounce;
      // A full mailbox may be empty tomorrow. Only a permanent bounce stops future mail.
      const suppressions: EventAction[] =
        bounceType === "Permanent"
          ? bouncedRecipients.map((recipient) => ({
              kind: "suppress",
              suppression: {
                address: bareAddress(recipient.emailAddress),
                reason: "bounce",
                suppressedAt: timestamp,
                feedbackId,
              },
            }))
          : [];
      return [...suppressions, ...advance("bounced", timestamp)];
    }
    case "Complaint": {
      const { complainedRecipients, timestamp, feedbackId } = event.complaint;
      return [
        ...complainedRecipients.map((recipient): EventAction => ({
          kind: "suppress",
          suppression: {
            address: bareAddress(recipient.emailAddress),
            reason: "complaint",
            suppressedAt: timestamp,
            feedbackId,
          },
        })),
        ...advance("complained", timestamp),
      ];
    }
  }
}
// #endregion plan

// #region handle
export type EventDeps = { store: NotificationStore; log: Logger };

/** One SES event. Safe to run twice: SNS and Lambda both deliver at least once. */
export async function handleSesMessage(
  deps: EventDeps,
  message: string,
): Promise<ParsedSesMessage> {
  const parsed = parseSesMessage(message);
  if (parsed.kind === "invalid") {
    // Retrying cannot fix a message this code does not understand. Log it loudly and move on.
    deps.log({ level: "error", message: "unreadable SES event dropped", problem: parsed.problem });
    return parsed;
  }
  if (parsed.kind === "ignored") {
    deps.log({ level: "debug", message: "SES event ignored", eventType: parsed.eventType });
    return parsed;
  }
  for (const action of planEventActions(parsed.event)) {
    if (action.kind === "suppress") {
      await deps.store.suppress(action.suppression);
    } else {
      const applied = await deps.store.advance(action.notificationId, action.next, {
        at: action.at,
      });
      deps.log({
        level: "info",
        message: "notification state",
        notificationId: action.notificationId,
        next: action.next,
        applied,
      });
    }
  }
  deps.log({
    level: "info",
    message: "SES event handled",
    eventType: parsed.event.eventType,
    messageId: parsed.event.mail.messageId,
  });
  return parsed;
}

const snsEventSchema = v.object({
  Records: v.array(v.object({ Sns: v.object({ MessageId: v.string(), Message: v.string() }) })),
});

/** The Lambda handler behind the SNS topic. A storage failure throws, and Lambda runs the event again. */
export function createEventsHandler(deps: EventDeps) {
  return async (event: unknown): Promise<void> => {
    for (const record of v.parse(snsEventSchema, event).Records) {
      await handleSesMessage(deps, record.Sns.Message);
    }
  };
}
// #endregion handle
