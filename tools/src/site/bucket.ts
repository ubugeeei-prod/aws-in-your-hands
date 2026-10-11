import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import type { LocalFile, RemoteObject, Upload } from "./plan.ts";

export function listLocal(directory: string): LocalFile[] {
  const files: LocalFile[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else {
        const body = readFileSync(path);
        files.push({
          key: relative(directory, path).split(sep).join("/"),
          md5: createHash("md5").update(body).digest("hex"),
          size: body.byteLength,
        });
      }
    }
  };
  walk(directory);
  return files;
}

export async function listRemote(s3: S3Client, bucket: string): Promise<RemoteObject[]> {
  const objects: RemoteObject[] = [];
  let token: string | undefined;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
    for (const object of page.Contents ?? []) {
      if (object.Key !== undefined && object.ETag !== undefined && object.LastModified !== undefined) {
        objects.push({ key: object.Key, etag: object.ETag, lastModified: object.LastModified });
      }
    }
    token = page.IsTruncated === true ? page.NextContinuationToken : undefined;
  } while (token !== undefined);
  return objects;
}

export async function upload(s3: S3Client, bucket: string, directory: string, uploads: Upload[]): Promise<void> {
  for (const item of uploads) {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: item.key,
        Body: readFileSync(join(directory, item.key)),
        ContentType: item.contentType,
        CacheControl: item.cacheControl,
      }),
    );
    console.log(`  put ${item.key}`);
  }
}

export async function remove(s3: S3Client, bucket: string, keys: string[]): Promise<void> {
  // DeleteObjects accepts at most 1,000 keys per request.
  for (let start = 0; start < keys.length; start += 1000) {
    const batch = keys.slice(start, start + 1000);
    const response = await s3.send(
      new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }),
    );
    if ((response.Errors ?? []).length > 0) {
      throw new Error(`S3 could not delete ${response.Errors?.length} object(s), first: ${response.Errors?.[0]?.Key}`);
    }
    for (const key of batch) {
      console.log(`  delete ${key}`);
    }
  }
}
