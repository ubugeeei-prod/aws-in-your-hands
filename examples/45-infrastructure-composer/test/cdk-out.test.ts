import { describe, expect, test } from "vite-plus/test";

import { chooseTemplate } from "../src/cdk-out.ts";

const files = [
  "AihShipApi.assets.json",
  "AihShipApi.template.json",
  "AihShipCi.template.json",
  "manifest.json",
  "tree.json",
];

describe("which template in cdk.out", () => {
  test("the named stack", () => {
    expect(chooseTemplate(files, "AihShipCi")).toEqual({
      ok: true,
      file: "AihShipCi.template.json",
    });
  });

  test("the only stack, when none is named", () => {
    expect(chooseTemplate(["AihHello.template.json", "manifest.json"], undefined)).toEqual({
      ok: true,
      file: "AihHello.template.json",
    });
  });

  test("several stacks and no name: ask, do not guess", () => {
    expect(chooseTemplate(files, undefined)).toEqual({
      ok: false,
      reason: "name one of: AihShipApi, AihShipCi",
    });
  });

  test("a name that is not there lists what is", () => {
    const choice = chooseTemplate(files, "AihShip");
    expect(choice.ok).toBe(false);
    expect(choice.ok ? "" : choice.reason).toContain("AihShipApi, AihShipCi");
  });

  test("a directory that was never synthesized", () => {
    expect(chooseTemplate(["manifest.json"], undefined).ok).toBe(false);
  });
});
