import { z } from "zod";
import type { NotificationState } from "./contract.ts";
import type { Logger } from "./log.ts";
import { NOTIFICATION_TAG } from "./message.ts";
import { normalizeAddress, type NotificationStore, type Suppression } from "./store.ts";

// #region schema
// Only the fields this code acts on. SES sends many more, and may add new ones.
const mailSchema = z.object({
  messageId: z.string(),
  tags: z.record(z.string(), z.array(z.string())).default({}),
});
const recipientSchema = z.object({ emailAddress: z.string().min(1) });

export const sesEventSchema = z.discriminatedUnion("eventType", [
  z.object({
    eventType: z.literal("Bounce"),
    mail: mailSchema,
    bounce: z.object({
      bounceType: z.enum(["Permanent", "Transient", "Undetermined"]),
      bounceSubType: z.string(),
      bouncedRecipients: z.array(recipientSchema).min(1),
      timestamp: z.iso.datetime(),
      feedbackId: z.string(),
    }),
  }),
  z.object({
    eventType: z.literal("Complaint"),
    mail: mailSchema,
    complaint: z.object({
      complainedRecipients: z.array(recipientSchema).min(1),
      timestamp: z.iso.datetime(),
      feedbackId: z.string(),
    }),
  }),
  z.object({
    eventType: z.literal("Delivery"),
    mail: mailSchema,
    delivery: z.object({ timestamp: z.iso.datetime() }),
  }),
]);
export type SesEvent = z.infer<typeof sesEventSchema>;

const HANDLED = new Set(sesEventSchema.options.map((option) => option.shape.eventType.value as string));
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
  const type = z.object({ eventType: z.string() }).safeParse(json);
  if (!type.success) {
    return { kind: "invalid", problem: "no eventType" };
  }
  if (!HANDLED.has(type.data.eventType)) {
    return { kind: "ignored", eventType: type.data.eventType };
  }
  const event = sesEventSchema.safeParse(json);
  return event.success
    ? { kind: "event", event: event.data }
    : {
        kind: "invalid",
        problem: event.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
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
const bareAddress = (value: string): string => normalizeAddress(/<([^<>]+)>\s*$/.exec(value)?.[1] ?? value);

/** What one event asks for. No I/O, so every branch is a plain test. */
export function planEventActions(event: SesEvent): EventAction[] {
  const tagged = event.mail.tags[NOTIFICATION_TAG]?.[0];
  const notificationId = tagged !== undefined && /^[A-Za-z0-9_-]{1,64}$/.test(tagged) ? tagged : undefined;
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
export async function handleSesMessage(deps: EventDeps, message: string): Promise<ParsedSesMessage> {
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
      const applied = await deps.store.advance(action.notificationId, action.next, { at: action.at });
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

const snsEventSchema = z.object({
  Records: z.array(z.object({ Sns: z.object({ MessageId: z.string(), Message: z.string() }) })),
});

/** The Lambda handler behind the SNS topic. A storage failure throws, and Lambda runs the event again. */
export function createEventsHandler(deps: EventDeps) {
  return async (event: unknown): Promise<void> => {
    for (const record of snsEventSchema.parse(event).Records) {
      await handleSesMessage(deps, record.Sns.Message);
    }
  };
}
// #endregion handle
