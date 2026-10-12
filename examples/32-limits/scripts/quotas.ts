// vp run limits:quotas:book                     (local: the defaults this book's chapters lean on)
// vp run limits:quotas --service lambda         (AWS: the values that apply to your account)
//   node scripts/quotas.ts [--service lambda|apigateway|...] [--book]
//
// Reads only. Service Quotas makes no charge for listing.

import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

import * as v from "valibot";

import { preflight } from "@aih/tools/aws/preflight.ts";

import { BOOK_QUOTAS, describeQuotas, listedQuotasSchema } from "../src/quotas.ts";

const argsSchema = v.object({
  // A service code as Service Quotas spells it. `aws service-quotas list-services` prints them all.
  service: v.optional(v.pipe(v.string(), v.regex(/^[a-z0-9-]+$/)), "lambda"),
  book: v.optional(v.boolean(), false),
});

try {
  const args = v.parse(
    argsSchema,
    parseArgs({ options: { service: { type: "string" }, book: { type: "boolean" } } }).values,
  );
  if (args.book) {
    for (const quota of BOOK_QUOTAS) {
      console.log(
        `${quota.service}: ${quota.name}\n` +
          `  default ${quota.defaultValue} (${quota.adjustable ? "adjustable" : "fixed"}` +
          `${quota.quotaCode === undefined ? "" : `, ${quota.quotaCode}`})\n` +
          `  chapters ${quota.chapters.join(", ")}; read ${quota.readOn}, source "${quota.source}"`,
      );
    }
    process.exit(0);
  }

  const { target } = await preflight({ access: "observe", action: "list service quotas" });
  const result = spawnSync(
    "aws",
    [
      "service-quotas",
      "list-service-quotas",
      "--service-code",
      args.service,
      "--region",
      target.region,
      "--output",
      "json",
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(`aws service-quotas list-service-quotas failed:\n${result.stderr}`);
  }
  const { Quotas } = v.parse(listedQuotasSchema, JSON.parse(result.stdout));
  console.log(`${Quotas.length} quotas for ${args.service} in ${target.region}\n`);
  for (const line of describeQuotas(Quotas)) {
    console.log(line);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
