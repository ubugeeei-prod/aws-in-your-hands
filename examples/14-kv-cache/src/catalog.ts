import type { Item } from "./contract.ts";

// #region source
/** The source of truth for the list. The cache holds copies of what this returns, and nothing else. */
export interface ItemSource {
  list(): Promise<Item[]>;
}

const ITEMS: Item[] = [
  { id: "notebook", name: "Notebook", priceYen: 480 },
  { id: "pencil", name: "Pencil", priceYen: 120 },
  { id: "eraser", name: "Eraser", priceYen: 90 },
];

/**
 * A fixed list behind an artificial delay. It stands in for whatever is slow or
 * billed per call in a real system: an aggregate query, another team's API.
 */
export function createSlowCatalog(delayMs: number, sleep: (ms: number) => Promise<void>): ItemSource {
  return {
    async list() {
      await sleep(delayMs);
      return ITEMS;
    },
  };
}
// #endregion source
