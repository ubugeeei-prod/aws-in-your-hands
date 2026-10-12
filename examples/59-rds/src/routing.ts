import type { NoteRepository } from "@aih/example-13-sql/src/notes-repository.ts";

import { laterOf, type Lsn, LSN_MAX } from "./lsn.ts";
import type { ReplicationPosition } from "./position.ts";

// #region choose
export type ReadTarget = "primary" | "replica";

/**
 * Where a read may go. `seen` is the newest log position this session has
 * observed: its own last write, or the state its last read was answered from.
 */
export function chooseReadTarget(seen: Lsn | undefined, replayed: Lsn | undefined): ReadTarget {
  if (replayed === undefined) {
    return "primary";
  }
  return seen === undefined || replayed >= seen ? "replica" : "primary";
}
// #endregion choose

// #region session
/** One caller's view of time. It travels with the caller, not with the server. */
export type Session = { seen: Lsn | undefined; readFrom?: ReadTarget };

export type RoutedDeps = {
  primary: NoteRepository;
  replica: NoteRepository;
  position: ReplicationPosition;
  session: Session;
};

export function routedRepository(deps: RoutedDeps): NoteRepository {
  const { primary, replica, position, session } = deps;

  // After a write, and after a read the primary answered, the session has seen
  // the primary as it is now.
  const sawPrimary = async (): Promise<void> => {
    try {
      session.seen = laterOf(session.seen, await position.written());
    } catch {
      // The position is unknown. Pin the session to the primary rather than guess.
      session.seen = LSN_MAX;
    }
  };

  const write = async <T>(run: (repository: NoteRepository) => Promise<T>): Promise<T> => {
    try {
      return await run(primary);
    } finally {
      // Also after an error: a COMMIT whose answer was lost may have happened.
      await sawPrimary();
    }
  };

  const read = async <T>(run: (repository: NoteRepository) => Promise<T>): Promise<T> => {
    const replayed = await position.replayed().catch(() => undefined);
    session.readFrom = chooseReadTarget(session.seen, replayed);
    if (session.readFrom === "replica") {
      // The replica only moves forward, so what it answers is at least `replayed`.
      const result = await run(replica);
      session.seen = laterOf(session.seen, replayed);
      return result;
    }
    const result = await run(primary);
    await sawPrimary();
    return result;
  };

  return {
    create: (owner, note) => write((repository) => repository.create(owner, note)),
    update: (owner, id, change) => write((repository) => repository.update(owner, id, change)),
    delete: (owner, id) => write((repository) => repository.delete(owner, id)),
    get: (owner, id) => read((repository) => repository.get(owner, id)),
    list: (owner) => read((repository) => repository.list(owner)),
  };
}
// #endregion session
