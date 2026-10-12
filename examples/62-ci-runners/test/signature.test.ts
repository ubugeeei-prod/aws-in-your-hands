import { describe, expect, it } from "vite-plus/test";

import { sign, verify } from "../src/signature.ts";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("the webhook signature", () => {
  // The secret, payload and result GitHub's documentation gives for testing an implementation.
  it("matches GitHub's documented example", () => {
    const expected = "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";
    expect(sign("It's a Secret to Everybody", bytes("Hello, World!"))).toBe(expected);
    expect(verify("It's a Secret to Everybody", bytes("Hello, World!"), expected)).toBe(true);
  });

  it("refuses a signature made with another secret", () => {
    expect(verify("right", bytes("{}"), sign("wrong", bytes("{}")))).toBe(false);
  });

  it("refuses a body changed after signing", () => {
    expect(verify("s", bytes('{"a":2}'), sign("s", bytes('{"a":1}')))).toBe(false);
  });

  it("refuses a missing, unprefixed, short or non-hex header", () => {
    const good = sign("s", bytes("x"));
    expect(verify("s", bytes("x"), null)).toBe(false);
    expect(verify("s", bytes("x"), good.slice("sha256=".length))).toBe(false);
    expect(verify("s", bytes("x"), good.slice(0, -2))).toBe(false);
    expect(verify("s", bytes("x"), `sha256=${"z".repeat(64)}`)).toBe(false);
    expect(verify("s", bytes("x"), good.replace("sha256=", "sha1="))).toBe(false);
  });

  it("refuses everything when the secret is empty", () => {
    expect(verify("", bytes("x"), sign("", bytes("x")))).toBe(false);
  });
});
