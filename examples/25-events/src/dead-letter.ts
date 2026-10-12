import * as v from "valibot";

// #region dead-letter
// Four senders share the dead-letter queue, and each leaves a different mark.
// The shapes are the ones the documentation shows; none was received from AWS.
const lambdaRecordSchema = v.object({
  requestContext: v.object({ condition: v.string(), approximateInvokeCount: v.number() }),
  requestPayload: v.unknown(),
});
const busEventSchema = v.object({ "detail-type": v.string(), detail: v.unknown() });

function json(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/** Who gave up on a message, and why, as far as the message says. */
export function describeDeadLetter(
  attributes: Record<string, string | undefined>,
  body: string,
): string {
  // A rule's target: EventBridge adds the rule and the reason as message attributes.
  const rule = attributes["RULE_ARN"];
  if (rule !== undefined) {
    return `rule ${rule.split("/").at(-1)} could not deliver: ${attributes["ERROR_CODE"] ?? "no error code"}`;
  }
  const parsed = json(body);
  // Lambda's on-failure destination: the event wrapped in a record of the attempts.
  const record = v.safeParse(lambdaRecordSchema, parsed);
  if (record.success) {
    const { condition, approximateInvokeCount } = record.output.requestContext;
    return `the timeline function failed ${approximateInvokeCount} times (${condition})`;
  }
  // The counter's queue: the message as it was, moved after five receives.
  const event = v.safeParse(busEventSchema, parsed);
  if (event.success) {
    return `the counter did not accept a ${event.output["detail-type"]} event in five receives`;
  }
  return "from the pipe: a stream record that could not be shaped or published";
}
// #endregion dead-letter
