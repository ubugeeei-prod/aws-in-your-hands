import { composeEventsHandler } from "./compose.ts";

// Invoked by the SNS topic that SES publishes bounces, complaints and deliveries to.
export const handler = composeEventsHandler(process.env);
