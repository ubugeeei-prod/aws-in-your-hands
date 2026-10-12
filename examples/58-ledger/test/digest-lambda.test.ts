import { describe, expect, it } from "vite-plus/test";

import { LedgerDamagedError, createHandler } from "../src/digest-lambda.ts";
import type { Entry } from "../src/entry.ts";
import { at, world } from "./support.ts";

describe("the scheduled digest function", () => {
  it("locks a digest and logs what it did", async () => {
    const w = await world();
    const logs: Record<string, unknown>[] = [];
    const handler = createHandler({
      journal: w.journal,
      digests: w.digests,
      ledger: w.ledger,
      now: () => at(10),
      log: (entry) => logs.push(entry),
    });

    expect(await handler()).toMatchObject({ kind: "written", digest: { seq: 6 } });
    expect(logs).toMatchObject([{ message: "digest", ledger: "notes", kind: "written" }]);
  });

  it("fails the invocation when the ledger does not verify, after logging the findings", async () => {
    const w = await world();
    await w.overwrite({ ...(w.entries[4] as Entry), event: "forged" });
    const logs: Record<string, unknown>[] = [];
    const handler = createHandler({
      journal: w.journal,
      digests: w.digests,
      ledger: w.ledger,
      now: () => at(10),
      log: (entry) => logs.push(entry),
    });

    await expect(handler()).rejects.toBeInstanceOf(LedgerDamagedError);
    expect(logs).toMatchObject([{ kind: "refused", findings: [{ kind: "content_changed" }] }]);
  });
});
