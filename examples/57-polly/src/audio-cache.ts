// #region port
/** What the app needs from the place that keeps audio: S3 in AWS, a Map on a laptop. */
export type AudioCache = {
  exists(key: string): Promise<boolean>;
  /** Writes only if nothing is there. Of two callers at once, one is told `created: false`. */
  create(
    key: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<{ created: true; etag: string } | { created: false }>;
  read(key: string): Promise<{ body: Uint8Array; etag: string } | undefined>;
  /** Writes only if the object is still the one that was read. */
  replace(
    key: string,
    etag: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<{ replaced: true; etag: string } | { replaced: false }>;
  presignView(key: string, expiresInSeconds: number): Promise<string>;
};
// #endregion port
