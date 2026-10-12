import { readFileSync } from "node:fs";

import * as v from "valibot";

// #region kinds
/** Each log, the file its documented CREATE TABLE lives in, and the placeholders that text holds. */
const TEMPLATES = {
  cloudtrail: {
    file: "cloudtrail.sql",
    table: "cloudtrail_logs_pp",
    replace: (input: Input) => [
      ["s3://amzn-s3-demo-bucket/AWSLogs/account-id/CloudTrail/aws-region", `${base(input)}`],
      ["2020/01/01", input.since.replaceAll("-", "/")],
    ],
  },
  alb: {
    file: "alb.sql",
    table: "alb_access_logs",
    replace: (input: Input) => [
      ["s3://amzn-s3-demo-bucket/access-log-folder-path/", `${base(input)}/`],
    ],
  },
  cloudfront: {
    file: "cloudfront.sql",
    table: "cloudfront_standard_logs",
    replace: (input: Input) => [["s3://amzn-s3-demo-bucket/", `${base(input)}/`]],
  },
  "s3-access": {
    file: "s3-access.sql",
    table: "s3_access_logs_db.mybucket_logs",
    replace: (input: Input) => [
      ["s3://bucket-name/prefix-name/account-id/region/source-bucket-name/", `${base(input)}/`],
      ["2024/01/01", input.since.replaceAll("-", "/")],
    ],
  },
} as const satisfies Record<
  string,
  { file: string; table: string; replace: (input: Input) => string[][] }
>;

export type LogKind = keyof typeof TEMPLATES;
export const LOG_KINDS = Object.keys(TEMPLATES) as LogKind[];
// #endregion kinds

// #region input
// DDL takes no parameters, so everything placed in it is checked here, character by character.
export const logTableSchema = v.object({
  // Lower-case letters, digits, hyphens and dots, as S3 names general purpose buckets.
  bucket: v.pipe(v.string(), v.regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/)),
  // The folder the logs are under, without slashes at either end. Empty for the bucket's root.
  prefix: v.pipe(v.string(), v.regex(/^([A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*)?$/)),
  table: v.pipe(v.string(), v.regex(/^[a-z][a-z0-9_]{0,63}$/)),
  // The first day the table looks for, where the definition projects partitions by date.
  since: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)),
});
type Input = v.InferOutput<typeof logTableSchema>;

const base = (input: Input): string =>
  `s3://${input.bucket}${input.prefix === "" ? "" : `/${input.prefix}`}`;
// #endregion input

// #region ddl
const read = (file: string): string =>
  readFileSync(new URL(`../sql/${file}`, import.meta.url), "utf8")
    .split("\n")
    // The files open with comment lines that say where the text came from.
    .filter((line) => !line.startsWith("-- "))
    .join("\n")
    .trim();

/**
 * The CREATE TABLE statement AWS documents for this log, with the placeholders
 * filled in. The columns and the SerDe are AWS's text, untouched.
 */
export function logTableDdl(kind: LogKind, input: unknown): string {
  const checked = v.parse(logTableSchema, input);
  const template = TEMPLATES[kind];
  let ddl = read(template.file);
  for (const [placeholder, value] of [
    [template.table, checked.table],
    ...template.replace(checked),
  ]) {
    if (placeholder === undefined || value === undefined || !ddl.includes(placeholder)) {
      throw new Error(`The ${kind} template no longer holds ${String(placeholder)}`);
    }
    ddl = ddl.replaceAll(placeholder, value);
  }
  return ddl;
}
// #endregion ddl
