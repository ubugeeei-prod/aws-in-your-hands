import { LIMITS } from "./config.ts";

// #region plan
/** Keys this example owns. Anything else in the store belongs to someone else and is left alone. */
export const MANAGED_PREFIXES = ["flag:", "redirect:"] as const;

export type Pair = { key: string; value: string };

export type Plan = {
  puts: Pair[];
  deletes: string[];
  unchanged: number;
  /** Present in the store, outside the managed prefixes. Reported, never touched. */
  foreign: string[];
};

const isManaged = (key: string): boolean =>
  MANAGED_PREFIXES.some((prefix) => key.startsWith(prefix));

export function planSync(
  desired: ReadonlyMap<string, string>,
  current: ReadonlyMap<string, string>,
): Plan {
  const unmanaged = [...desired.keys()].filter((key) => !isManaged(key));
  if (unmanaged.length > 0) {
    throw new Error(`desired keys outside ${MANAGED_PREFIXES.join(", ")}: ${unmanaged.join(", ")}`);
  }
  const puts = [...desired]
    .filter(([key, value]) => current.get(key) !== value)
    .map(([key, value]) => ({ key, value }))
    .toSorted((a, b) => a.key.localeCompare(b.key));
  const deletes = [...current.keys()]
    .filter((key) => isManaged(key) && !desired.has(key))
    .toSorted();
  return {
    puts,
    deletes,
    unchanged: desired.size - puts.length,
    foreign: [...current.keys()].filter((key) => !isManaged(key)).toSorted(),
  };
}

export const isInSync = (plan: Plan): boolean =>
  plan.puts.length === 0 && plan.deletes.length === 0;
// #endregion plan

// #region batches
export type Batch = { puts: Pair[]; deletes: string[] };

/** One UpdateKeys request each. A request is all-or-nothing; a run of several requests is not. */
export function toBatches(plan: Plan, size: number = LIMITS.keysPerUpdate): Batch[] {
  // Puts go first: a new rule exists before the old one it replaces is removed.
  const changes = [
    ...plan.puts.map((pair) => ({ put: pair }) as const),
    ...plan.deletes.map((key) => ({ delete: key }) as const),
  ];
  const batches: Batch[] = [];
  for (let start = 0; start < changes.length; start += size) {
    const slice = changes.slice(start, start + size);
    batches.push({
      puts: slice.flatMap((change) => ("put" in change ? [change.put] : [])),
      deletes: slice.flatMap((change) => ("delete" in change ? [change.delete] : [])),
    });
  }
  return batches;
}
// #endregion batches

export function describePlan(plan: Plan): string {
  const lines = [
    ...plan.puts.map((pair) => `  put    ${pair.key} = ${pair.value}`),
    ...plan.deletes.map((key) => `  delete ${key}`),
    ...plan.foreign.map((key) => `  keep   ${key} (not managed here)`),
  ];
  return [
    `${plan.puts.length} to put, ${plan.deletes.length} to delete, ${plan.unchanged} unchanged`,
    ...lines,
  ].join("\n");
}
