import * as v from "valibot";

// #region time
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HEALTH_TIME = /^[A-Za-z]{3}, (\d{1,2}) ([A-Za-z]{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/;

/**
 * "Fri, 27 Jan 2023 06:02:51 GMT" as milliseconds since the epoch.
 * The weekday is not checked: the documented samples carry weekdays that do not fit their dates.
 */
export function parseHealthTime(text: string): number | undefined {
  const match = HEALTH_TIME.exec(text);
  if (match === null) {
    return undefined;
  }
  const [, day = "", monthName = "", year = "", hour = "", minute = "", second = ""] = match;
  const month = MONTHS.indexOf(monthName);
  if (month === -1) {
    return undefined;
  }
  const time = Date.UTC(
    Number(year),
    month,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  // Date.UTC rolls "31 Feb" over into March. A date that does not read back the same is refused.
  return new Date(time).getUTCDate() === Number(day) && Number(hour) < 24 ? time : undefined;
}

const healthTime = v.pipe(
  v.string(),
  v.transform((text) => parseHealthTime(text) ?? Number.NaN),
  // v.number() refuses NaN, which is how a string in another format is turned away.
  v.number("Not in the form 'Fri, 27 Jan 2023 06:02:51 GMT'."),
);
// #endregion time

// #region schema
export const CATEGORIES = [
  "issue",
  "accountNotification",
  "investigation",
  "scheduledChange",
] as const;
export const STATUSES = ["upcoming", "open", "closed"] as const;
export type Status = (typeof STATUSES)[number];

const text = v.pipe(v.string(), v.minLength(1));

// The fields of `detail` in the schema reference. Unknown keys are dropped, so a field AWS adds
// later does not break the parse. A field marked "Required: Yes" that a documented sample
// leaves out (lastUpdatedTime) is optional here.
export const detailSchema = v.object({
  eventArn: v.pipe(v.string(), v.startsWith("arn:")),
  service: text,
  eventTypeCode: text,
  eventTypeCategory: v.picklist(CATEGORIES),
  eventScopeCode: v.picklist(["ACCOUNT_SPECIFIC", "PUBLIC"]),
  communicationId: text,
  startTime: healthTime,
  endTime: v.optional(healthTime),
  lastUpdatedTime: v.optional(healthTime),
  statusCode: v.picklist(STATUSES),
  eventRegion: text,
  eventDescription: v.array(v.object({ language: v.string(), latestDescription: v.string() })),
  eventMetadata: v.optional(v.record(v.string(), v.string())),
  affectedEntities: v.optional(
    v.array(v.object({ entityValue: v.string(), status: v.optional(v.string()) })),
    [],
  ),
  // Numbers and booleans arrive as strings.
  page: v.pipe(v.string(), v.regex(/^[1-9]\d*$/)),
  totalPages: v.pipe(v.string(), v.regex(/^[1-9]\d*$/)),
  backupEvent: v.picklist(["true", "false"]),
  affectedAccount: v.pipe(v.string(), v.regex(/^\d{12}$/)),
  actionability: v.optional(
    v.picklist(["ACTION_REQUIRED", "ACTION_MAY_BE_REQUIRED", "INFORMATIONAL"]),
  ),
  personas: v.optional(v.array(v.string()), []),
});

export const healthEventSchema = v.object({
  id: text,
  "detail-type": v.literal("AWS Health Event"),
  source: v.literal("aws.health"),
  account: v.pipe(v.string(), v.regex(/^\d{12}$/)),
  // v.isoTimestamp() would also accept an offset and a space; EventBridge sends this one form.
  time: v.pipe(
    v.string(),
    v.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
    v.transform((value) => Date.parse(value)),
    v.number(),
  ),
  // Where the event was delivered. The Region it is about is detail.eventRegion.
  region: text,
  resources: v.optional(v.array(v.string()), []),
  detail: detailSchema,
});
export type HealthEvent = v.InferOutput<typeof healthEventSchema>;
export type HealthDetail = HealthEvent["detail"];
// #endregion schema

// #region envelope
// What is read from an event whose detail does not parse, so that it can still be reported.
export const envelopeSchema = v.object({
  id: text,
  "detail-type": text,
  source: text,
  region: text,
});
export type Envelope = v.InferOutput<typeof envelopeSchema>;

export type Parsed =
  | { ok: true; event: HealthEvent }
  | { ok: false; envelope: Envelope | undefined; issues: string[] };

export function parseHealthEvent(input: unknown): Parsed {
  const result = v.safeParse(healthEventSchema, input);
  if (result.success) {
    return { ok: true, event: result.output };
  }
  const envelope = v.safeParse(envelopeSchema, input);
  return {
    ok: false,
    envelope: envelope.success ? envelope.output : undefined,
    issues: result.issues.map((issue) => `${v.getDotPath(issue) ?? "(root)"}: ${issue.message}`),
  };
}
// #endregion envelope
