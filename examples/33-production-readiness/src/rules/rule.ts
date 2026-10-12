import { lintTemplate } from "@aih/example-21-security/src/iam-lint.ts";

import type { Template } from "../template.ts";
import { bucketPublic, statefulDelete, tablePitr } from "./data.ts";
import { apiThrottle, functionUrlAuth, queueDlq } from "./doors.ts";
import { alarmRecipient, functionAlarm, logRetention } from "./watching.ts";

/** What a rule found, before it is stamped with the rule's name. */
export type Problem = { resource: string; detail: string };

// #region iam
/** Chapter 21's lint, unchanged. Its exceptions arrive here as waivers. */
function iamWildcard(template: Template): Problem[] {
  return lintTemplate(template.raw).findings.map((finding) => ({
    resource: finding.resource,
    detail: `${finding.kind}: ${finding.detail}`,
  }));
}
// #endregion iam

// #region rules
export const RULE_IDS = [
  "bucket-public",
  "iam-wildcard",
  "function-url-auth",
  "api-throttle",
  "table-pitr",
  "stateful-delete",
  "log-retention",
  "function-alarm",
  "alarm-recipient",
  "queue-dlq",
] as const;
export type RuleId = (typeof RULE_IDS)[number];

export type Rule = {
  /** What goes wrong when the rule's finding is left alone. */
  breaks: string;
  /** The chapter that does the work. */
  chapter: string;
  check: (template: Template) => Problem[];
};

export const RULES: Record<RuleId, Rule> = {
  "bucket-public": {
    breaks: "Objects meant for signed-in users can be read by anyone who has the URL.",
    chapter: "07",
    check: bucketPublic,
  },
  "iam-wildcard": {
    breaks: "A hole in one function reaches every resource the wildcard covers.",
    chapter: "21",
    check: iamWildcard,
  },
  "function-url-auth": {
    breaks: "The function answers requests that never passed the CDN, the WAF or sign-in.",
    chapter: "09",
    check: functionUrlAuth,
  },
  "api-throttle": {
    breaks: "One client can spend the account's whole request quota, and the bill with it.",
    chapter: "04",
    check: apiThrottle,
  },
  "table-pitr": {
    breaks: "A bad write or delete cannot be undone: there is no earlier state to restore.",
    chapter: "22",
    check: tablePitr,
  },
  "stateful-delete": {
    breaks: "Destroying the stack, or an update that replaces the resource, deletes the data.",
    chapter: "22",
    check: statefulDelete,
  },
  "log-retention": {
    breaks: "Logs pile up for ever, or live in a log group nobody set a retention on.",
    chapter: "19",
    check: logRetention,
  },
  "function-alarm": {
    breaks: "The function fails for hours and the first report comes from a user.",
    chapter: "19",
    check: functionAlarm,
  },
  "alarm-recipient": {
    breaks: "The alarm goes to ALARM and no one is told.",
    chapter: "19",
    check: alarmRecipient,
  },
  "queue-dlq": {
    breaks: "A message that always fails is retried until it expires, then is gone.",
    chapter: "08",
    check: queueDlq,
  },
};
// #endregion rules
