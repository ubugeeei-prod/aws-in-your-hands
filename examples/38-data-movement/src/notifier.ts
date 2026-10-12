import { PublishCommand, type SNSClient } from "@aws-sdk/client-sns";

export type Notifier = { notify(subject: string, message: string): Promise<void> };

export class SnsNotifier implements Notifier {
  readonly #client: Pick<SNSClient, "send">;
  readonly #topicArn: string;

  constructor(client: Pick<SNSClient, "send">, topicArn: string) {
    this.#client = client;
    this.#topicArn = topicArn;
  }

  async notify(subject: string, message: string): Promise<void> {
    await this.#client.send(
      // SNS refuses a subject longer than 100 characters.
      new PublishCommand({
        TopicArn: this.#topicArn,
        Subject: subject.slice(0, 100),
        Message: message,
      }),
    );
  }
}
