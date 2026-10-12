import type { Mutability } from "./mutability.ts";
import { tagCanMove } from "./mutability.ts";
import type { Digest, Reference } from "./reference.ts";

// A model of one repository, for the tests. It is this book's reading of the
// documentation, not ECR: it knows tags, digests, and the mutability setting.

// #region registry
export type PushResult =
  | { ok: true; moved: boolean }
  | { ok: false; error: "ImageTagAlreadyExistsException" };

export type Pulled = { ok: true; digest: Digest } | { ok: false; error: "ImageNotFound" };

export function createRepository(setting: Mutability) {
  const images = new Set<Digest>();
  const tags = new Map<string, Digest>();

  return {
    push(tag: string, digest: Digest): PushResult {
      const current = tags.get(tag);
      if (current !== undefined && current !== digest && !tagCanMove(setting, tag)) {
        return { ok: false, error: "ImageTagAlreadyExistsException" };
      }
      images.add(digest);
      tags.set(tag, digest);
      // The image the tag left stays in the repository, untagged unless another tag names it.
      return { ok: true, moved: current !== undefined && current !== digest };
    },

    /** What a pull does: a tag is looked up now; a digest is the image or nothing. */
    pull(reference: Reference): Pulled {
      const digest = reference.by === "digest" ? reference.digest : tags.get(reference.tag);
      return digest !== undefined && images.has(digest)
        ? { ok: true, digest }
        : { ok: false, error: "ImageNotFound" };
    },

    /** What a lifecycle rule or a person does. Tags on the image go with it. */
    delete(digest: Digest): void {
      images.delete(digest);
      for (const [tag, target] of tags) {
        if (target === digest) {
          tags.delete(tag);
        }
      }
    },

    untagged(): Digest[] {
      const named = new Set(tags.values());
      return [...images].filter((digest) => !named.has(digest));
    },
  };
}
// #endregion registry
