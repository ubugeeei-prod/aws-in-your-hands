import {
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NotFound,
  PutObjectCommand,
  type S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import type { ExportStore, Metadata } from "./export-store.ts";

export class S3ExportStore implements ExportStore {
  readonly #client: Pick<S3Client, "send">;
  readonly #bucket: string;

  constructor(client: Pick<S3Client, "send">, bucket: string) {
    this.#client = client;
    this.#bucket = bucket;
  }

  // #region put-if-absent
  async putIfAbsent(key: string, body: string, metadata: Metadata) {
    try {
      await this.#client.send(
        new PutObjectCommand({
          Bucket: this.#bucket,
          Key: key,
          Body: body,
          ContentType: key.endsWith(".json") ? "application/json" : "application/x-ndjson",
          Metadata: metadata,
          // S3 checks for an existing object and writes as one operation, and
          // answers 412 if the key is taken. A late writer cannot replace a part.
          IfNoneMatch: "*",
        }),
      );
      return "written" as const;
    } catch (error) {
      if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 412) {
        return "exists" as const;
      }
      // A 409 (a delete raced this write) is thrown, and the workflow retries the step.
      throw error;
    }
  }
  // #endregion put-if-absent

  async head(key: string) {
    try {
      const object = await this.#client.send(new HeadObjectCommand({ Bucket: this.#bucket, Key: key }));
      return object.Metadata ?? {};
    } catch (error) {
      // S3 answers 404 only to a role with s3:ListBucket. Without it a missing key is a 403, and this throws.
      if (error instanceof NotFound) {
        return undefined;
      }
      throw error;
    }
  }

  async list(prefix: string) {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const page = await this.#client.send(
        new ListObjectsV2Command({ Bucket: this.#bucket, Prefix: prefix, ContinuationToken: token }),
      );
      keys.push(...(page.Contents ?? []).flatMap((object) => object.Key ?? []));
      token = page.IsTruncated === true ? page.NextContinuationToken : undefined;
    } while (token !== undefined);
    return keys;
  }

  async delete(key: string) {
    await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: key }));
  }
}
