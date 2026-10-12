import {
  GetObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  type S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";

import type { DigestStore, DigestVersion } from "./digest.ts";

// #region put
export function putDigestInput(bucket: string, key: string, body: string) {
  return {
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: "application/json",
    // Refused with 412 when the key has a current object. No retention is named:
    // the bucket's default applies, so this code cannot choose a shorter one.
    IfNoneMatch: "*",
  };
}
// #endregion put

export class S3Digests implements DigestStore {
  readonly #client: Pick<S3Client, "send">;
  readonly #bucket: string;

  constructor(client: Pick<S3Client, "send">, bucket: string) {
    this.#client = client;
    this.#bucket = bucket;
  }

  async put(key: string, body: string): Promise<"ok" | "exists"> {
    try {
      await this.#client.send(new PutObjectCommand(putDigestInput(this.#bucket, key, body)));
      return "ok";
    } catch (error) {
      if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 412) {
        return "exists";
      }
      throw error;
    }
  }

  // #region list
  async list(prefix: string): Promise<DigestVersion[]> {
    const found: DigestVersion[] = [];
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
    do {
      const page = await this.#client.send(
        new ListObjectVersionsCommand({
          Bucket: this.#bucket,
          Prefix: prefix,
          ...(keyMarker === undefined ? {} : { KeyMarker: keyMarker }),
          ...(versionIdMarker === undefined ? {} : { VersionIdMarker: versionIdMarker }),
        }),
      );
      // A plain ListObjectsV2 would show the newest version only, and hide what lies under it.
      for (const [deleteMarker, versions] of [
        [false, page.Versions ?? []],
        [true, page.DeleteMarkers ?? []],
      ] as const) {
        for (const { Key, VersionId } of versions) {
          if (Key === undefined || VersionId === undefined) {
            throw new Error("S3 listed an object version without a key or a version ID.");
          }
          found.push({ key: Key, versionId: VersionId, deleteMarker });
        }
      }
      keyMarker = page.IsTruncated === true ? page.NextKeyMarker : undefined;
      versionIdMarker = page.NextVersionIdMarker;
    } while (keyMarker !== undefined);
    return found;
  }
  // #endregion list

  async get(key: string, versionId: string): Promise<string> {
    const result = await this.#client.send(
      new GetObjectCommand({ Bucket: this.#bucket, Key: key, VersionId: versionId }),
    );
    if (result.Body === undefined) {
      throw new Error(`S3 returned no body for ${key} (${versionId}).`);
    }
    return result.Body.transformToString("utf8");
  }
}
