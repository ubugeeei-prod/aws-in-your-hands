import { describe, expect, it } from "vite-plus/test";

import { purgePlan } from "../src/purge.ts";
import { at } from "./support.ts";

const version = (versionId: string, retainUntil?: Date, deleteMarker = false) => ({
  key: "digests/notes/000000000004.json",
  versionId,
  deleteMarker,
  ...(retainUntil === undefined ? {} : { retainUntil }),
});

describe("purgePlan", () => {
  it("leaves every version whose lock has not ended, and says when the last one ends", () => {
    const plan = purgePlan(
      [
        version("a", at(10)),
        version("b", at(50)),
        version("c", at(30)),
        version("m", undefined, true),
      ],
      at(20),
    );
    expect(plan.deletable.map((entry) => entry.versionId)).toEqual(["a", "m"]);
    expect(plan.locked.map((entry) => entry.versionId)).toEqual(["b", "c"]);
    expect(plan.emptyAfter).toEqual(at(50));
  });

  it("treats a lock that ends exactly now as ended", () => {
    const plan = purgePlan([version("a", at(20))], at(20));
    expect(plan.locked).toEqual([]);
    expect(plan.emptyAfter).toBeUndefined();
  });
});
