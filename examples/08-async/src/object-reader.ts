// #region port
export type ReadResult =
  | { status: "found"; bytes: Uint8Array; size: number; contentType: string }
  /** Nothing is stored under the key any more. */
  | { status: "gone" }
  /** Something is stored under the key, but not the bytes this event is about. */
  | { status: "changed" };

// The worker asks for "the object this event describes", not "whatever is under
// this key now". Between the event and the read, the object may have been replaced.
export interface ObjectReader {
  readExact(key: string, eTag: string, maxBytes: number): Promise<ReadResult>;
}
// #endregion port
