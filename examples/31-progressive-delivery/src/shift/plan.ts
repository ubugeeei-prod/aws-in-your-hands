// #region plan
/** Give the new version this share of requests, then watch for this long before the next step. */
export type ShiftStep = { percent: number; holdSeconds: number };

export type ShiftPlan = { name: string; steps: ShiftStep[] };

const CANARY = /^Canary(\d+)Percent(\d+)Minutes$/;
const LINEAR = /^Linear(\d+)PercentEvery(\d+)Minutes?$/;

function share(text: string, name: string): number {
  const percent = Number(text);
  if (!Number.isInteger(percent) || percent < 1 || percent > 99) {
    throw new Error(`${name}: the share must be a whole number from 1 to 99, got ${text}.`);
  }
  return percent;
}

function minutes(text: string, name: string): number {
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name}: the wait must be at least one whole minute, got ${text}.`);
  }
  return value * 60;
}

/**
 * The steps for a name written the way CodeDeploy writes its Lambda configurations:
 * `Canary10Percent5Minutes`, `Linear10PercentEvery1Minute`, `AllAtOnce`.
 * The last step is always 100%, and `bakeSeconds` is how long that one is watched.
 */
export function planFor(name: string, bakeSeconds: number): ShiftPlan {
  if (!Number.isInteger(bakeSeconds) || bakeSeconds < 0) {
    throw new Error(`The bake time must be a whole number of seconds, got ${bakeSeconds}.`);
  }
  const last: ShiftStep = { percent: 100, holdSeconds: bakeSeconds };
  if (name === "AllAtOnce") {
    return { name, steps: [last] };
  }
  const canary = CANARY.exec(name);
  if (canary !== null) {
    const [, percent = "", wait = ""] = canary;
    return {
      name,
      steps: [{ percent: share(percent, name), holdSeconds: minutes(wait, name) }, last],
    };
  }
  const linear = LINEAR.exec(name);
  if (linear !== null) {
    const [, percent = "", wait = ""] = linear;
    const increment = share(percent, name);
    const holdSeconds = minutes(wait, name);
    const steps: ShiftStep[] = [];
    for (let at = increment; at < 100; at += increment) {
      steps.push({ percent: at, holdSeconds });
    }
    return { name, steps: [...steps, last] };
  }
  throw new Error(
    `Unknown plan "${name}". Use AllAtOnce, Canary<N>Percent<M>Minutes, or Linear<N>PercentEvery<M>Minutes.`,
  );
}
// #endregion plan

// #region weights
export type AliasTarget = { version: string; weights: Record<string, number> };

/**
 * What the alias must say for the new version to receive `percent` of requests.
 * Below 100 the alias still names the old version and the new one rides along as a weight,
 * so going back is one write that removes the weight.
 */
export function aliasAt(percent: number, from: string, to: string): AliasTarget {
  if (percent === 0) {
    return { version: from, weights: {} };
  }
  if (percent === 100) {
    return { version: to, weights: {} };
  }
  return { version: from, weights: { [to]: percent / 100 } };
}

/** The share the alias gives `to` right now, or undefined when it describes some other shift. */
export function percentOf(alias: AliasTarget, from: string, to: string): number | undefined {
  const others = Object.keys(alias.weights).filter((version) => version !== to);
  if (others.length > 0) {
    return undefined;
  }
  if (alias.version === to) {
    return 100;
  }
  if (alias.version !== from) {
    return undefined;
  }
  return Math.round((alias.weights[to] ?? 0) * 100);
}
// #endregion weights

// #region sample
/**
 * Lambda picks a version per request, independently. This is the chance that `requests`
 * requests in a row all miss a version that holds `percent` of the weight.
 */
export function chanceOfNoSample(percent: number, requests: number): number {
  return (1 - percent / 100) ** requests;
}

/** How many requests it takes before the chance of having missed the new version is below `risk`. */
export function requestsForSample(percent: number, risk: number): number {
  return Math.ceil(Math.log(risk) / Math.log(1 - percent / 100));
}
// #endregion sample
