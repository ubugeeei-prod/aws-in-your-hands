import {
  GetObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  type S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { AudioCache } from "./audio-cache.ts";

// #region refused
// 412: the condition did not hold. 409: another write to the same key was in flight.
// Either way this caller did not write, and someone else did or is about to.
const refused = (error: unknown): boolean =>
  error instanceof S3ServiceException &&
  (error.$metadata.httpStatusCode === 412 || error.$metadata.httpStatusCode === 409);
// #endregion refused

export class S3AudioCache implements AudioCache {
  readonly #client: S3Client;
  readonly #bucket: string;

  constructor(client: S3Client, bucket: string) {
    this.#client = client;
    this.#bucket = bucket;
  }

  async exists(key: string) {
    try {
      await this.#client.send(new HeadObjectCommand({ Bucket: this.#bucket, Key: key }));
      return true;
    } catch (error) {
      // A 404 needs s3:ListBucket on the role. Without it S3 answers 403 for a missing key.
      if (error instanceof NotFound) {
        return false;
      }
      throw error;
    }
  }

  // #region create
  async create(key: string, body: Uint8Array, contentType: string) {
    try {
      const written = await this.#client.send(
        new PutObjectCommand({
          Bucket: this.#bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          // S3 writes only if no object has this key, and decides between two writers itself.
          IfNoneMatch: "*",
        }),
      );
      return { created: true, etag: written.ETag ?? "" } as const;
    } catch (error) {
      if (refused(error)) {
        return { created: false } as const;
      }
      throw error;
    }
  }
  // #endregion create

  async read(key: string) {
    try {
      const object = await this.#client.send(
        new GetObjectCommand({ Bucket: this.#bucket, Key: key }),
      );
      if (object.Body === undefined || object.ETag === undefined) {
        throw new Error(`GetObject for ${key} returned no body or no ETag`);
      }
      return { body: await object.Body.transformToByteArray(), etag: object.ETag };
    } catch (error) {
      if (error instanceof NoSuchKey) {
        return undefined;
      }
      throw error;
    }
  }

  // #region replace
  async replace(key: string, etag: string, body: Uint8Array, contentType: string) {
    try {
      const written = await this.#client.send(
        new PutObjectCommand({
          Bucket: this.#bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          // Only if the object is still the one that was read. Needs s3:GetObject as well.
          IfMatch: etag,
        }),
      );
      return { replaced: true, etag: written.ETag ?? "" } as const;
    } catch (error) {
      // 404: a lifecycle rule removed the object in between. Not ours either.
      if (refused(error) || error instanceof NoSuchKey || is404(error)) {
        return { replaced: false } as const;
      }
      throw error;
    }
  }
  // #endregion replace

  presignView(key: string, expiresInSeconds: number) {
    return getSignedUrl(this.#client, new GetObjectCommand({ Bucket: this.#bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }
}

const is404 = (error: unknown): boolean =>
  error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404;
