import * as v from "valibot";

// #region event-schema
// Firewall Manager sends its findings to Security Hub CSPM, and Security Hub sends every
// new or updated finding to EventBridge as "Security Hub Findings - Imported", one finding
// per event. The fields below are the ones this handler reads, named as the AWS Security
// Finding Format names them. A finding has many more.
const findingSchema = v.object({
  // Required in every finding.
  Id: v.pipe(v.string(), v.minLength(1)),
  AwsAccountId: v.pipe(v.string(), v.regex(/^\d{12}$/)),
  Title: v.string(),
  Description: v.string(),
  UpdatedAt: v.string(),
  Severity: v.object({ Label: v.optional(v.string()) }),
  Resources: v.pipe(
    v.array(v.object({ Id: v.string(), Type: v.string(), Region: v.optional(v.string()) })),
    v.minLength(1),
  ),
  // Optional in the format. A finding without them is reported as "status not stated".
  ProductName: v.optional(v.string()),
  Compliance: v.optional(v.object({ Status: v.optional(v.string()) })),
  RecordState: v.optional(v.picklist(["ACTIVE", "ARCHIVED"])),
});

export const findingEventSchema = v.object({
  source: v.literal("aws.securityhub"),
  "detail-type": v.literal("Security Hub Findings - Imported"),
  account: v.pipe(v.string(), v.regex(/^\d{12}$/)),
  region: v.string(),
  time: v.string(),
  detail: v.object({ findings: v.pipe(v.array(findingSchema), v.minLength(1)) }),
});
export type FindingEvent = v.InferOutput<typeof findingEventSchema>;
// #endregion event-schema

// #region event-pattern
/** The rule's pattern. "Firewall Manager" is the product name its documentation gives, case and all. */
export const FINDING_EVENT_PATTERN = {
  source: ["aws.securityhub"],
  detailType: ["Security Hub Findings - Imported"],
  detail: { findings: { ProductName: ["Firewall Manager"] } },
} as const;
// #endregion event-pattern

// #region summarize
export type Notice = {
  /** `failed`: a resource is out of compliance. `passed`: it came back. `unstated`: read the finding. */
  status: "failed" | "passed" | "unstated";
  subject: string;
  body: string;
};

export type Summary = { ok: true; notices: Notice[] } | { ok: false; problems: string[] };

const STATUS = { FAILED: "failed", PASSED: "passed" } as const;

/** An SNS subject has no line breaks or control characters and is under 100 characters. */
export const subjectLine = (text: string): string =>
  // oxlint-disable-next-line no-control-regex
  text.replaceAll(/[\u0000-\u001f\u007f]+/g, " ").slice(0, 99);

export function summarize(event: unknown): Summary {
  const parsed = v.safeParse(findingEventSchema, event);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.issues.map((issue) => `${v.getDotPath(issue) ?? ""}: ${issue.message}`),
    };
  }
  const notices = parsed.output.detail.findings
    // An archived finding is history: Firewall Manager stops updating findings for deleted or out-of-scope resources.
    .filter((finding) => finding.RecordState !== "ARCHIVED")
    .map((finding): Notice => {
      const stated = finding.Compliance?.Status;
      const status =
        stated === "FAILED" || stated === "PASSED" ? STATUS[stated] : ("unstated" as const);
      const resources = finding.Resources.map((resource) => `${resource.Type} ${resource.Id}`);
      return {
        status,
        subject: subjectLine(`[${status}] ${finding.AwsAccountId}: ${finding.Title}`),
        body: [
          `Account: ${finding.AwsAccountId}`,
          `Region: ${parsed.output.region}`,
          `Status: ${stated ?? "not stated"} (severity ${finding.Severity.Label ?? "not stated"})`,
          `Updated: ${finding.UpdatedAt}`,
          ...resources.map((resource) => `Resource: ${resource}`),
          "",
          finding.Description,
          "",
          `Finding: ${finding.Id}`,
        ].join("\n"),
      };
    });
  return { ok: true, notices };
}
// #endregion summarize
