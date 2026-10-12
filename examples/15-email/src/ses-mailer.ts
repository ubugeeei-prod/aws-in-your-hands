import { SendEmailCommand, type SESv2Client, SESv2ServiceException } from "@aws-sdk/client-sesv2";

import type { Mailer, SendResult } from "./mailer.ts";
import type { Email } from "./message.ts";

// #region ses
export class SesMailer implements Mailer {
  readonly #client: Pick<SESv2Client, "send">;
  readonly #configurationSetName: string;

  constructor(client: Pick<SESv2Client, "send">, configurationSetName: string) {
    this.#client = client;
    this.#configurationSetName = configurationSetName;
  }

  async send(email: Email): Promise<SendResult> {
    try {
      const result = await this.#client.send(
        new SendEmailCommand({
          FromEmailAddress: email.from,
          // One recipient per message, so a bounce or complaint names exactly one address.
          Destination: { ToAddresses: [email.to] },
          Content: {
            // "Simple": SES assembles the MIME message. No header is written by hand here.
            Simple: {
              Subject: { Data: email.subject, Charset: "UTF-8" },
              Body: {
                Text: { Data: email.text, Charset: "UTF-8" },
                Html: { Data: email.html, Charset: "UTF-8" },
              },
            },
          },
          // Without it, no bounce, complaint or delivery event is published.
          ConfigurationSetName: this.#configurationSetName,
          EmailTags: Object.entries(email.tags).map(([Name, Value]) => ({ Name, Value })),
        }),
      );
      if (result.MessageId === undefined) {
        throw new Error("SES answered without a message ID");
      }
      return { kind: "accepted", messageId: result.MessageId };
    } catch (error) {
      // 4xx: SES read the request and refused it. Everything else (timeout,
      // reset connection, 5xx) leaves the outcome unknown and is thrown on.
      if (error instanceof SESv2ServiceException && error.$fault === "client") {
        return { kind: "rejected", reason: error.name };
      }
      throw error;
    }
  }
}
// #endregion ses
