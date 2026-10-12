import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { PGlite } from "@electric-sql/pglite";

import type { Db } from "./db.ts";

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// PGlite does not stop a second process from opening the same directory, and
// two writers would corrupt it. This lock file does the refusing.
function lock(dataDir: string): () => void {
  const lockFile = `${dataDir}.lock`;
  mkdirSync(dirname(lockFile), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(lockFile, String(process.pid), { flag: "wx" });
      return () => rmSync(lockFile, { force: true });
    } catch {
      const holder = Number(readFileSync(lockFile, "utf8"));
      if (Number.isInteger(holder) && processIsAlive(holder)) {
        throw new Error(
          `The local database at ${dataDir} is open in process ${holder}. Stop that process (\`vp run dev:sql\`?) and retry.`,
        );
      }
      // The holder died without cleaning up.
      rmSync(lockFile, { force: true });
    }
  }
  throw new Error(`Could not lock ${dataDir}`);
}

// #region pglite
/**
 * PostgreSQL compiled to WebAssembly, running inside this process. A stand-in
 * for local work: one session, no IAM, no network, and never a conflict.
 * Without `dataDir` the database lives in memory and ends with the process.
 */
export async function openPglite(dataDir?: string): Promise<Db> {
  const unlock = dataDir === undefined ? () => undefined : lock(dataDir);
  let pglite: PGlite;
  try {
    pglite = await PGlite.create(dataDir);
  } catch (error) {
    unlock();
    throw error;
  }
  process.once("exit", unlock);

  // There is a single session. Callers take turns, or one caller's COMMIT
  // would end another caller's transaction.
  let turn: Promise<unknown> = Promise.resolve();
  return {
    withConnection(use) {
      const result = turn.then(() =>
        use({
          query: async (text, params) => ({
            rows: (await pglite.query(text, [...(params ?? [])])).rows,
          }),
        }),
      );
      turn = result.catch(() => undefined);
      return result;
    },
    async close() {
      await turn;
      await pglite.close();
      unlock();
    },
  };
}
// #endregion pglite
