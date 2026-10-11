import complete from "../fixtures/converse-stream/complete.json" with { type: "json" };
import maxTokens from "../fixtures/converse-stream/max-tokens.json" with { type: "json" };
import throttledMidstream from "../fixtures/converse-stream/throttled-midstream.json" with { type: "json" };
import throttledThenComplete from "../fixtures/converse-stream/throttled-then-complete.json" with { type: "json" };
import truncated from "../fixtures/converse-stream/truncated.json" with { type: "json" };
import { type Fixture, fixtureSchema } from "./fixture-gateway.ts";

export const fixtureNames = [
  "complete",
  "max-tokens",
  "truncated",
  "throttled-midstream",
  "throttled-then-complete",
] as const;
export type FixtureName = (typeof fixtureNames)[number];

export const fixtures: Record<FixtureName, Fixture> = {
  complete: fixtureSchema.parse(complete),
  "max-tokens": fixtureSchema.parse(maxTokens),
  truncated: fixtureSchema.parse(truncated),
  "throttled-midstream": fixtureSchema.parse(throttledMidstream),
  "throttled-then-complete": fixtureSchema.parse(throttledThenComplete),
};
