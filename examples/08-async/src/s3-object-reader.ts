import { GetObjectCommand, NoSuchKey, type S3Client, S3ServiceException } from "@aws-sdk/client-s3";
import type { ObjectReader, ReadResult } from "./object-reader.ts";

export class S3ObjectReader implements ObjectReader {
  readonly #client: Pick<S3Client, "send">;
  readonly #bucket: string;

  constructor(client: Pick<S3Client, "send">, bucket: string) {
    this.#client = client;
    this.#bucket = bucket;
  }

  // #region read
  async readExact(key: string, eTag: string, maxBytes: number): Promise<ReadResult> {
    try {
      const object = await this.#client.send(
        new GetObjectCommand({
          Bucket: this.#bucket,
          Key: key,
          // S3 answers 412 when the object under the key is no longer the one the event describes.
          IfMatch: `"${eTag}"`,
          // Never more than an upload may hold, whatever was put under this key.
          Range: `bytes=0-${maxBytes - 1}`,
        }),
      );
      const bytes = (await object.Body?.transformToByteArray()) ?? new Uint8Array();
      // "bytes 0-169/170": the number after the slash is the size of the whole object.
      const total = Number(object.ContentRange?.split("/")[1]);
      return {
        status: "found",
        bytes,
        size: Number.isInteger(total) ? total : bytes.byteLength,
        contentType: object.ContentType ?? "",
      };
    } catch (error) {
      // A 404 needs s3:ListBucket on the role, as in chapter 07. Without it S3 answers 403.
      if (error instanceof NoSuchKey) {
        return { status: "gone" };
      }
      if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 412) {
        return { status: "changed" };
      }
      // An empty object has no first byte to ask for.
      if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 416) {
        return { status: "found", bytes: new Uint8Array(), size: 0, contentType: "" };
      }
      throw error;
    }
  }
  // #endregion read
}
