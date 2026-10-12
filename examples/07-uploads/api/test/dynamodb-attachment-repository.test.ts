import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import type { DeleteCommand, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it } from "vite-plus/test";

import type { Attachment } from "../src/contract.ts";
import { DynamoDbAttachmentRepository } from "../src/dynamodb-attachment-repository.ts";

// Pins the requests. Whether DynamoDB honours them has not been run anywhere yet.
type Command = PutCommand | GetCommand | QueryCommand | DeleteCommand;

function setup(respond: (command: Command, call: number) => unknown = () => ({})) {
  const sent: Command[] = [];
  const client = {
    send: async (command: Command) => {
      sent.push(command);
      return respond(command, sent.length);
    },
  };
  return { repository: new DynamoDbAttachmentRepository(client as never, "notes-table"), sent };
}

const stored: Attachment = {
  id: "a1",
  noteId: "n1",
  contentType: "image/png",
  size: 42,
  createdAt: "2026-10-11T00:00:00.000Z",
};
const item = { pk: "OWNER#u1", sk: "ATTACHMENT#n1#a1", ...stored };

describe("DynamoDbAttachmentRepository requests", () => {
  it("stores a record under its owner, beside the notes, without overwriting", async () => {
    const { repository, sent } = setup();
    expect(await repository.create("u1", stored)).toBe("created");
    expect(sent[0]).toBeInstanceOf(PutCommand);
    expect(sent[0]?.input).toMatchObject({
      TableName: "notes-table",
      Item: { pk: "OWNER#u1", sk: "ATTACHMENT#n1#a1", size: 42 },
      ConditionExpression: "attribute_not_exists(pk)",
    });
  });

  it("reports a second finish as already_exists", async () => {
    const { repository } = setup(() => {
      throw new ConditionalCheckFailedException({
        message: "The conditional request failed",
        $metadata: {},
      });
    });
    expect(await repository.create("u1", stored)).toBe("already_exists");
  });

  it("lists one note's attachments, following every page", async () => {
    const { repository, sent } = setup((_command, call) =>
      call === 1
        ? { Items: [item], LastEvaluatedKey: { pk: item.pk, sk: item.sk } }
        : { Items: [] },
    );
    expect(await repository.listByNote("u1", "n1")).toEqual([stored]);
    expect(sent).toHaveLength(2);
    expect(sent[0]?.input).toMatchObject({
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      // The trailing "#" keeps note "n1" from matching note "n10".
      ExpressionAttributeValues: { ":pk": "OWNER#u1", ":prefix": "ATTACHMENT#n1#" },
      ConsistentRead: true,
    });
    expect(sent[1]?.input).toMatchObject({ ExclusiveStartKey: { pk: item.pk, sk: item.sk } });
  });

  it("refuses a stored item that is not an attachment", async () => {
    const { repository } = setup(() => ({ Item: { ...item, contentType: "text/html" } }));
    await expect(repository.get("u1", "n1", "a1")).rejects.toThrow();
  });

  it("says whether a delete removed anything", async () => {
    const present = setup(() => ({ Attributes: item }));
    expect(await present.repository.delete("u1", "n1", "a1")).toBe(true);
    expect(present.sent[0]?.input).toMatchObject({
      Key: { pk: "OWNER#u1", sk: "ATTACHMENT#n1#a1" },
    });
    expect(await setup().repository.delete("u1", "n1", "a1")).toBe(false);
  });
});
