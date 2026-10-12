import type { HealthDetail } from "./event.ts";

// #region kinds
export type Classification =
  /** Nothing is sent. The reason is logged. */
  | { kind: "ignore"; reason: string }
  /** Worth knowing, nothing to do. */
  | { kind: "inform"; reason: string }
  /** Someone has to do something. `by` is the date the change happens, when the event gives one. */
  | { kind: "act-by-date"; reason: string; by: number | undefined }
  /** Something is broken on AWS's side now, in a place this app depends on. */
  | { kind: "incident"; reason: string };
// #endregion kinds

// #region classify
export function classify(detail: HealthDetail, services: readonly string[]): Classification {
  if (detail.backupEvent === "true") {
    return { kind: "ignore", reason: "a copy sent to the backup Region" };
  }
  if (detail.page !== "1") {
    return { kind: "ignore", reason: `page ${detail.page} of ${detail.totalPages}` };
  }

  // Before the category: the documented abuse report is filed under "issue".
  if (detail.eventTypeCode.startsWith("AWS_ABUSE_")) {
    return { kind: "act-by-date", reason: "an abuse report", by: undefined };
  }

  switch (detail.eventTypeCategory) {
    case "issue":
      if (detail.eventScopeCode === "ACCOUNT_SPECIFIC") {
        return { kind: "incident", reason: "an issue that affects this account's resources" };
      }
      return services.includes(detail.service)
        ? { kind: "incident", reason: `a public issue of ${detail.service}, which this app uses` }
        : {
            kind: "inform",
            reason: `a public issue of ${detail.service}, which is not on the list`,
          };

    case "scheduledChange":
      if (detail.actionability === "INFORMATIONAL") {
        return { kind: "inform", reason: "a scheduled change marked informational" };
      }
      if (detail.statusCode === "closed") {
        return { kind: "inform", reason: "a scheduled change that is over" };
      }
      // The user guide: treat the start time as the date of the change.
      return { kind: "act-by-date", reason: "a scheduled change", by: detail.startTime };

    case "accountNotification":
      // Some of these are urgent and carry no actionability. Only an explicit label demotes one.
      return detail.actionability === "INFORMATIONAL"
        ? { kind: "inform", reason: "an account notification marked informational" }
        : { kind: "act-by-date", reason: "an account notification", by: undefined };

    case "investigation":
      // Listed as a category value; the guide does not say what it carries.
      return { kind: "inform", reason: "an investigation" };
  }
}
// #endregion classify
