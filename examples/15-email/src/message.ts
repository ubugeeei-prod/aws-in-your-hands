import { createHash } from "node:crypto";
import { hasControlCharacter, type ShareNotification } from "./contract.ts";

export type Email = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Come back on every SES event for this mail. */
  tags: Record<string, string>;
};

export type MailSettings = { fromAddress: string; appOrigin: string };

/** The tag that ties an SES event back to the notification it belongs to. */
export const NOTIFICATION_TAG = "notification_id";

// #region escape
const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}
// #endregion escape

// #region build
export function buildShareEmail(input: ShareNotification, settings: MailSettings): Email {
  // The schema already refuses these. This is the last stop before a header.
  for (const [field, value] of Object.entries({ to: input.to, sharedBy: input.sharedBy, noteTitle: input.noteTitle })) {
    if (hasControlCharacter(value)) {
      throw new Error(`${field} contains a control character and cannot go into a mail header`);
    }
  }

  // Built here from the note's ID, so a caller cannot make this mail link somewhere else.
  const url = new URL(`/notes/${encodeURIComponent(input.noteId)}`, settings.appOrigin).href;
  const subject = `${input.sharedBy} shared a note with you: ${input.noteTitle}`;

  return {
    from: settings.fromAddress,
    to: input.to,
    subject,
    text: [subject, "", `Open the note: ${url}`, "", "If you did not expect this, you can ignore this email."].join(
      "\n",
    ),
    html: [
      `<p>${escapeHtml(input.sharedBy)} shared a note with you: ${escapeHtml(input.noteTitle)}</p>`,
      `<p><a href="${escapeHtml(url)}">Open the note</a></p>`,
      "<p>If you did not expect this, you can ignore this email.</p>",
    ].join("\n"),
    tags: { [NOTIFICATION_TAG]: input.notificationId },
  };
}
// #endregion build

// #region fingerprint
/** Same notificationId with another fingerprint is a different mail, not a retry. */
export function fingerprint(email: Email): string {
  return createHash("sha256")
    .update(JSON.stringify([email.to, email.subject, email.text]))
    .digest("hex");
}
// #endregion fingerprint
