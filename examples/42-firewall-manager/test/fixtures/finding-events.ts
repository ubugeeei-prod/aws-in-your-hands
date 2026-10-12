// Written for these tests, not captured from an account. The envelope follows the
// "Security Hub Findings - Imported" format in the Security Hub CSPM user guide, and the
// finding carries the attributes the AWS Security Finding Format requires plus the ones the
// handler reads. The titles are the finding names in the Firewall Manager guide. What a real
// Firewall Manager finding puts in the other fields was not observed.

const envelope = (finding: Record<string, unknown>) => ({
  version: "0",
  id: "00000000-0000-4000-8000-000000000042",
  "detail-type": "Security Hub Findings - Imported",
  source: "aws.securityhub",
  account: "222222222222",
  time: "2026-10-13T03:04:05Z",
  region: "ap-northeast-1",
  resources: ["arn:aws:securityhub:ap-northeast-1::product/aws/firewall-manager/example-finding"],
  detail: { findings: [finding] },
});

const finding = (overrides: Record<string, unknown> = {}) => ({
  SchemaVersion: "2018-10-08",
  Id: "example-finding-id",
  ProductArn: "arn:aws:securityhub:ap-northeast-1::product/aws/firewall-manager",
  ProductName: "Firewall Manager",
  GeneratorId: "example-generator",
  AwsAccountId: "444444444444",
  Types: ["Software and Configuration Checks"],
  CreatedAt: "2026-10-13T03:00:00Z",
  UpdatedAt: "2026-10-13T03:04:00Z",
  Severity: { Label: "HIGH", Normalized: 70 },
  Title: "Security group is not in compliance with content audit security group.",
  Description: "An example description, written for this fixture.",
  Resources: [
    {
      Type: "AwsEc2SecurityGroup",
      Id: "arn:aws:ec2:ap-northeast-1:444444444444:security-group/sg-0123456789abcdef0",
      Region: "ap-northeast-1",
    },
  ],
  Compliance: { Status: "FAILED" },
  RecordState: "ACTIVE",
  ...overrides,
});

export const failedEvent = envelope(finding());
export const passedEvent = envelope(
  finding({ Compliance: { Status: "PASSED" }, Severity: { Label: "INFORMATIONAL" } }),
);
export const archivedEvent = envelope(finding({ RecordState: "ARCHIVED" }));
/** Optional attributes left out: still a finding, with nothing to say about its status. */
export const bareEvent = envelope(
  finding({ ProductName: undefined, Compliance: undefined, RecordState: undefined }),
);
export const longTitleEvent = envelope(finding({ Title: `line one\nline two ${"x".repeat(200)}` }));
/** A custom action carries findings too, under another detail-type. The rule does not send it. */
export const customActionEvent = {
  ...failedEvent,
  "detail-type": "Security Hub Findings - Custom Action",
};
export const noResourceEvent = envelope(finding({ Resources: [] }));
