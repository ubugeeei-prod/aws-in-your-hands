import { describe, expect, it } from "vite-plus/test";

import { identifier, inline, integer, list, sql, text, trusted } from "../src/statement.ts";

describe("a statement", () => {
  it("turns each parameter into a question mark and keeps the values beside the text", () => {
    const statement = sql`SELECT * FROM t WHERE a = ${text("x")} AND b >= ${integer(500)}`;
    expect(statement).toEqual({
      sql: "SELECT * FROM t WHERE a = ? AND b >= ?",
      parameters: ["'x'", "500"],
    });
  });

  it("refuses a bare string, which is how user input would get into the text", () => {
    const route = "/notes" as unknown as ReturnType<typeof text>;
    expect(() => sql`SELECT * FROM t WHERE route = ${route}`).toThrow(/Only parameters/);
  });

  it("refuses text with a question mark of its own, which would shift every parameter", () => {
    expect(() => sql`SELECT ${trusted("a ? b")} FROM t WHERE c = ${text("x")}`).toThrow(
      /question mark/,
    );
  });
});

describe("a text parameter", () => {
  it("is a quoted literal, with a quote inside it doubled", () => {
    expect(sql`SELECT ${text("O'Reilly")}`.parameters).toEqual(["'O''Reilly'"]);
  });

  it("stays one literal whatever the value tries", () => {
    for (const hostile of ["' OR '1'='1", "x'; DROP TABLE requests; --", "\\'", "''", "?"]) {
      const [literal = ""] = sql`SELECT ${text(hostile)}`.parameters;
      // Inside the outer quotes every quote is one half of a pair: nothing ends the literal early.
      expect(literal.slice(1, -1).replaceAll("''", "")).not.toContain("'");
      expect(literal.startsWith("'") && literal.endsWith("'")).toBe(true);
    }
  });

  it("refuses control characters and values past the API's 1,024 characters", () => {
    expect(() => text("a\u0000b")).toThrow(/control/);
    expect(() => text("x".repeat(1023))).toThrow(/1024/);
    expect(text("x".repeat(1022))).toBeDefined();
  });
});

describe("an integer parameter", () => {
  it("refuses what is not a whole number", () => {
    expect(() => integer(Number.NaN)).toThrow();
    expect(() => integer(1.5)).toThrow();
    expect(sql`SELECT ${integer(-3)}`.parameters).toEqual(["-3"]);
  });
});

describe("an identifier", () => {
  it("is one of the names listed, or nothing", () => {
    const columns = ["route", "status"] as const;
    expect(sql`SELECT ${identifier("route", columns)} FROM t`.sql).toBe("SELECT route FROM t");
    expect(() => identifier("route; DROP TABLE t", columns)).toThrow(/Not a known name/);
    expect(() => identifier("event_id", columns)).toThrow(/Not a known name/);
  });

  it("joins into a column list", () => {
    expect(sql`SELECT ${list([trusted("a"), trusted("b")])} FROM t`.sql).toBe("SELECT a, b FROM t");
  });
});

describe("inlining", () => {
  it("writes the literals where the question marks were", () => {
    expect(inline(sql`SELECT * FROM t WHERE a = ${text("O'Reilly")} AND b = ${integer(2)}`)).toBe(
      "SELECT * FROM t WHERE a = 'O''Reilly' AND b = 2",
    );
  });

  it("refuses a statement whose marks and values do not pair up", () => {
    expect(() => inline({ sql: "SELECT ?", parameters: [] })).toThrow(/more question marks/);
    expect(() => inline({ sql: "SELECT 1", parameters: ["2"] })).toThrow(/more parameters/);
  });
});
