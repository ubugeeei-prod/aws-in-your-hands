import type { VerifiedProfileId } from "@aih/example-17-ai/infra/lib/models.ts";

// #region profile
export type ModelProfile = {
  /**
   * How to get JSON that fits a schema. "json_schema" is `outputConfig.textFormat`.
   * "forced_tool" asks for one tool by name and reads its input.
   */
  structuredOutput: "json_schema" | "forced_tool";
  /** Explicit prompt caching, as the model card lists it. */
  cache: {
    minTokens: number;
    maxCheckpoints: number;
    fields: readonly ("system" | "messages" | "tools")[];
  };
  /** One output token takes this many tokens out of the tokens-per-minute quota. */
  outputBurndown: number;
  /** The model card's "EOL no sooner than" date. */
  eolNoSoonerThan: string;
  /** List prices for a call from ap-northeast-1, USD per million tokens. */
  usdPerMillionTokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
};
// #endregion profile

// #region profiles
/**
 * What each inference profile can do, read off its model card, the prompt caching page, the
 * token burndown page, and the AWS Price List on 2026-10-13. Every line here goes stale:
 * the model cards are the place to look again.
 */
export const modelProfiles = {
  "jp.amazon.nova-2-lite-v1:0": {
    // The model card lists structured outputs under "Not supported".
    structuredOutput: "forced_tool",
    cache: { minTokens: 1000, maxCheckpoints: 4, fields: ["system", "messages"] },
    outputBurndown: 1,
    eolNoSoonerThan: "2026-12-02",
    usdPerMillionTokens: { input: 0.396, output: 3.311, cacheRead: 0.099, cacheWrite: 0 },
  },
  "global.amazon.nova-2-lite-v1:0": {
    structuredOutput: "forced_tool",
    cache: { minTokens: 1000, maxCheckpoints: 4, fields: ["system", "messages"] },
    outputBurndown: 1,
    eolNoSoonerThan: "2026-12-02",
    usdPerMillionTokens: { input: 0.36, output: 3.01, cacheRead: 0.09, cacheWrite: 0 },
  },
  "jp.anthropic.claude-haiku-4-5-20251001-v1:0": {
    structuredOutput: "json_schema",
    cache: { minTokens: 4096, maxCheckpoints: 4, fields: ["system", "messages", "tools"] },
    outputBurndown: 5,
    eolNoSoonerThan: "2026-10-16",
    usdPerMillionTokens: { input: 1.1, output: 5.5, cacheRead: 0.11, cacheWrite: 1.375 },
  },
} as const satisfies Record<VerifiedProfileId, ModelProfile>;
// #endregion profiles

export function isKnownModel(value: string): value is VerifiedProfileId {
  return Object.hasOwn(modelProfiles, value);
}

export function profileOf(modelId: VerifiedProfileId): ModelProfile {
  return modelProfiles[modelId];
}

// #region lifecycle
/** Days until the model may reach end of life at the earliest. Negative once that date has passed. */
export function daysUntilEarliestEol(profile: ModelProfile, today: Date): number {
  const eol = Date.parse(`${profile.eolNoSoonerThan}T00:00:00Z`);
  return Math.floor((eol - today.getTime()) / 86_400_000);
}
// #endregion lifecycle
