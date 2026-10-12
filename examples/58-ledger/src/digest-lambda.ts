import { createDigests, createJournal } from "./compose.ts";
import { type DigestResult, type DigestStore, takeDigest } from "./digest.ts";
import { parseEnv } from "./env.ts";
import type { Journal } from "./journal.ts";

export class LedgerDamagedError extends Error {
  constructor(ledger: string) {
    super(`Ledger ${ledger} failed verification. No digest was written.`);
    this.name = "LedgerDamagedError";
  }
}

// #region handler
export function createHandler(deps: {
  journal: Journal;
  digests: DigestStore;
  ledger: string;
  now: () => Date;
  log: (entry: Record<string, unknown>) => void;
}) {
  // The schedule's event says nothing this function needs, so it is not read.
  return async (): Promise<DigestResult> => {
    const result = await takeDigest(deps.journal, deps.digests, {
      ledger: deps.ledger,
      now: deps.now(),
    });
    deps.log({ message: "digest", ledger: deps.ledger, ...result });
    if (result.kind === "refused") {
      // A failed invocation is what an alarm on the function's Errors metric sees.
      throw new LedgerDamagedError(deps.ledger);
    }
    return result;
  };
}
// #endregion handler

let cached: ReturnType<typeof createHandler> | undefined;

export const handler = (): Promise<DigestResult> => {
  if (cached === undefined) {
    const env = parseEnv(process.env);
    cached = createHandler({
      journal: createJournal(env),
      digests: createDigests(env),
      ledger: env.LEDGER,
      now: () => new Date(),
      log: (entry) => console.log(JSON.stringify(entry)),
    });
  }
  return cached();
};
