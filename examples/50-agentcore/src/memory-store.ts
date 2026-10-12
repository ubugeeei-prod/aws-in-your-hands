import type { TurnEvent } from "./session.ts";

// #region store
/**
 * Where a session's events outlive the process. Every call names the actor: there is no
 * way to ask for a session without saying whose it is.
 */
export type MemoryStore = {
  /** Every event of this actor's session, in any order. Empty for a session nobody has used. */
  load(actorId: string, sessionId: string): Promise<TurnEvent[]>;
  /**
   * Adds one event. Adding the same `seq` to the same session again changes nothing and
   * is not an error: the first one stays.
   */
  append(actorId: string, sessionId: string, event: TurnEvent): Promise<void>;
};
// #endregion store

// #region memory
/** One process and one Map. It says nothing about AgentCore Memory's limits, delays or errors. */
export class InMemoryMemoryStore implements MemoryStore {
  readonly #sessions = new Map<string, TurnEvent[]>();

  // JSON keeps the two parts apart whatever characters they contain.
  #key = (actorId: string, sessionId: string): string => JSON.stringify([actorId, sessionId]);

  async load(actorId: string, sessionId: string) {
    return [...(this.#sessions.get(this.#key(actorId, sessionId)) ?? [])];
  }

  async append(actorId: string, sessionId: string, event: TurnEvent) {
    const key = this.#key(actorId, sessionId);
    const events = this.#sessions.get(key) ?? [];
    if (!events.some(({ seq }) => seq === event.seq)) {
      this.#sessions.set(key, [...events, event]);
    }
  }
}
// #endregion memory
