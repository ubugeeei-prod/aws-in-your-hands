import { describe, expect, it } from "vite-plus/test";

import { parseReference, referenceUri } from "../src/reference.ts";
import { digestOf } from "./digests.ts";

const REPOSITORY = "111122223333.dkr.ecr.ap-northeast-1.amazonaws.com/notes";

describe("image references", () => {
  it("writes a digest with @ and a tag with :", () => {
    const digest = digestOf("a");
    expect(referenceUri(REPOSITORY, { by: "digest", digest })).toBe(`${REPOSITORY}@${digest}`);
    expect(referenceUri(REPOSITORY, { by: "tag", tag: "v1.2.0" })).toBe(`${REPOSITORY}:v1.2.0`);
  });

  it("reads back what it wrote", () => {
    for (const reference of [
      { by: "digest", digest: digestOf("a") },
      { by: "tag", tag: "sha-0123abc" },
    ] as const) {
      expect(parseReference(referenceUri(REPOSITORY, reference))).toEqual({
        repositoryUri: REPOSITORY,
        reference,
      });
    }
  });

  it("refuses a URI that names no image, because a registry would read it as latest", () => {
    expect(() => parseReference(REPOSITORY)).toThrow(/neither a tag nor a digest/);
    expect(() => parseReference("localhost:5000/notes")).toThrow(/neither a tag nor a digest/);
  });

  it("refuses a digest that is not a full SHA-256", () => {
    expect(() => parseReference(`${REPOSITORY}@sha256:abc`)).toThrow();
    expect(() => parseReference(`${REPOSITORY}@${digestOf("a").toUpperCase()}`)).toThrow();
  });
});
