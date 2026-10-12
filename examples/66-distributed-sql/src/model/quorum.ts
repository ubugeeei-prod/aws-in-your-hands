// A MODEL of one replicated log with three copies, written for this chapter's
// tests. It is not YugabyteDB and not Raft: there is no network and no time,
// and elections happen when a test says so. It keeps the one rule the chapter's
// invariant rests on (when a write may be acknowledged) and the one rule of an
// election that protects it (the new leader holds everything a majority holds).

import { NODE_NAMES, type NodeName } from "../topology.ts";

// #region model
/** `term` counts elections. An entry keeps the term of the leader that wrote it. */
export type Entry = { term: number; value: string };
export type Replica = { name: NodeName; up: boolean; log: Entry[] };
export type Group = { replicas: Replica[]; leader: NodeName | undefined; term: number };

/** "majority" is what the database does. "leader-only" is asynchronous replication, kept to show what it loses. */
export type AckRule = "majority" | "leader-only";

export function newGroup(): Group {
  return {
    replicas: NODE_NAMES.map((name) => ({ name, up: true, log: [] })),
    leader: "a",
    term: 1,
  };
}

const majorityOf = (group: Group): number => Math.floor(group.replicas.length / 2) + 1;
const replica = (group: Group, name: NodeName): Replica => {
  const found = group.replicas.find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(`no replica ${name}`);
  }
  return found;
};

/**
 * The leader appends `entry`, and it reaches the followers in `reached` before
 * anything else happens. Which followers those are is the test's choice: it
 * stands for every way messages can be slow or lost.
 */
export function write(
  group: Group,
  entry: string,
  rule: AckRule,
  reached: readonly NodeName[],
): "acknowledged" | "not acknowledged" {
  if (group.leader === undefined) {
    return "not acknowledged";
  }
  const leader = replica(group, group.leader);
  leader.log.push({ term: group.term, value: entry });
  let copies = 1;
  for (const name of reached) {
    const follower = replica(group, name);
    if (follower.up && follower.name !== leader.name) {
      follower.log = [...leader.log];
      copies++;
    }
  }
  return rule === "leader-only" || copies >= majorityOf(group)
    ? "acknowledged"
    : "not acknowledged";
}

export function crash(group: Group, name: NodeName): void {
  replica(group, name).up = false;
  if (group.leader === name) {
    group.leader = undefined;
  }
}

/** A copy that comes back while there is a leader takes the leader's log, dropping what it lacks. */
export function restart(group: Group, name: NodeName): void {
  const returning = replica(group, name);
  returning.up = true;
  if (group.leader !== undefined) {
    returning.log = [...replica(group, group.leader).log];
  }
}

/**
 * A majority of the copies choose, among those that are up, the log whose last
 * entry is from the latest term, and the longest of those. The others take
 * that log, dropping what it lacks. With fewer than a majority up there is no
 * leader, and the group answers nothing.
 */
export function elect(group: Group): NodeName | undefined {
  const up = group.replicas.filter((candidate) => candidate.up);
  if (up.length < majorityOf(group)) {
    group.leader = undefined;
    return undefined;
  }
  const lastTerm = (candidate: Replica): number => candidate.log.at(-1)?.term ?? 0;
  const leader = up.toSorted(
    (left, right) => lastTerm(right) - lastTerm(left) || right.log.length - left.log.length,
  )[0];
  if (leader === undefined) {
    return undefined;
  }
  for (const follower of up) {
    follower.log = [...leader.log];
  }
  group.leader = leader.name;
  group.term++;
  return leader.name;
}

/** What a client reads: the leader's log, or nothing while there is no leader. */
export function read(group: Group): string[] | "unavailable" {
  return group.leader === undefined
    ? "unavailable"
    : replica(group, group.leader).log.map((entry) => entry.value);
}
// #endregion model
