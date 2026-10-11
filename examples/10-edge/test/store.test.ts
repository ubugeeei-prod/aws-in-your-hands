import {
  CloudFrontKeyValueStoreClient,
  ConflictException,
  DescribeKeyValueStoreCommand,
  InternalServerException,
  ListKeysCommand,
  UpdateKeysCommand,
  ValidationException,
} from "@aws-sdk/client-cloudfront-keyvaluestore";
import { describe, expect, it } from "vite-plus/test";
import { createKvsStore } from "../src/kvs/store.ts";
import { KvsConflictError, KvsUnavailableError } from "../src/kvs/sync.ts";

const ARN = "arn:aws:cloudfront::123456789012:key-value-store/11111111-2222-3333-4444-555555555555";

type Sent = { name: string; input: Record<string, unknown> };
type Sender = Parameters<typeof createKvsStore>[0];

/** Answers each command from a queue and records what was sent. */
function fakeClient(answers: (Record<string, unknown> | Error)[]): { client: Sender; sent: Sent[] } {
  const sent: Sent[] = [];
  const send = (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
    sent.push({ name: command.constructor.name, input: command.input });
    const answer = answers.shift();
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  };
  return { client: { send } as unknown as Sender, sent };
}

describe("createKvsStore", () => {
  it("reads the ETag before the pairs, and follows every page", async () => {
    const { client, sent } = fakeClient([
      { ETag: "E1", Status: "READY" },
      { Items: [{ Key: "flag:maintenance", Value: "off" }], NextToken: "page-2" },
      { Items: [{ Key: "redirect:/plans", Value: "x" }] },
    ]);

    const snapshot = await createKvsStore(client, ARN).read();

    expect(sent.map((call) => call.name)).toEqual([
      DescribeKeyValueStoreCommand.name,
      ListKeysCommand.name,
      ListKeysCommand.name,
    ]);
    expect(sent[2]?.input).toMatchObject({ KvsARN: ARN, NextToken: "page-2" });
    expect(snapshot.etag).toBe("E1");
    expect([...snapshot.entries.keys()]).toEqual(["flag:maintenance", "redirect:/plans"]);
  });

  it("does not plan against a store that is still being created", async () => {
    const { client, sent } = fakeClient([{ ETag: "E1", Status: "PROVISIONING" }]);
    await expect(createKvsStore(client, ARN).read()).rejects.toBeInstanceOf(KvsUnavailableError);
    expect(sent).toHaveLength(1);
  });

  it("sends the ETag it was given as If-Match, and returns the new one", async () => {
    const { client, sent } = fakeClient([{ ETag: "E2", ItemCount: 1, TotalSizeInBytes: 20 }]);

    const etag = await createKvsStore(client, ARN).update("E1", {
      puts: [{ key: "flag:maintenance", value: "on" }],
      deletes: ["redirect:/gone"],
    });

    expect(etag).toBe("E2");
    expect(sent).toEqual([
      {
        name: UpdateKeysCommand.name,
        input: {
          KvsARN: ARN,
          IfMatch: "E1",
          Puts: [{ Key: "flag:maintenance", Value: "on" }],
          Deletes: [{ Key: "redirect:/gone" }],
        },
      },
    ]);
  });

  it("tells a stale ETag, an unclear failure, and a plain refusal apart", async () => {
    const update = (error: Error) =>
      createKvsStore(fakeClient([error]).client, ARN).update("E1", { puts: [], deletes: ["redirect:/gone"] });
    const meta = { $metadata: { httpStatusCode: 400 }, message: "no" };

    await expect(update(new ConflictException({ ...meta, $metadata: { httpStatusCode: 409 } }))).rejects.toBeInstanceOf(
      KvsConflictError,
    );
    await expect(
      update(new InternalServerException({ ...meta, $metadata: { httpStatusCode: 500 } })),
    ).rejects.toBeInstanceOf(KvsUnavailableError);
    // No HTTP status: the connection died, and nobody knows whether the write landed.
    await expect(update(new Error("socket hang up"))).rejects.toBeInstanceOf(KvsUnavailableError);
    await expect(update(new ValidationException(meta))).rejects.toBeInstanceOf(ValidationException);
  });

  it("signs with SigV4A, which the global endpoint requires", async () => {
    // A real client with made-up credentials and a handler that answers without the network.
    let authorization = "";
    const client = new CloudFrontKeyValueStoreClient({
      region: "us-east-1",
      credentials: { accessKeyId: "AKIAEXAMPLEEXAMPLE00", secretAccessKey: "not-a-real-secret" },
      requestHandler: {
        handle: (request: { headers: Record<string, string> }) => {
          authorization = request.headers["authorization"] ?? "";
          return Promise.resolve({
            response: { statusCode: 200, headers: { etag: "E1", "content-type": "application/json" }, body: undefined },
          });
        },
      } as never,
    });

    await createKvsStore(client, ARN)
      .update("E0", { puts: [{ key: "flag:maintenance", value: "on" }], deletes: [] })
      .catch(() => undefined);

    expect(authorization).toMatch(/^AWS4-ECDSA-P256-SHA256 /);
  });
});
