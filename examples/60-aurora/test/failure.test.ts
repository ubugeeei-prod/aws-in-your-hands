import { describe, expect, it } from "vite-plus/test";

import { classify, ConnectionLostError } from "../src/failure.ts";

const sql = (code: string) => Object.assign(new Error("from the database"), { code });

describe("classify", () => {
  it.each([
    ["40001", "conflict"],
    ["40P01", "conflict"],
    ["25006", "read_only"],
    ["08006", "connection"],
    ["08003", "connection"],
    ["57P01", "connection"],
    ["57P03", "connection"],
    // unique_violation, check_violation, query_canceled: answers, not interruptions.
    ["23505", "other"],
    ["23514", "other"],
    ["57014", "other"],
  ] as const)("reads SQLSTATE %s as %s", (code, expected) => {
    expect(classify(sql(code))).toBe(expected);
  });

  it("reads an adapter's ConnectionLostError as a lost connection", () => {
    expect(classify(new ConnectionLostError("gone"))).toBe("connection");
  });

  it("does not guess from a message or from a code that is not a SQLSTATE", () => {
    expect(classify(new Error("Connection terminated unexpectedly"))).toBe("other");
    expect(classify(Object.assign(new Error("reset"), { code: "ECONNRESET" }))).toBe("other");
    expect(classify(undefined)).toBe("other");
  });
});
