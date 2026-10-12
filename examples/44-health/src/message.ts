import type { Classification } from "./classify.ts";
import type { Envelope, HealthEvent } from "./event.ts";
import type { Decision } from "./ledger.ts";

export type Message = { subject: string; body: string };

export const DASHBOARD = "https://health.aws.amazon.com/health/home";
const DESCRIPTION_LIMIT = 1500;
const ENTITY_LIMIT = 5;

const iso = (time: number) => new Date(time).toISOString().replace(".000Z", "Z");

/** SNS: UTF-8 text with no line breaks or control characters, and less than 100 characters. */
export const subjectLine = (text: string): string => {
  const flat = text.replaceAll(/\p{Cc}+/gu, " ").trim();
  return flat.length < 100 ? flat : `${flat.slice(0, 96)}...`;
};

// #region next-step
const NEXT_STEP = {
  incident: "Note it in the incident. Start no new deploy. Fail over only by your own criteria.",
  "act-by-date": "Open a ticket with an owner and the date. Read the full text in the dashboard.",
  inform: "Nothing to do. If this service matters to the app, add its code to SERVICES.",
  closed: "Closed on AWS's side. Look at your own alarms before you call it over.",
} as const;
// #endregion next-step

// #region render
type Announce = Extract<Decision, { do: "announce" }>;
type Sent = Exclude<Classification, { kind: "ignore" }>;

export function render(
  event: HealthEvent,
  classification: Sent,
  change: Announce["change"],
): Message {
  const { detail } = event;
  const closedIncident = classification.kind === "incident" && detail.statusCode === "closed";
  const label =
    classification.kind === "incident"
      ? "INCIDENT"
      : classification.kind === "inform"
        ? "INFO"
        : classification.by === undefined
          ? "ACT"
          : `ACT BY ${iso(classification.by).slice(0, 10)}`;
  const state = change === "update" ? "update" : detail.statusCode;
  const entities = detail.affectedEntities.map((entity) =>
    entity.status === undefined ? entity.entityValue : `${entity.entityValue} (${entity.status})`,
  );
  const pages =
    detail.totalPages === "1"
      ? []
      : [`(page 1 of ${detail.totalPages}; the dashboard has the rest)`];
  const description = detail.eventDescription[0]?.latestDescription ?? "";

  const lines = [
    `${classification.kind}: ${classification.reason}`,
    `What to do: ${NEXT_STEP[closedIncident ? "closed" : classification.kind]}`,
    "",
    `Event: ${detail.eventTypeCode} (${detail.eventTypeCategory}, ${detail.eventScopeCode})`,
    `Status: ${detail.statusCode}`,
    `Region: ${detail.eventRegion}, delivered to ${event.region}`,
    `Account: ${detail.affectedAccount}`,
    `Started: ${iso(detail.startTime)}`,
    ...(detail.endTime === undefined ? [] : [`Ended: ${iso(detail.endTime)}`]),
    ...(detail.lastUpdatedTime === undefined ? [] : [`Updated: ${iso(detail.lastUpdatedTime)}`]),
    ...(classification.kind === "act-by-date" && classification.by !== undefined
      ? [`Act by: ${iso(classification.by)}`]
      : []),
    ...(entities.length === 0
      ? []
      : [
          `Affected: ${entities.slice(0, ENTITY_LIMIT).join(", ")}${
            entities.length > ENTITY_LIMIT ? ` and ${entities.length - ENTITY_LIMIT} more` : ""
          }`,
          ...pages,
        ]),
    "",
    description.length > DESCRIPTION_LIMIT
      ? `${description.slice(0, DESCRIPTION_LIMIT)} [cut]`
      : description,
    "",
    `Dashboard: ${DASHBOARD}`,
    `Event ARN: ${detail.eventArn}`,
  ];
  return {
    subject: subjectLine(
      `[AWS Health] ${label} ${detail.service} ${detail.eventRegion} ${state}: ${detail.eventTypeCode}`,
    ),
    body: lines.join("\n"),
  };
}
// #endregion render

// #region unreadable
/** For an event this code could not parse. Saying so beats saying nothing. */
export function renderUnreadable(envelope: Envelope | undefined, issues: string[]): Message {
  return {
    subject: subjectLine(
      `[AWS Health] UNREADABLE ${envelope?.["detail-type"] ?? "event"}: open the dashboard`,
    ),
    body: [
      "An event arrived from AWS Health that this function could not read.",
      "What to do: open the dashboard and read it there. Then fix the schema in src/event.ts.",
      "",
      `Type: ${envelope?.["detail-type"] ?? "unknown"}`,
      `Delivered to: ${envelope?.region ?? "unknown"}`,
      `EventBridge id: ${envelope?.id ?? "unknown"}`,
      "",
      "What did not fit:",
      ...issues.slice(0, 10).map((issue) => `- ${issue}`),
      "",
      `Dashboard: ${DASHBOARD}`,
    ].join("\n"),
  };
}
// #endregion unreadable
