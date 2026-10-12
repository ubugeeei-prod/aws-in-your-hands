import * as v from "valibot";

// #region limits
// Quotas on key value stores, CloudFront Developer Guide.
export const LIMITS = {
  keyBytes: 512,
  valueBytes: 1024,
  storeBytes: 5 * 1024 * 1024,
  keysPerUpdate: 50,
} as const;
// #endregion limits

// #region schema
// The function looks up at most this many characters, so longer rules could never match.
const MAX_PATH = 256;

// Starts with one slash, printable ASCII, no backslash: a path on this site and nowhere else.
const sitePath = v.pipe(
  v.string(),
  v.maxLength(MAX_PATH),
  v.regex(/^\/(?!\/)[\x21-\x5b\x5d-\x7e]*$/, "must be a same-site path such as /pricing/"),
);

const redirectSchema = v.strictObject({
  // The function never looks up files, queries, or fragments.
  from: v.pipe(
    sitePath,
    v.check(
      (path) => !/[?#]/.test(path) && !path.slice(path.lastIndexOf("/") + 1).includes("."),
      "must be a page path without an extension, a query, or a fragment",
    ),
  ),
  to: sitePath,
  status: v.union([v.literal(301), v.literal(302), v.literal(307), v.literal(308)]),
});
type Redirect = v.InferOutput<typeof redirectSchema>;

/** Where in the list a problem is, so that it is reported as `redirects.1.from`. */
const at = (
  rules: Redirect[],
  index: number,
  field: "from" | "to",
): [v.IssuePathItem, v.IssuePathItem] => [
  { type: "array", origin: "value", input: rules, key: index, value: rules[index] },
  {
    type: "object",
    origin: "value",
    input: rules[index] ?? {},
    key: field,
    value: rules[index]?.[field],
  },
];

export const edgeDataSchema = v.strictObject({
  flags: v.strictObject({ maintenance: v.boolean(), newHome: v.boolean() }),
  redirects: v.pipe(
    v.array(redirectSchema),
    // Rules are compared with each other here, which a check on one rule cannot do.
    v.rawCheck(({ dataset, addIssue }) => {
      if (!dataset.typed) {
        return;
      }
      const rules = dataset.value;
      const sources = new Set<string>();
      for (const [index, rule] of rules.entries()) {
        if (sources.has(rule.from)) {
          addIssue({ path: at(rules, index, "from"), message: `${rule.from} is listed twice` });
        }
        sources.add(rule.from);
      }
      for (const [index, rule] of rules.entries()) {
        // A redirect that lands on another redirect can become a loop one edit later.
        if (sources.has(rule.to.split(/[?#]/)[0] ?? rule.to)) {
          addIssue({
            path: at(rules, index, "to"),
            message: `${rule.to} is itself redirected; point ${rule.from} at the final page`,
          });
        }
      }
    }),
  ),
});

export type EdgeData = v.InferOutput<typeof edgeDataSchema>;
// #endregion schema

// #region entries
/** The key-value pairs the edge function reads. Flags are written both ways, so "off" is a value, not an absence. */
export function toEntries(data: EdgeData): Map<string, string> {
  const entries = new Map<string, string>([
    ["flag:maintenance", data.flags.maintenance ? "on" : "off"],
    ["flag:new-home", data.flags.newHome ? "on" : "off"],
  ]);
  for (const rule of data.redirects) {
    entries.set(`redirect:${rule.from}`, JSON.stringify({ to: rule.to, status: rule.status }));
  }
  return entries;
}

const bytes = (text: string): number => Buffer.byteLength(text, "utf8");

/** Problems AWS would reject, found before the first write. AWS's own size count has the final say. */
export function checkLimits(entries: ReadonlyMap<string, string>): string[] {
  const problems: string[] = [];
  let total = 0;
  for (const [key, value] of entries) {
    total += bytes(key) + bytes(value);
    if (bytes(key) > LIMITS.keyBytes) {
      problems.push(
        `key "${key.slice(0, 40)}..." is ${bytes(key)} bytes; the limit is ${LIMITS.keyBytes}`,
      );
    }
    if (bytes(value) > LIMITS.valueBytes) {
      problems.push(
        `value of "${key}" is ${bytes(value)} bytes; the limit is ${LIMITS.valueBytes}`,
      );
    }
  }
  if (total > LIMITS.storeBytes) {
    problems.push(`${entries.size} pairs take ${total} bytes; a store holds ${LIMITS.storeBytes}`);
  }
  return problems;
}
// #endregion entries
