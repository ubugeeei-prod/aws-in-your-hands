import * as v from "valibot";

// The events Elastic Disaster Recovery puts on the default bus, as the user guide's
// "Alarm events and EventBridge" page shows them (read 2026-10-13). The samples there are the
// only description of `detail`: no schema is published, so unknown states are refused loudly.

// #region schemas
export const DETAIL_TYPES = {
  launch: "DRS Source Server Launch Result",
  stalled: "DRS Source Server Data Replication Stalled Change",
  failback: "DRS Recovery Instance Failback State Change",
} as const;

const envelope = {
  source: v.literal("aws.drs"),
  id: v.string(),
  time: v.string(),
  region: v.string(),
  account: v.string(),
};
const sourceServerArn = v.pipe(
  v.string(),
  v.regex(/^arn:[a-z0-9-]+:drs:[a-z0-9-]+:\d{12}:source-server\/s-[0-9a-zA-Z]{17}$/),
);
const recoveryInstanceArn = v.pipe(
  v.string(),
  v.regex(/^arn:[a-z0-9-]+:drs:[a-z0-9-]+:\d{12}:recovery-instance\/[0-9a-zA-Z-]+$/),
);

export const drsEventSchema = v.variant("detail-type", [
  v.object({
    ...envelope,
    "detail-type": v.literal(DETAIL_TYPES.launch),
    resources: v.tuple([sourceServerArn]),
    detail: v.object({
      state: v.picklist(["RECOVERY_LAUNCH_SUCCEEDED", "RECOVERY_LAUNCH_FAILED"]),
      "job-id": v.string(),
      // A string in the documented samples, not a boolean.
      "is-drill": v.picklist(["TRUE", "FALSE"]),
    }),
  }),
  v.object({
    ...envelope,
    "detail-type": v.literal(DETAIL_TYPES.stalled),
    resources: v.tuple([sourceServerArn]),
    detail: v.object({ state: v.picklist(["STALLED", "NOT_STALLED"]) }),
  }),
  v.object({
    ...envelope,
    "detail-type": v.literal(DETAIL_TYPES.failback),
    resources: v.tuple([recoveryInstanceArn]),
    detail: v.object({
      state: v.picklist(["FAILBACK_IN_PROGRESS", "FAILBACK_COMPLETED", "FAILBACK_ERROR"]),
    }),
  }),
]);
export type DrsEvent = v.InferOutput<typeof drsEventSchema>;
// #endregion schemas

// #region classify
export type LogLine = {
  level: "info" | "warn" | "error";
  message: string;
  eventId: string;
  resource: string;
  state: string;
  jobId?: string;
  drill?: boolean;
};

/** One line per event, at a level an alarm can count. Decides nothing else. */
export function classify(event: DrsEvent): LogLine {
  const base = { eventId: event.id, resource: event.resources[0], state: event.detail.state };
  switch (event["detail-type"]) {
    case DETAIL_TYPES.launch: {
      const drill = event.detail["is-drill"] === "TRUE";
      const failed = event.detail.state === "RECOVERY_LAUNCH_FAILED";
      return {
        ...base,
        // A failed drill is the drill doing its job. A failed recovery is the bad day getting worse.
        level: failed ? (drill ? "warn" : "error") : "info",
        message: `${drill ? "drill" : "recovery"} launch ${failed ? "failed" : "succeeded"}`,
        jobId: event.detail["job-id"],
        drill,
      };
    }
    case DETAIL_TYPES.stalled: {
      const stalled = event.detail.state === "STALLED";
      return {
        ...base,
        // While replication is stalled, the recovery point gets older every second.
        level: stalled ? "error" : "info",
        message: stalled ? "replication stalled" : "replication resumed",
      };
    }
    case DETAIL_TYPES.failback:
      return {
        ...base,
        level: event.detail.state === "FAILBACK_ERROR" ? "error" : "info",
        message: `failback: ${event.detail.state}`,
      };
  }
}

export type Handled = { ok: true; line: LogLine } | { ok: false; line: LogLine };

/** An event that does not match is logged as an error and kept whole: the shape has changed. */
export function handle(input: unknown): Handled {
  const parsed = v.safeParse(drsEventSchema, input);
  if (parsed.success) {
    return { ok: true, line: classify(parsed.output) };
  }
  const first = parsed.issues[0];
  return {
    ok: false,
    line: {
      level: "error",
      message: `unrecognized DRS event at ${v.getDotPath(first) ?? "(root)"}: ${first.message}`,
      eventId: typeof input === "object" && input !== null && "id" in input ? String(input.id) : "",
      resource: "",
      state: "",
    },
  };
}
// #endregion classify
