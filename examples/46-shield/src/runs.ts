import { type Count, type Defences, DEPLOYED, flood, type Outcome, simulate } from "./flood.ts";

// #region runs
export type Run = {
  /** Also the ID of the scenario in data/pricing/scenarios.json. */
  id: string;
  attack: string;
  defences: string;
  webAcl: boolean;
  outcome: () => Outcome;
};

const run = (
  id: string,
  attack: Parameters<typeof flood>[0],
  label: string,
  defences: Defences,
): Run => ({
  id,
  attack: {
    fewSources: "20 addresses",
    manySources: "20,000 addresses",
    cachedRoute: "20,000 addresses, cached route",
  }[attack],
  defences: label,
  webAcl: defences.rateRule !== undefined,
  outcome: () => simulate(flood(attack, defences)),
});

const { rateRule, cacheSeconds, brake } = DEPLOYED;

/** The rows of `vp run shield:flood`, and of the table in the chapter. */
export const RUNS: Run[] = [
  run("shield-flood-few-open", "fewSources", "none", {}),
  run("shield-flood-few-rule", "fewSources", "rate rule", { rateRule }),
  run("shield-flood-many-rule", "manySources", "rate rule", { rateRule }),
  run("shield-flood-many-brake", "manySources", "rate rule, brake", { rateRule, brake }),
  run("shield-flood-cached-cache", "cachedRoute", "cache", { cacheSeconds }),
];
// #endregion runs

// #region month
const MONTH_SENT = 5000 * 86_400 * 30;

/** The attack's 5,000 requests a second kept up for thirty days, with nothing in front. No model needed. */
export const MONTH_OPEN: Count = {
  sent: MONTH_SENT,
  blocked: 0,
  cached: 0,
  throttled: 0,
  origin: MONTH_SENT,
};
// #endregion month
