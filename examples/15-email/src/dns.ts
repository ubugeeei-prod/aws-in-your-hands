// #region dns
export type DnsRecord = {
  name: string;
  type: "CNAME" | "MX" | "TXT";
  value: string;
  purpose: string;
};

export type DnsInput = {
  domain: string;
  /** Name and value of the three Easy DKIM records, as SES returned them for this identity. */
  dkim: { name: string; value: string }[];
  region: string;
  /** Set only when the identity uses a custom MAIL FROM domain. */
  mailFromDomain?: string | undefined;
  /** Where receivers send their daily DMARC reports. */
  dmarcReportAddress?: string | undefined;
};

/** The records to create by hand at whoever hosts the domain's DNS. */
export function dnsRecords(input: DnsInput): DnsRecord[] {
  const records: DnsRecord[] = input.dkim.map((record) => ({
    name: record.name,
    type: "CNAME",
    value: record.value,
    purpose:
      "DKIM: publishes the key SES signs with. SES verifies the domain by finding all three.",
  }));

  if (input.mailFromDomain !== undefined) {
    records.push(
      {
        name: input.mailFromDomain,
        type: "MX",
        value: `10 feedback-smtp.${input.region}.amazonses.com`,
        purpose: "MAIL FROM: where bounces for the envelope sender go. Exactly one MX record.",
      },
      {
        name: input.mailFromDomain,
        type: "TXT",
        value: '"v=spf1 include:amazonses.com ~all"',
        purpose: "SPF: names SES as an allowed sender for the MAIL FROM domain.",
      },
    );
  }

  // p=none only asks for reports. Tighten to quarantine, then reject, once the reports look right.
  const policy = ["v=DMARC1", "p=none"];
  if (input.dmarcReportAddress !== undefined) {
    policy.push(`rua=mailto:${input.dmarcReportAddress}`);
  }
  records.push({
    name: `_dmarc.${input.domain}`,
    type: "TXT",
    value: `"${policy.join("; ")}"`,
    purpose: "DMARC: tells receivers what to do with mail that fails both SPF and DKIM alignment.",
  });
  return records;
}
// #endregion dns
