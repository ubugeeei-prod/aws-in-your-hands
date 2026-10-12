import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { BOOK_QUOTAS, describeQuotas, listedQuotasSchema } from "../src/quotas.ts";

// The shape of the example in the Service Quotas user guide, with this book's two coded quotas.
const listed = {
  Quotas: [
    {
      QuotaName: "Routes per API",
      Adjustable: true,
      QuotaArn: "arn:aws:servicequotas:ap-northeast-1:111122223333:apigateway/L-65B5C802",
      Value: 300.0,
      QuotaAppliedAtLevel: "ACCOUNT",
      ServiceName: "Amazon API Gateway",
      GlobalQuota: false,
      ServiceCode: "apigateway",
      QuotaCode: "L-65B5C802",
      Unit: "None",
    },
    {
      QuotaName: "Maximum integration timeout",
      Adjustable: false,
      Value: 30.0,
      ServiceCode: "apigateway",
      QuotaCode: "L-EXAMPLE1",
    },
    {
      QuotaName: "Throttle quota per account, per Region",
      Adjustable: true,
      Value: 10000.0,
      ServiceCode: "apigateway",
      QuotaCode: "L-8A5B8E43",
      Unit: "None",
    },
  ],
};

describe("the list Service Quotas prints", () => {
  it("is read with the fields this chapter uses, whatever else it carries", () => {
    const { Quotas } = v.parse(listedQuotasSchema, listed);
    expect(Quotas.map((quota) => quota.QuotaCode)).toEqual([
      "L-65B5C802",
      "L-EXAMPLE1",
      "L-8A5B8E43",
    ]);
  });

  it("is refused when a value is not a number", () => {
    const broken = { Quotas: [{ ...listed.Quotas[0], Value: "300" }] };
    expect(v.safeParse(listedQuotasSchema, broken).success).toBe(false);
  });

  it("is shown with the quotas you can ask to raise first", () => {
    const lines = describeQuotas(v.parse(listedQuotasSchema, listed).Quotas);
    expect(lines.map((line) => line.split(/\s{2,}/)[1])).toEqual([
      "adjustable",
      "adjustable",
      "fixed",
    ]);
    expect(lines[0]).toContain("Routes per API");
  });
});

describe("the book's own list of quotas", () => {
  it("names a source and a reading date for every entry", () => {
    for (const quota of BOOK_QUOTAS) {
      expect(quota.source).toMatch(/^[a-z0-9-]+$/);
      expect(quota.readOn).toMatch(/^2026-10-1[23]$/);
      expect(quota.chapters.length).toBeGreaterThan(0);
    }
  });

  it("carries a quota code only in the form Service Quotas uses", () => {
    const codes = BOOK_QUOTAS.flatMap((quota) => quota.quotaCode ?? []);
    expect(codes).toEqual(["L-8A5B8E43"]);
    expect(codes.every((code) => /^L-[0-9A-F]{8}$/.test(code))).toBe(true);
  });
});
