import {
  DeleteObjectCommand,
  DeleteObjectTaggingCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NotFound,
  type S3Client,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { type ObjectStore, PENDING, STATE_TAG } from "./object-store.ts";

const pendingTagging = `<Tagging><TagSet><Tag><Key>${STATE_TAG}</Key><Value>${PENDING}</Value></Tag></TagSet></Tagging>`;

export class S3ObjectStore implements ObjectStore {
  readonly #client: S3Client;
  readonly #bucket: string;

  constructor(client: S3Client, bucket: string) {
    this.#client = client;
    this.#bucket = bucket;
  }

  // #region presign-upload
  presignUpload(input: {
    key: string;
    contentType: string;
    maxBytes: number;
    expiresInSeconds: number;
  }) {
    // Signing happens in this process: no request goes to S3. S3 checks the
    // policy later, when the browser's POST arrives.
    return createPresignedPost(this.#client, {
      Bucket: this.#bucket,
      Key: input.key,
      // Each field becomes an exact-match condition: the upload must send
      // this key, this Content-Type, and this tag, or S3 refuses it.
      Fields: { "Content-Type": input.contentType, tagging: pendingTagging },
      Conditions: [["content-length-range", 1, input.maxBytes]],
      Expires: input.expiresInSeconds,
    });
  }
  // #endregion presign-upload

  // #region head
  async head(key: string) {
    try {
      const object = await this.#client.send(
        new HeadObjectCommand({ Bucket: this.#bucket, Key: key }),
      );
      if (object.ContentLength === undefined || object.LastModified === undefined) {
        throw new Error(`HeadObject for ${key} returned no size or date`);
      }
      return {
        size: object.ContentLength,
        contentType: object.ContentType ?? "",
        lastModified: object.LastModified,
      };
    } catch (error) {
      // A 404 needs s3:ListBucket on the role. Without it S3 answers 403 for
      // a missing key, and that lands in the `throw` below.
      if (error instanceof NotFound) {
        return undefined;
      }
      throw error;
    }
  }
  // #endregion head

  // #region mark-attached
  async markAttached(key: string) {
    // The pending tag is the only tag an upload has, so removing the tag set
    // removes it. Unlike writing a new tag, this request is not billed.
    await this.#client.send(new DeleteObjectTaggingCommand({ Bucket: this.#bucket, Key: key }));
  }
  // #endregion mark-attached

  // #region presign-view
  presignView(key: string, expiresInSeconds: number) {
    return getSignedUrl(this.#client, new GetObjectCommand({ Bucket: this.#bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }
  // #endregion presign-view

  async delete(key: string) {
    await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: key }));
  }

  async *list(prefix: string) {
    let token: string | undefined;
    do {
      const page = await this.#client.send(
        new ListObjectsV2Command({
          Bucket: this.#bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      for (const object of page.Contents ?? []) {
        if (object.Key !== undefined && object.LastModified !== undefined) {
          yield { key: object.Key, lastModified: object.LastModified };
        }
      }
      token = page.IsTruncated === true ? page.NextContinuationToken : undefined;
    } while (token !== undefined);
  }
}
