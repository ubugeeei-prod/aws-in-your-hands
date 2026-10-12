import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { mutabilitySchema, tagCanMove } from "../src/mutability.ts";
import { matchesWildcard } from "../src/wildcard.ts";

const setting = (input: unknown) => v.parse(mutabilitySchema, input);

describe("wildcards", () => {
  it("lets * stand for any run of characters, including none", () => {
    // The lifecycle documentation's own examples.
    for (const tag of ["prod", "prod1", "production-team1"]) {
      expect(matchesWildcard("prod*", tag)).toBe(true);
    }
    for (const tag of ["repo-production", "prod-team"]) {
      expect(matchesWildcard("*prod*", tag)).toBe(true);
    }
    expect(matchesWildcard("prod*", "preprod")).toBe(false);
  });

  it("treats every other character literally", () => {
    expect(matchesWildcard("v1.0", "v1x0")).toBe(false);
    expect(matchesWildcard("v?", "v1")).toBe(false);
    expect(matchesWildcard("a*b*c", "a-b-b-c")).toBe(true);
    expect(matchesWildcard("a*b*c", "a-c-b")).toBe(false);
    expect(matchesWildcard("ab*b", "ab")).toBe(false);
  });
});

describe("tag mutability", () => {
  it("lets no tag move in an immutable repository, latest included", () => {
    const immutable = setting({ mode: "IMMUTABLE" });
    expect(["latest", "v1.0.0", "sha-abc"].map((tag) => tagCanMove(immutable, tag))).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("makes the filters the exceptions to the mode", () => {
    const mostlyFixed = setting({
      mode: "IMMUTABLE_WITH_EXCLUSION",
      exclusions: ["latest", "dev-*"],
    });
    expect(tagCanMove(mostlyFixed, "v1.0.0")).toBe(false);
    expect(tagCanMove(mostlyFixed, "latest")).toBe(true);
    expect(tagCanMove(mostlyFixed, "dev-alice")).toBe(true);

    const mostlyLoose = setting({ mode: "MUTABLE_WITH_EXCLUSION", exclusions: ["v*"] });
    expect(tagCanMove(mostlyLoose, "v1.0.0")).toBe(false);
    expect(tagCanMove(mostlyLoose, "latest")).toBe(true);
  });

  it("refuses filters without an exclusion mode, and an exclusion mode without filters", () => {
    expect(() => setting({ mode: "IMMUTABLE", exclusions: ["latest"] })).toThrow();
    expect(() => setting({ mode: "IMMUTABLE_WITH_EXCLUSION" })).toThrow();
  });

  it("refuses more filters, or other characters, than the API accepts", () => {
    const six = ["a", "b", "c", "d", "e", "f"];
    expect(() => setting({ mode: "MUTABLE_WITH_EXCLUSION", exclusions: six })).toThrow();
    expect(() => setting({ mode: "MUTABLE_WITH_EXCLUSION", exclusions: ["v?"] })).toThrow();
  });
});
