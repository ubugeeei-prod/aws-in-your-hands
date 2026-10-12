// The arithmetic the pricing pages state in words. No prices here: those are in data/pricing.

const MONTH_SECONDS = 730 * 60 * 60;

// #region cost
/** Each 64 KB chunk of a payload is billed as one request. */
export const billedRequests = (payloadBytes: number): number =>
  Math.max(1, Math.ceil(payloadBytes / (64 * 1024)));

/** A consumer that long-polls an empty queue all month, one receive after another. */
export const emptyReceivesPerMonth = (pollers: number, waitSeconds: number): number =>
  Math.ceil((pollers * MONTH_SECONDS) / waitSeconds);

/** The SQS guide's estimate of calls to KMS for a queue encrypted with a KMS key: (B / D) * (2P + C). */
export const kmsRequestsPerMonth = (settings: {
  dataKeyReuseSeconds: number;
  producers: number;
  consumers: number;
}): number =>
  Math.ceil(
    (MONTH_SECONDS / settings.dataKeyReuseSeconds) * (2 * settings.producers + settings.consumers),
  );
// #endregion cost
