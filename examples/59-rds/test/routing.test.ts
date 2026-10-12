import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { sqlStateOf } from "@aih/example-13-sql/src/db.ts";

import { LSN_MAX } from "../src/lsn.ts";
import type { ReplicationModel } from "../src/model/replication.ts";
import type { ReplicationPosition } from "../src/position.ts";
import { chooseReadTarget, routedRepository, type Session } from "../src/routing.ts";
import { migratedModel, noteNamed, repositoryOn } from "./support.ts";

describe("chooseReadTarget", () => {
  it("uses the replica only when it has replayed what the session has seen", () => {
    expect(chooseReadTarget(undefined, 100n)).toBe("replica");
    expect(chooseReadTarget(100n, 100n)).toBe("replica");
    expect(chooseReadTarget(100n, 101n)).toBe("replica");
    expect(chooseReadTarget(101n, 100n)).toBe("primary");
  });

  it("uses the primary when the replica's position is unknown", () => {
    expect(chooseReadTarget(undefined, undefined)).toBe("primary");
    expect(chooseReadTarget(100n, undefined)).toBe("primary");
    expect(chooseReadTarget(LSN_MAX, LSN_MAX - 1n)).toBe("primary");
  });
});

describe("one primary and one lagging replica (a model)", () => {
  let model: ReplicationModel;
  beforeAll(async () => {
    model = await migratedModel();
  }, 60_000);
  afterAll(() => model.close());

  const routed = (session: Session, position: ReplicationPosition = model.position) =>
    routedRepository({
      primary: repositoryOn(model.primary),
      replica: repositoryOn(model.replica),
      position,
      session,
    });

  // #region stale
  it("loses the author's own note when reads simply go to the replica", async () => {
    const note = noteNamed("written a moment ago");
    await repositoryOn(model.primary).create("author", note);

    // The write was acknowledged. The replica has not heard of it.
    expect(model.lag()).toBe(1);
    expect(await repositoryOn(model.replica).get("author", note.id)).toBeUndefined();
    await model.replay();
  });

  it("reads the author's own note from the primary while the replica is behind", async () => {
    const session: Session = { seen: undefined };
    const notes = routed(session);
    const note = noteNamed("read your writes");
    await notes.create("author", note);

    expect(await notes.get("author", note.id)).toEqual(note);
    expect(session.readFrom).toBe("primary");

    // Once the replica has replayed the write, the same session is served by it.
    await model.replay();
    expect(await notes.get("author", note.id)).toEqual(note);
    expect(session.readFrom).toBe("replica");
  });
  // #endregion stale

  it("promises nothing to a session that has seen nothing", async () => {
    const note = noteNamed("someone else's");
    await repositoryOn(model.primary).create("author", note);

    const stranger: Session = { seen: undefined };
    expect(await routed(stranger).get("author", note.id)).toBeUndefined();
    expect(stranger.readFrom).toBe("replica");
    await model.replay();
  });

  // #region monotonic
  it("never answers from a state older than one it has already shown", async () => {
    const session: Session = { seen: undefined };
    const notes = routed(session);
    const mine = noteNamed("mine");
    await notes.create("reader", mine);
    // Another session writes. The primary now holds two notes of this owner.
    const theirs = noteNamed("theirs");
    await repositoryOn(model.primary).create("reader", theirs);
    expect(await notes.list("reader")).toHaveLength(2);
    expect(session.readFrom).toBe("primary");

    // The replica catches up with this session's write only. Without the rule,
    // it would now be allowed to answer, and `theirs` would vanish from the list.
    await model.replay(1);
    expect(await notes.list("reader")).toHaveLength(2);
    expect(session.readFrom).toBe("primary");

    await model.replay();
    expect(await notes.list("reader")).toHaveLength(2);
    expect(session.readFrom).toBe("replica");
  });
  // #endregion monotonic

  it("goes to the primary when the replica cannot say where it is", async () => {
    const session: Session = { seen: undefined };
    const notes = routed(session, {
      written: model.position.written,
      replayed: () => Promise.reject(new Error("connection terminated")),
    });
    expect(await notes.list("nobody")).toEqual([]);
    expect(session.readFrom).toBe("primary");
  });

  it("pins the session to the primary when the position after a write is unknown", async () => {
    const session: Session = { seen: undefined };
    const broken = routed(session, {
      written: () => Promise.reject(new Error("connection terminated")),
      replayed: model.position.replayed,
    });
    const note = noteNamed("committed, position lost");
    await broken.create("pinned", note);
    expect(session.seen).toBe(LSN_MAX);

    // However far the replica gets, this session cannot prove it is far enough.
    await model.replay();
    expect(await routed(session).get("pinned", note.id)).toEqual(note);
    expect(session.readFrom).toBe("primary");
  });

  it("refuses a write on the replica, as a hot standby does", async () => {
    const error = await repositoryOn(model.replica)
      .create("author", noteNamed("misrouted"))
      .catch((caught: unknown) => caught);
    // 25006, read_only_sql_transaction.
    expect(sqlStateOf(error)).toBe("25006");
  });
});

describe("promoting a replica that is behind (a model)", () => {
  // #region promote
  it("loses a write the primary had acknowledged", async () => {
    const model = await migratedModel();
    const kept = noteNamed("replayed before the failure");
    const lost = noteNamed("acknowledged, never replayed");
    await repositoryOn(model.primary).create("author", kept);
    await model.replay();
    await repositoryOn(model.primary).create("author", lost);

    const promoted = repositoryOn(await model.promote());
    expect(await promoted.get("author", kept.id)).toEqual(kept);
    expect(await promoted.get("author", lost.id)).toBeUndefined();
    // And it is a primary now: it takes writes.
    expect(await promoted.create("author", noteNamed("after the promotion"))).toBe("created");
    await model.close();
  }, 60_000);
  // #endregion promote
});
