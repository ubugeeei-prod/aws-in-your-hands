import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  type S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";

import type { Media, StoredObject } from "./media.ts";

const statusOf = (error: unknown): number | undefined =>
  error instanceof S3ServiceException ? error.$metadata.httpStatusCode : undefined;

export class S3Media implements Media {
  readonly #client: Pick<S3Client, "send">;
  readonly #bucket: string;

  constructor(client: Pick<S3Client, "send">, bucket: string) {
    this.#client = client;
    this.#bucket = bucket;
  }

  async head(key: string): Promise<StoredObject | undefined> {
    try {
      const object = await this.#client.send(
        new HeadObjectCommand({ Bucket: this.#bucket, Key: key }),
      );
      return {
        eTag: object.ETag ?? "",
        contentType: object.ContentType ?? "",
        size: object.ContentLength ?? 0,
      };
    } catch (error) {
      // A 404 needs s3:ListBucket on the role, as in chapter 07. Without it S3 answers 403.
      if (error instanceof NotFound) {
        return undefined;
      }
      throw error;
    }
  }

  async getText(key: string) {
    try {
      const object = await this.#client.send(
        new GetObjectCommand({ Bucket: this.#bucket, Key: key }),
      );
      return { text: (await object.Body?.transformToString()) ?? "", eTag: object.ETag ?? "" };
    } catch (error) {
      if (error instanceof NoSuchKey) {
        return undefined;
      }
      throw error;
    }
  }

  // #region conditional
  async putIfAbsent(key: string, text: string) {
    try {
      await this.#put(key, text, { IfNoneMatch: "*" });
      return "created" as const;
    } catch (error) {
      // 412: something is there. 409: a delete raced this write. Either way, look again.
      if (statusOf(error) === 412 || statusOf(error) === 409) {
        return "exists" as const;
      }
      throw error;
    }
  }

  async replaceIfMatch(key: string, eTag: string, text: string) {
    try {
      await this.#put(key, text, { IfMatch: eTag });
      return "replaced" as const;
    } catch (error) {
      // 404: the object was deleted in the meantime. Either way it is not the one we read.
      if ([412, 409, 404].includes(statusOf(error) ?? 0)) {
        return "changed" as const;
      }
      throw error;
    }
  }

  #put(key: string, text: string, condition: { IfNoneMatch: string } | { IfMatch: string }) {
    return this.#client.send(
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: key,
        Body: text,
        ContentType: "application/json",
        ...condition,
      }),
    );
  }
  // #endregion conditional

  async delete(key: string): Promise<void> {
    await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: key }));
  }
}
