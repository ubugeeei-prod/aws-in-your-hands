import * as v from "valibot";

// #region reference
/** The SHA-256 of an image manifest. Two images with the same digest are the same bytes. */
export const digestSchema = v.pipe(
  v.string(),
  v.regex(/^sha256:[a-f0-9]{64}$/, "expected sha256: followed by 64 hex digits"),
);
export type Digest = v.InferOutput<typeof digestSchema>;

export const tagSchema = v.pipe(
  v.string(),
  v.regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/, "use letters, digits, '_', '.', and '-'"),
);

/** What a task definition can put in `image`: a name that can move, or the bytes themselves. */
export type Reference = { by: "tag"; tag: string } | { by: "digest"; digest: Digest };

export function referenceUri(repositoryUri: string, reference: Reference): string {
  return reference.by === "digest"
    ? `${repositoryUri}@${reference.digest}`
    : `${repositoryUri}:${reference.tag}`;
}

/** Reads `repository:tag` or `repository@sha256:...`. A URI with neither is refused: it would mean `latest`. */
export function parseReference(uri: string): { repositoryUri: string; reference: Reference } {
  const at = uri.indexOf("@");
  if (at !== -1) {
    const digest = v.parse(digestSchema, uri.slice(at + 1));
    return { repositoryUri: uri.slice(0, at), reference: { by: "digest", digest } };
  }
  const colon = uri.lastIndexOf(":");
  // A colon before the last slash is a registry port, not a tag.
  if (colon === -1 || colon < uri.lastIndexOf("/")) {
    throw new Error(`"${uri}" names neither a tag nor a digest`);
  }
  const tag = v.parse(tagSchema, uri.slice(colon + 1));
  return { repositoryUri: uri.slice(0, colon), reference: { by: "tag", tag } };
}
// #endregion reference
