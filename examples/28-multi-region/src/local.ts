import type { Fetch } from "@aih/example-04-http-api/src/http/router.ts";
import { createApp } from "@aih/example-05-dynamodb/src/app.ts";
import { parseEnv } from "@aih/example-05-dynamodb/src/env.ts";
import { createLogger } from "@aih/example-05-dynamodb/src/log.ts";
import { createNoteService } from "@aih/example-05-dynamodb/src/notes.ts";

import { type ConsistencyMode, GlobalTableModel } from "./global-table.ts";
import { createRegionalApp } from "./regional-app.ts";
import { PRIMARY_REGION, REGIONS, type Region, STANDBY_REGION } from "./regions.ts";
import { ReplicaNoteRepository } from "./replica-repository.ts";

// Seoul: the third Region a strongly consistent table needs. It holds no copy.
export const WITNESS_REGION = "ap-northeast-2";

export type WorldOptions = {
  mode: ConsistencyMode;
  lagMs?: number | undefined;
  standbyWrites?: "accept" | "refuse" | undefined;
  /** Where the apps' error log lines go. Nowhere, unless a test wants to read them. */
  writeLog?: ((line: string) => void) | undefined;
};

// #region world
/** Tokyo and Osaka on a laptop: one table model, and chapter 05's API once per Region. */
export function createWorld(options: WorldOptions) {
  const table = new GlobalTableModel({
    mode: options.mode,
    replicas: REGIONS,
    witness: options.mode === "strong" ? WITNESS_REGION : undefined,
    lagMs: options.lagMs,
  });
  let clock = Date.UTC(2026, 9, 12, 9, 0, 0);
  let ids = 0;

  const appIn = (region: Region, writes: "accept" | "refuse"): Fetch => {
    const replica = table.replica(region);
    return createRegionalApp({
      app: createApp({
        env: parseEnv({ ALLOWED_ORIGIN: "http://localhost:5173", NOTES_STORE: "memory" }),
        log: createLogger("error", options.writeLog ?? (() => {})),
        notes: createNoteService({
          repository: new ReplicaNoteRepository(replica),
          now: () => new Date(clock),
          randomSuffix: () => (++ids).toString(36).padStart(4, "0"),
        }),
        newRequestId: () => `request-${++ids}`,
        now: () => clock,
      }),
      region,
      writes,
      probe: async () => {
        replica.get("health");
      },
      probeTimeoutMs: 50,
    });
  };

  return {
    table,
    apps: {
      [PRIMARY_REGION]: appIn(PRIMARY_REGION, "accept"),
      [STANDBY_REGION]: appIn(STANDBY_REGION, options.standbyWrites ?? "accept"),
    } satisfies Record<Region, Fetch>,
    notes: (region: Region) => new ReplicaNoteRepository(table.replica(region)),
    now: () => new Date(clock),
    /** Time passes in both Regions, and replication gets its chance. */
    advance(ms: number): void {
      clock += ms;
      table.advance(ms);
    },
  };
}
// #endregion world

export type World = ReturnType<typeof createWorld>;
