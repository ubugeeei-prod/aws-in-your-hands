import { describe, expect, it } from "vite-plus/test";
import { checkLimits, type EdgeData, edgeDataSchema, LIMITS, toEntries } from "../src/kvs/config.ts";
import { planSync, toBatches } from "../src/kvs/plan.ts";

const data = (overrides: Partial<EdgeData> = {}): unknown => ({
  flags: { maintenance: false, newHome: false },
  redirects: [{ from: "/plans", to: "/pricing/", status: 301 }],
  ...overrides,
});
const issues = (input: unknown): string[] => {
  const result = edgeDataSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
};

describe("edge data", () => {
  it("accepts the shape the function reads", () => {
    expect(issues(data())).toEqual([]);
    expect([...toEntries(edgeDataSchema.parse(data()))]).toEqual([
      ["flag:maintenance", "off"],
      ["flag:new-home", "off"],
      ["redirect:/plans", '{"to":"/pricing/","status":301}'],
    ]);
  });

  it.each([
    ["another site", "https://example.org/"],
    ["a protocol-relative URL", "//example.org/"],
    ["a backslash", "/\\example.org"],
    ["a path with a space", "/two words"],
  ])("refuses a redirect to %s", (_label, to) => {
    expect(issues(data({ redirects: [{ from: "/plans", to, status: 301 }] }))).not.toEqual([]);
  });

  it.each(["/app.css", "/plans?x=1", "plans", `/${"a".repeat(300)}`])(
    "refuses a redirect from %s, which the function would never look up",
    (from) => {
      expect(issues(data({ redirects: [{ from, to: "/pricing/", status: 301 }] }))).not.toEqual([]);
    },
  );

  it("refuses duplicate sources, chains, and loops", () => {
    expect(
      issues(
        data({
          redirects: [
            { from: "/a", to: "/b", status: 301 },
            { from: "/a", to: "/c", status: 301 },
          ],
        }),
      ),
    ).toEqual(["redirects.1.from: /a is listed twice"]);
    expect(
      issues(
        data({
          redirects: [
            { from: "/a", to: "/b?x=1", status: 301 },
            { from: "/b", to: "/a", status: 301 },
          ],
        }),
      ),
    ).toHaveLength(2);
    expect(issues(data({ redirects: [{ from: "/a", to: "/a", status: 301 }] }))).toHaveLength(1);
  });

  it("refuses a status that is not a redirect and an unknown flag", () => {
    expect(issues(data({ redirects: [{ from: "/a", to: "/b", status: 200 as 301 }] }))).not.toEqual([]);
    expect(issues({ flags: { maintenance: false, newHome: false, beta: true }, redirects: [] })).not.toEqual([]);
  });

  it("finds pairs that would not fit before anything is written", () => {
    expect(checkLimits(new Map([["flag:maintenance", "on"]]))).toEqual([]);
    expect(checkLimits(new Map([[`redirect:/${"é".repeat(260)}`, "x"]]))).toHaveLength(1);
    expect(checkLimits(new Map([["redirect:/a", "x".repeat(LIMITS.valueBytes + 1)]]))).toHaveLength(1);

    const full = new Map(Array.from({ length: 5200 }, (_, index) => [`redirect:/${index}`, "x".repeat(1000)]));
    expect(checkLimits(full)).toEqual([expect.stringContaining("a store holds 5242880")]);
  });
});

describe("planSync", () => {
  const desired = new Map([
    ["flag:maintenance", "off"],
    ["redirect:/plans", "new"],
    ["redirect:/sale", "same"],
  ]);

  it("puts what differs, deletes what is gone, and leaves the rest", () => {
    const current = new Map([
      ["redirect:/plans", "old"],
      ["redirect:/sale", "same"],
      ["redirect:/gone", "x"],
    ]);
    expect(planSync(desired, current)).toEqual({
      puts: [
        { key: "flag:maintenance", value: "off" },
        { key: "redirect:/plans", value: "new" },
      ],
      deletes: ["redirect:/gone"],
      unchanged: 1,
      foreign: [],
    });
  });

  it("never deletes a key outside its own prefixes", () => {
    const plan = planSync(desired, new Map([...desired, ["tenant:acme", "blue"]]));
    expect(plan.deletes).toEqual([]);
    expect(plan.foreign).toEqual(["tenant:acme"]);
  });

  it("refuses to write a key outside its own prefixes", () => {
    expect(() => planSync(new Map([["tenant:acme", "blue"]]), new Map())).toThrow(/outside/);
  });

  it("plans nothing when the store already matches", () => {
    expect(planSync(desired, desired)).toMatchObject({ puts: [], deletes: [], unchanged: 3 });
  });
});

describe("toBatches", () => {
  it("keeps every request within 50 keys, puts before deletes", () => {
    const desired = new Map(Array.from({ length: 70 }, (_, index) => [`redirect:/new-${index}`, "x"]));
    const current = new Map(Array.from({ length: 40 }, (_, index) => [`redirect:/old-${index}`, "x"]));
    const batches = toBatches(planSync(desired, current));

    expect(batches.map((batch) => batch.puts.length + batch.deletes.length)).toEqual([50, 50, 10]);
    expect(batches.map((batch) => [batch.puts.length, batch.deletes.length])).toEqual([
      [50, 0],
      [20, 30],
      [0, 10],
    ]);
  });

  it("makes no request for an empty plan", () => {
    expect(toBatches(planSync(new Map(), new Map()))).toEqual([]);
  });
});
