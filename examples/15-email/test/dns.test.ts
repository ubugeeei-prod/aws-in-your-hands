import { describe, expect, it } from "vite-plus/test";
import { dnsRecords } from "../src/dns.ts";

const dkim = [1, 2, 3].map((n) => ({
  name: `token${n}._domainkey.example.com`,
  value: `token${n}.dkim.amazonses.com`,
}));

describe("DNS records to publish", () => {
  it("lists the three DKIM records as SES gave them, and a monitoring-only DMARC policy", () => {
    const records = dnsRecords({ domain: "example.com", dkim, region: "ap-northeast-1" });
    expect(records.map((record) => `${record.type} ${record.name} ${record.value}`)).toEqual([
      "CNAME token1._domainkey.example.com token1.dkim.amazonses.com",
      "CNAME token2._domainkey.example.com token2.dkim.amazonses.com",
      "CNAME token3._domainkey.example.com token3.dkim.amazonses.com",
      'TXT _dmarc.example.com "v=DMARC1; p=none"',
    ]);
  });

  it("adds one MX and one SPF record for a custom MAIL FROM domain, in the stack's region", () => {
    const records = dnsRecords({
      domain: "example.com",
      dkim,
      region: "ap-northeast-1",
      mailFromDomain: "bounce.example.com",
      dmarcReportAddress: "dmarc@example.com",
    });
    expect(records.filter((record) => record.name === "bounce.example.com")).toMatchObject([
      { type: "MX", value: "10 feedback-smtp.ap-northeast-1.amazonses.com" },
      { type: "TXT", value: '"v=spf1 include:amazonses.com ~all"' },
    ]);
    expect(records.at(-1)?.value).toBe('"v=DMARC1; p=none; rua=mailto:dmarc@example.com"');
  });
});
