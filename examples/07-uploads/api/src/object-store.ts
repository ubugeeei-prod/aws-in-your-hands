// #region port
export type UploadForm = { url: string; fields: Record<string, string> };
export type StoredObject = { size: number; contentType: string; lastModified: Date };

// What the app needs from "a place that holds bytes": S3 in AWS, a Map on a laptop.
export type ObjectStore = {
  /** A permit to upload one object: this key, this type, at most this size, until it expires. */
  presignUpload(input: {
    key: string;
    contentType: string;
    maxBytes: number;
    expiresInSeconds: number;
  }): Promise<UploadForm>;
  head(key: string): Promise<StoredObject | undefined>;
  /** Takes the object out of reach of the rule that expires unfinished uploads. */
  markAttached(key: string): Promise<void>;
  presignView(key: string, expiresInSeconds: number): Promise<string>;
  /** Deleting a key that is not there is not an error. */
  delete(key: string): Promise<void>;
  list(prefix: string): AsyncIterable<{ key: string; lastModified: Date }>;
};
// #endregion port

// #region tags
// Every upload arrives carrying this tag, and finishing one takes it off.
// The lifecycle rule in infra/lib/uploads-stack.ts expires objects that still
// carry it one day after they were created.
export const STATE_TAG = "upload-state";
export const PENDING = "pending";
// #endregion tags
