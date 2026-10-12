import type { Email } from "./message.ts";

// #region mailer
export type SendResult =
  // The provider took the message. Not the same as "it arrived".
  | { kind: "accepted"; messageId: string }
  // The provider said no. Nothing went out.
  | { kind: "rejected"; reason: string };

export type Mailer = {
  /** Resolves when the provider answered. Throws when nobody knows what happened. */
  send(email: Email): Promise<SendResult>;
};
// #endregion mailer

// #region outbox
export type OutboxEntry = Email & { messageId: string };

/** Sends nothing. Keeps what would have been sent, for the dev server and the tests. */
export class OutboxMailer implements Mailer {
  readonly sent: OutboxEntry[] = [];

  send(email: Email): Promise<SendResult> {
    const messageId = `local-${this.sent.length + 1}`;
    this.sent.push({ ...email, messageId });
    return Promise.resolve({ kind: "accepted", messageId });
  }
}
// #endregion outbox
