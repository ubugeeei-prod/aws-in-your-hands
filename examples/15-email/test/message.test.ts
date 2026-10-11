import { describe, expect, it } from "vite-plus/test";
import { emailAddressSchema, shareNotificationSchema } from "../src/contract.ts";
import { buildShareEmail, escapeHtml, fingerprint } from "../src/message.ts";
import { input, settings } from "./setup.ts";

describe("header injection", () => {
  const injections = [
    "Trip plan\r\nBcc: attacker@example.com",
    "Trip plan\nBcc: attacker@example.com",
    "Trip plan\rX-Injected: 1",
    "Trip plan Bcc: attacker@example.com",
    "Trip plan\u0000",
    "Trip plan\n",
  ];

  for (const value of injections) {
    it(`refuses ${JSON.stringify(value)} as a note title or a sender name`, () => {
      expect(shareNotificationSchema.safeParse({ ...input, noteTitle: value }).success).toBe(false);
      expect(shareNotificationSchema.safeParse({ ...input, sharedBy: value }).success).toBe(false);
    });
  }

  it("accepts one address and nothing that could carry a second", () => {
    expect(emailAddressSchema.safeParse("recipient@example.com").success).toBe(true);
    for (const value of [
      "recipient@example.com\r\nBcc: attacker@example.com",
      "recipient@example.com, attacker@example.com",
      "recipient@example.com;attacker@example.com",
      "Recipient <recipient@example.com>",
      "recipient@example.com attacker@example.com",
      "recipient@example.com\n",
    ]) {
      expect(emailAddressSchema.safeParse(value).success, value).toBe(false);
    }
  });

  it("refuses an ID that would not survive as an SES message tag", () => {
    expect(shareNotificationSchema.safeParse({ ...input, notificationId: "share 1" }).success).toBe(false);
    expect(shareNotificationSchema.safeParse({ ...input, notificationId: "a".repeat(65) }).success).toBe(false);
  });

  it("is checked again where the headers are assembled", () => {
    // Callers that skip the schema still cannot get a line break into a header.
    expect(() => buildShareEmail({ ...input, noteTitle: "x\r\nBcc: attacker@example.com" }, settings)).toThrow(
      /noteTitle/,
    );
    expect(() => buildShareEmail({ ...input, to: "recipient@example.com\nBcc: a@example.com" }, settings)).toThrow(
      /to /,
    );
  });
});

describe("share email", () => {
  it("puts user text into the subject and body as text", () => {
    const email = buildShareEmail(input, settings);
    expect(email).toMatchObject({
      from: "notes@example.com",
      to: "recipient@example.com",
      subject: "Aiko shared a note with you: Trip plan",
      tags: { notification_id: "share-1" },
    });
    expect(email.text).toContain("https://notes.example.com/notes/note-1");
  });

  it("escapes user text in the HTML part", () => {
    const email = buildShareEmail(
      { ...input, sharedBy: "<b>Aiko</b>", noteTitle: `"><script>alert(1)</script>` },
      settings,
    );
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<b>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("links only to the configured origin", () => {
    const email = buildShareEmail(input, { ...settings, appOrigin: "https://notes.example.com/app" });
    expect(email.text).toContain("Open the note: https://notes.example.com/notes/note-1");
  });

  it("has the same fingerprint for the same mail, and another for a different one", () => {
    const same = fingerprint(buildShareEmail(input, settings));
    expect(fingerprint(buildShareEmail({ ...input }, settings))).toBe(same);
    expect(fingerprint(buildShareEmail({ ...input, noteTitle: "Other" }, settings))).not.toBe(same);
    expect(fingerprint(buildShareEmail({ ...input, to: "other@example.com" }, settings))).not.toBe(same);
  });
});
