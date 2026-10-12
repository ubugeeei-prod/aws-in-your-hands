import type { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { SESv2ServiceException } from "@aws-sdk/client-sesv2";
import { describe, expect, it } from "vite-plus/test";

import { buildShareEmail } from "../src/message.ts";
import { SesMailer } from "../src/ses-mailer.ts";
import { input, settings } from "./setup.ts";

// Pins the request and the reading of errors. SES itself was not called.
function setup(respond: () => unknown) {
  const sent: SendEmailCommand[] = [];
  const client = {
    send: async (command: SendEmailCommand) => {
      sent.push(command);
      return respond();
    },
  };
  return { mailer: new SesMailer(client as never, "notifications"), sent };
}

const email = buildShareEmail(input, settings);
const serviceError = (name: string, $fault: "client" | "server") =>
  new SESv2ServiceException({ name, $fault, message: name, $metadata: {} });

describe("SesMailer", () => {
  it("sends one recipient, through the configuration set, tagged with the notification", async () => {
    const { mailer, sent } = setup(() => ({ MessageId: "0100-abc" }));
    expect(await mailer.send(email)).toEqual({ kind: "accepted", messageId: "0100-abc" });
    expect(sent[0]?.input).toMatchObject({
      FromEmailAddress: "notes@example.com",
      Destination: { ToAddresses: ["recipient@example.com"] },
      ConfigurationSetName: "notifications",
      EmailTags: [{ Name: "notification_id", Value: "share-1" }],
      Content: {
        Simple: { Subject: { Data: "Aiko shared a note with you: Trip plan", Charset: "UTF-8" } },
      },
    });
    expect(sent[0]?.input.Destination).toEqual({ ToAddresses: ["recipient@example.com"] });
    expect(sent[0]?.input.Content?.Raw).toBeUndefined();
  });

  it("reports a 4xx from SES as rejected", async () => {
    for (const name of [
      "MessageRejected",
      "TooManyRequestsException",
      "AccountSuspendedException",
    ]) {
      const { mailer } = setup(() => {
        throw serviceError(name, "client");
      });
      expect(await mailer.send(email)).toEqual({ kind: "rejected", reason: name });
    }
  });

  it("throws when the outcome is unknown: a 5xx, a dropped connection, a missing message ID", async () => {
    const unknowns = [
      () => {
        throw serviceError("InternalFailure", "server");
      },
      () => {
        throw new Error("socket hang up");
      },
      () => ({}),
    ];
    for (const respond of unknowns) {
      await expect(setup(respond).mailer.send(email)).rejects.toThrow();
    }
  });
});
