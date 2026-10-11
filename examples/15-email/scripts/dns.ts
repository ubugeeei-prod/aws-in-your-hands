// vp run mail:dns [--report dmarc@your-domain.example]
//
// Prints the DNS records to publish for a domain identity. It changes nothing:
// creating the records at your DNS host is done by hand.
import { parseArgs } from "node:util";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";
import { dnsRecords } from "../src/dns.ts";

const { values } = parseArgs({ options: { report: { type: "string" } } });

try {
  const { target } = await preflight({
    access: "observe",
    action: "read the DKIM records to publish",
    stack: "AihEmail",
  });
  const outputs = await readStackOutputs(process.cwd(), "AihEmail", target.region);
  const domain = requireOutput(outputs, "SenderIdentity");
  if (domain.includes("@")) {
    throw new Error(
      `The stack verifies the address ${domain}, which has no DNS records to publish. ` +
        "Deploy with -c senderIdentity=<your domain> to verify a domain.",
    );
  }
  const hasMailFrom = Object.keys(outputs).some((key) => key === "MailFromDomain" || key.endsWith(".MailFromDomain"));
  const records = dnsRecords({
    domain,
    dkim: [1, 2, 3].map((n) => ({
      name: requireOutput(outputs, `DkimName${n}`),
      value: requireOutput(outputs, `DkimValue${n}`),
    })),
    region: target.region,
    mailFromDomain: hasMailFrom ? requireOutput(outputs, "MailFromDomain") : undefined,
    dmarcReportAddress: values.report,
  });
  for (const record of records) {
    console.log(`${record.type.padEnd(5)} ${record.name}\n      ${record.value}\n      # ${record.purpose}\n`);
  }
} catch (error) {
  console.error("FAIL", error instanceof Error ? error.message : error);
  process.exit(1);
}
