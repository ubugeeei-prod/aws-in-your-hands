// #region watch
/** One Region whose default event bus gets a rule, and the stack that puts it there. */
export type Delivery = {
  stack: string;
  region: string;
  /** What arrives on this Region's bus, as the AWS Health user guide describes it. */
  receives: string;
  /** us-east-1 and us-west-2 also receive copies of another Region's events. */
  dropBackupCopies: boolean;
};

export const DELIVERIES = [
  {
    stack: "AihHealth",
    region: "ap-northeast-1",
    receives: "account-specific and public events of ap-northeast-1, where the book's stacks run",
    dropBackupCopies: false,
  },
  {
    stack: "AihHealthGlobal",
    region: "us-east-1",
    receives:
      "global events (IAM and other services without a Region) and events of us-east-1, where chapters 10 and 21 keep what CloudFront needs",
    // us-east-1 is the backup Region of us-west-2, which this book does not use.
    dropBackupCopies: true,
  },
] as const satisfies readonly Delivery[];

/**
 * Service codes, as they appear in detail.service, whose public issues count as an incident.
 * Only codes that could be confirmed are listed. A public issue of any other service is still
 * reported, as "inform", with its code in the message.
 */
export const SERVICES = [
  // In the user guide's samples and example patterns.
  "EC2",
  "LAMBDA",
  "ELASTICLOADBALANCING",
  "VPC",
  // In the API reference ("For example, EC2, RDS").
  "RDS",
  // The middle of documented event type codes: AWS_EBS_VOLUME_ATTACHMENT_ISSUE, AWS_S3_OPEN_ACCESS_BUCKET_NOTIFICATION.
  "EBS",
  "S3",
  // Seen on 2026-10-13 in the ARN of a public event on the Service health page. Large incidents are posted under it.
  "MULTIPLE_SERVICES",
] as const;
// #endregion watch

// #region patterns
export type Pattern = { readonly [field: string]: readonly string[] | Pattern };

export type NamedPattern = { name: "Events" | "Abuse"; description: string; pattern: Pattern };

export function patternsFor(delivery: Delivery): NamedPattern[] {
  return [
    {
      name: "Events",
      description: "AWS Health events of this account and public events, first page only",
      pattern: {
        // An exact value. "aws.health*" would match nothing.
        source: ["aws.health"],
        "detail-type": ["AWS Health Event"],
        detail: {
          // Later pages repeat the event with more affected resources.
          page: ["1"],
          ...(delivery.dropBackupCopies ? { backupEvent: ["false"] } : {}),
        },
      },
    },
    {
      name: "Abuse",
      description:
        "AWS Health abuse events; their detail is not documented, so none of it is matched",
      pattern: { source: ["aws.health"], "detail-type": ["AWS Health Abuse Event"] },
    },
  ];
}
// #endregion patterns
