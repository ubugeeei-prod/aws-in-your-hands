import * as v from "valibot";

// #region catalog
export type BookQuota = {
  service: string;
  name: string;
  /** As the documentation words it, on the day it was read. */
  defaultValue: string;
  adjustable: boolean;
  /** The code Service Quotas knows it by, where the documentation gives one. */
  quotaCode?: string;
  chapters: string[];
  /** An id in data/sources.json. */
  source: string;
  readOn: string;
};

// The defaults the book's chapters lean on. An account's own values can differ: new
// accounts start lower, and an increase raises them. `vp run limits:quotas` shows yours.
export const BOOK_QUOTAS: BookQuota[] = [
  {
    service: "Lambda",
    name: "Concurrent executions",
    defaultValue: "1,000 per Region",
    adjustable: true,
    chapters: ["04", "09", "17", "21", "29"],
    source: "limits-lambda-quotas",
    readOn: "2026-10-12",
  },
  {
    service: "Lambda",
    name: "Concurrency that must stay unreserved",
    defaultValue: "100",
    adjustable: false,
    chapters: ["09", "17", "21"],
    source: "limits-lambda-reserved-concurrency",
    readOn: "2026-10-12",
  },
  {
    service: "Lambda",
    name: "Function timeout",
    defaultValue: "900 seconds",
    adjustable: false,
    chapters: ["08", "12", "16", "23"],
    source: "limits-lambda-quotas",
    readOn: "2026-10-12",
  },
  {
    service: "Lambda",
    name: "Invocation payload (synchronous)",
    defaultValue: "6 MB each for request and response",
    adjustable: false,
    chapters: ["07", "09"],
    source: "limits-lambda-quotas",
    readOn: "2026-10-12",
  },
  {
    service: "API Gateway",
    name: "Throttle per account, per Region, across all APIs",
    defaultValue: "10,000 requests per second, bucket of 5,000",
    adjustable: true,
    quotaCode: "L-8A5B8E43",
    chapters: ["04", "05", "06", "13", "14", "19"],
    source: "limits-apigw-account-quotas",
    readOn: "2026-10-12",
  },
  {
    service: "API Gateway",
    name: "HTTP API: maximum integration timeout",
    defaultValue: "30 seconds",
    adjustable: false,
    chapters: ["12"],
    source: "limits-apigw-http-quotas",
    readOn: "2026-10-12",
  },
  {
    service: "DynamoDB",
    name: "On-demand throughput per table",
    defaultValue: "40,000 read request units and 40,000 write request units per second",
    adjustable: true,
    chapters: ["05", "08", "19"],
    source: "limits-dynamodb-quotas",
    readOn: "2026-10-12",
  },
];
// #endregion catalog

// #region listed
// What `aws service-quotas list-service-quotas --output json` prints, as far as this chapter reads it.
export const listedQuotasSchema = v.object({
  Quotas: v.array(
    v.object({
      ServiceCode: v.string(),
      QuotaName: v.string(),
      QuotaCode: v.string(),
      Value: v.pipe(v.number(), v.finite()),
      Adjustable: v.boolean(),
      GlobalQuota: v.optional(v.boolean(), false),
      Unit: v.optional(v.string(), "None"),
    }),
  ),
});

export type ListedQuota = v.InferOutput<typeof listedQuotasSchema>["Quotas"][number];

/** One line per quota, the ones you can ask to raise first. */
export function describeQuotas(quotas: ListedQuota[]): string[] {
  return quotas
    .toSorted(
      (a, b) =>
        Number(b.Adjustable) - Number(a.Adjustable) || a.QuotaName.localeCompare(b.QuotaName),
    )
    .map(
      (quota) =>
        `${quota.QuotaCode}  ${quota.Adjustable ? "adjustable" : "fixed     "}  ` +
        `${String(quota.Value).padStart(12)}  ${quota.QuotaName}`,
    );
}
// #endregion listed
