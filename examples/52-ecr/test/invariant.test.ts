import { describe, expect, it } from "vite-plus/test";

import type { Mutability } from "../src/mutability.ts";
import type { Reference } from "../src/reference.ts";
import { createRepository } from "../src/registry.ts";
import { digestOf } from "./digests.ts";

// The invariant: the image a task definition names is the image that runs.
// The repository here is the model in src/registry.ts, not ECR.

const MUTABLE: Mutability = { mode: "MUTABLE", exclusions: [] };
const IMMUTABLE: Mutability = { mode: "IMMUTABLE", exclusions: [] };

const good = digestOf("the build that was tested");
const bad = digestOf("the build that broke production");

describe("a task definition that names a tag", () => {
  it("starts two different images when the tag moves between two task starts", () => {
    const repository = createRepository(MUTABLE);
    const taskDefinition: Reference = { by: "tag", tag: "prod" };

    repository.push("prod", good);
    const first = repository.pull(taskDefinition);
    expect(repository.push("prod", bad)).toEqual({ ok: true, moved: true });
    const second = repository.pull(taskDefinition);

    // One task definition, never edited, and two images.
    expect(first).toEqual({ ok: true, digest: good });
    expect(second).toEqual({ ok: true, digest: bad });
  });

  it("rolls back to the broken image, because the old revision names the same tag", () => {
    const repository = createRepository(MUTABLE);
    const revision1: Reference = { by: "tag", tag: "prod" };
    repository.push("prod", good);
    expect(repository.pull(revision1)).toEqual({ ok: true, digest: good });

    // The next release moves the tag. Revision 2 has the same text as revision 1.
    repository.push("prod", bad);
    const revision2: Reference = { by: "tag", tag: "prod" };
    expect(repository.pull(revision2)).toEqual({ ok: true, digest: bad });

    // "Roll back to revision 1" is a new deployment, and it resolves the tag again.
    expect(repository.pull(revision1)).toEqual({ ok: true, digest: bad });
    // The good image is still stored. Nothing names it any more.
    expect(repository.untagged()).toEqual([good]);
  });
});

describe("the two repairs", () => {
  it("an immutable repository refuses to move the tag", () => {
    const repository = createRepository(IMMUTABLE);
    repository.push("v1.0.0", good);

    expect(repository.push("v1.0.0", bad)).toEqual({
      ok: false,
      error: "ImageTagAlreadyExistsException",
    });
    expect(repository.pull({ by: "tag", tag: "v1.0.0" })).toEqual({ ok: true, digest: good });
  });

  it("an immutable repository still takes a second tag for the same image", () => {
    const repository = createRepository(IMMUTABLE);
    repository.push("sha-0123abc", good);

    expect(repository.push("v1.0.0", good)).toEqual({ ok: true, moved: false });
    expect(repository.pull({ by: "tag", tag: "v1.0.0" })).toEqual({ ok: true, digest: good });
  });

  it("a digest names the same image however the tags move", () => {
    const repository = createRepository(MUTABLE);
    repository.push("prod", good);
    const revision1: Reference = { by: "digest", digest: good };

    repository.push("prod", bad);

    expect(repository.pull(revision1)).toEqual({ ok: true, digest: good });
  });

  it("a digest fails to start rather than start something else when the image is gone", () => {
    const repository = createRepository(IMMUTABLE);
    repository.push("sha-0123abc", good);
    const revision1: Reference = { by: "digest", digest: good };

    // A lifecycle rule or a person deletes it; a later build takes the tag name again.
    repository.delete(good);
    repository.push("sha-0123abc", bad);

    expect(repository.pull(revision1)).toEqual({ ok: false, error: "ImageNotFound" });
    // In this model a deleted image frees its tag. Whether ECR does was not confirmed.
    expect(repository.pull({ by: "tag", tag: "sha-0123abc" })).toEqual({ ok: true, digest: bad });
  });
});
