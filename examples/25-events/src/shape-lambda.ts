import { createLogger } from "@aih/example-05-dynamodb/src/log.ts";

import { parseShapeEnv } from "./env.ts";
import { enrich } from "./shape.ts";

// #region handler
const log = createLogger(parseShapeEnv(process.env).LOG_LEVEL);

// Invoked by the pipe, synchronously, with an array of stream records. What
// it returns is what the pipe publishes: an empty array publishes nothing.
// A throw makes the pipe try the same records again.
export const handler = async (records: unknown) => {
  const events = enrich(records);
  for (const event of events) {
    log({ level: "info", message: "shaped", type: event.type, eventId: event.id });
  }
  return events;
};
// #endregion handler
