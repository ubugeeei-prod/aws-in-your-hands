import {
  CopyObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  type S3Client,
} from "@aws-sdk/client-s3";

import type { CurrentObject, ObjectVersion, VersionedBucket } from "./versioned-bucket.ts";

// Listings quote the ETag; S3 events, and so chapter 08's records, do not.
const bare = (eTag: string | undefined): string => (eTag ?? "").replaceAll('"', "");

export class S3VersionedBucket implements VersionedBucket {
  readonly #client: Pick<S3Client, "send">;
  readonly #bucket: string;

  constructor(client: Pick<S3Client, "send">, bucket: string) {
    this.#client = client;
    this.#bucket = bucket;
  }

  // #region list-versions
  async *listVersions(prefix: string): AsyncIterable<ObjectVersion> {
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
    do {
      const page = await this.#client.send(
        new ListObjectVersionsCommand({
          Bucket: this.#bucket,
          Prefix: prefix,
          KeyMarker: keyMarker,
          VersionIdMarker: versionIdMarker,
        }),
      );
      // Versions and delete markers come back as two separate lists, so their
      // order relative to each other has to be rebuilt from the times.
      for (const version of page.Versions ?? []) {
        if (
          version.Key !== undefined &&
          version.VersionId !== undefined &&
          version.LastModified !== undefined
        ) {
          yield {
            key: version.Key,
            versionId: version.VersionId,
            deleteMarker: false,
            isLatest: version.IsLatest === true,
            lastModified: version.LastModified,
            eTag: bare(version.ETag),
          };
        }
      }
      for (const marker of page.DeleteMarkers ?? []) {
        if (
          marker.Key !== undefined &&
          marker.VersionId !== undefined &&
          marker.LastModified !== undefined
        ) {
          yield {
            key: marker.Key,
            versionId: marker.VersionId,
            deleteMarker: true,
            isLatest: marker.IsLatest === true,
            lastModified: marker.LastModified,
          };
        }
      }
      keyMarker = page.IsTruncated === true ? page.NextKeyMarker : undefined;
      versionIdMarker = page.IsTruncated === true ? page.NextVersionIdMarker : undefined;
    } while (keyMarker !== undefined);
  }
  // #endregion list-versions

  // #region change
  async removeVersion(key: string, versionId: string): Promise<void> {
    // With a version ID this is a real delete. Without one it would add a delete marker.
    await this.#client.send(
      new DeleteObjectCommand({ Bucket: this.#bucket, Key: key, VersionId: versionId }),
    );
  }

  async copyVersion(key: string, versionId: string): Promise<void> {
    const source = `${this.#bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
    await this.#client.send(
      new CopyObjectCommand({
        Bucket: this.#bucket,
        Key: key,
        CopySource: `${source}?versionId=${encodeURIComponent(versionId)}`,
      }),
    );
  }
  // #endregion change

  async *listCurrent(prefix: string): AsyncIterable<CurrentObject> {
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
          yield {
            key: object.Key,
            eTag: bare(object.ETag),
            size: object.Size ?? 0,
            lastModified: object.LastModified,
          };
        }
      }
      token = page.IsTruncated === true ? page.NextContinuationToken : undefined;
    } while (token !== undefined);
  }
}
