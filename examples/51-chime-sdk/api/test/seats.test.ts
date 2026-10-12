import { describe, expect, it } from "vite-plus/test";

import { rejection, setup } from "./harness.ts";

// Two things hold state here: the table (who sits where) and Chime (which tokens work).
// These tests put a failure or another request between the two writes, in a fixed order.

async function roomOfTwo() {
  const context = await setup();
  const room = await context.alice.create();
  await context.alice.invite(room.id, "bob");
  return { ...context, room };
}

describe("one seat per user", () => {
  it("ends the old token when the same user joins again", async () => {
    const { alice, chime, room } = await roomOfTwo();
    const first = await alice.join(room.id);
    const second = await alice.join(room.id);
    const meetingId = second.meeting.MeetingId;

    expect(chime.admit(meetingId, first.attendee.JoinToken)).toBeUndefined();
    expect(chime.admit(meetingId, second.attendee.JoinToken)).toBe("alice");
    expect(chime.attendeeCount(meetingId)).toBe(1);
  });

  it("leaves one working token when the same user joins from two tabs at once", async () => {
    const { alice, chime, store, room } = await roomOfTwo();
    await alice.join(room.id);
    // The second tab's whole join runs just before the first tab records its seat.
    let secondTab: Awaited<ReturnType<typeof alice.join>> | undefined;
    store.before("setSeat", async () => {
      secondTab = await alice.join(room.id);
    });

    const firstTab = await alice.join(room.id);
    const meetingId = firstTab.meeting.MeetingId;

    // The first tab lost the seat, tried again, and so took it back: last join wins.
    expect(chime.admit(meetingId, secondTab?.attendee.JoinToken ?? "")).toBeUndefined();
    expect(chime.admit(meetingId, firstTab.attendee.JoinToken)).toBe("alice");
    expect(chime.attendeeCount(meetingId)).toBe(1);
  });

  it("gives up after three lost rounds, and leaves no attendee behind", async () => {
    const { alice, chime, store, realStore, room } = await roomOfTwo();
    const { meeting } = await alice.join(room.id);
    // Each round, the seat changes hands just before this join records its own.
    for (let round = 1; round <= 3; round += 1) {
      store.before("setSeat", async () => {
        const current = await realStore.get(room.id);
        await realStore.setSeat(room.id, {
          meetingId: meeting.MeetingId,
          sub: "alice",
          expected: current?.seats["alice"],
          next: `taken-elsewhere-${round}`,
        });
      });
    }

    expect(await rejection(alice.join(room.id))).toEqual({ status: 409, code: "join_in_progress" });
    expect(chime.attendeeCount(meeting.MeetingId)).toBe(0);
  });
});

describe("leaving", () => {
  it("ends the attendee, so the token stops working", async () => {
    const { alice, bob, chime, room } = await roomOfTwo();
    const seat = await alice.join(room.id);

    await alice.leave(room.id);

    expect(chime.admit(seat.meeting.MeetingId, seat.attendee.JoinToken)).toBeUndefined();
    expect((await bob.get(room.id)).seated).toEqual([]);
    // Leaving twice, or without a seat, is not an error.
    await alice.leave(room.id);
    await bob.leave(room.id);
  });

  it("keeps the seat on record when Chime fails, so a second try can end it", async () => {
    const { alice, chime, meetings, room } = await roomOfTwo();
    const seat = await alice.join(room.id);
    meetings.failNext("deleteAttendee");

    expect(await rejection(alice.leave(room.id))).toEqual({
      status: 503,
      code: "media_unavailable",
    });
    // Said plainly: after a failed leave the token still works.
    expect(chime.admit(seat.meeting.MeetingId, seat.attendee.JoinToken)).toBe("alice");
    expect((await alice.get(room.id)).seated).toEqual(["alice"]);

    await alice.leave(room.id);
    expect(chime.admit(seat.meeting.MeetingId, seat.attendee.JoinToken)).toBeUndefined();
  });
});

describe("removing a member", () => {
  it("ends their token and their right to a new one", async () => {
    const { alice, bob, chime, room } = await roomOfTwo();
    const seat = await bob.join(room.id);

    await alice.remove(room.id, "bob");

    expect(chime.admit(seat.meeting.MeetingId, seat.attendee.JoinToken)).toBeUndefined();
    expect(await rejection(bob.join(room.id))).toEqual({ status: 404, code: "not_found" });
    expect(chime.attendeeCount(seat.meeting.MeetingId)).toBe(0);
  });

  it("hands out no token when the removal lands in the middle of a join", async () => {
    const { alice, bob, chime, store, room } = await roomOfTwo();
    const { meeting } = await alice.join(room.id);
    // Bob's attendee already exists in Chime. His seat is not on record yet.
    store.before("setSeat", () => alice.remove(room.id, "bob"));

    expect(await rejection(bob.join(room.id))).toEqual({ status: 404, code: "not_found" });

    expect(await bob.received()).not.toContain("JoinToken");
    expect(chime.attendeeCount(meeting.MeetingId)).toBe(1);
  });

  it("finishes on a second try when Chime failed the first", async () => {
    const { alice, bob, chime, meetings, room } = await roomOfTwo();
    const seat = await bob.join(room.id);
    meetings.failNext("deleteAttendee");

    expect((await rejection(alice.remove(room.id, "bob"))).status).toBe(503);
    // Membership went first: the token still works, but no new one can be had.
    expect(chime.admit(seat.meeting.MeetingId, seat.attendee.JoinToken)).toBe("bob");
    expect((await rejection(bob.join(room.id))).status).toBe(404);

    await alice.remove(room.id, "bob");
    expect(chime.admit(seat.meeting.MeetingId, seat.attendee.JoinToken)).toBeUndefined();
  });
});

describe("the meeting behind a room", () => {
  it("is created by the first join and shared by the next", async () => {
    const { alice, bob, chime, room } = await roomOfTwo();
    expect(chime.meetingIds()).toEqual([]);

    const first = await alice.join(room.id);
    const second = await bob.join(room.id);

    expect(second.meeting.MeetingId).toBe(first.meeting.MeetingId);
    expect(chime.meetingIds()).toEqual([first.meeting.MeetingId]);
  });

  it("stays one meeting when two first joins race", async () => {
    const { alice, bob, chime, store, room } = await roomOfTwo();
    // Bob creates and records his meeting while Alice's is created but not yet recorded.
    let bobSeat: Awaited<ReturnType<typeof bob.join>> | undefined;
    store.before("setMeeting", async () => {
      bobSeat = await bob.join(room.id);
    });

    const aliceSeat = await alice.join(room.id);

    expect(aliceSeat.meeting.MeetingId).toBe(bobSeat?.meeting.MeetingId);
    expect(chime.meetingIds()).toEqual([aliceSeat.meeting.MeetingId]);
    expect(chime.attendeeCount(aliceSeat.meeting.MeetingId)).toBe(2);
  });

  it("is replaced when Chime has ended it", async () => {
    const { alice, bob, chime, room } = await roomOfTwo();
    const old = await alice.join(room.id);
    chime.end(old.meeting.MeetingId);

    const fresh = await bob.join(room.id);

    expect(fresh.meeting.MeetingId).not.toBe(old.meeting.MeetingId);
    expect(chime.admit(fresh.meeting.MeetingId, fresh.attendee.JoinToken)).toBe("bob");
    // Alice's seat went with the old meeting.
    expect((await alice.get(room.id)).seated).toEqual(["bob"]);
  });

  it("is replaced when it ends between the look and the seat", async () => {
    const { alice, bob, chime, meetings, room } = await roomOfTwo();
    const old = await alice.join(room.id);
    meetings.before("createAttendee", async () => chime.end(old.meeting.MeetingId));

    const fresh = await bob.join(room.id);

    expect(chime.meetingIds()).toEqual([fresh.meeting.MeetingId]);
    expect(chime.admit(fresh.meeting.MeetingId, fresh.attendee.JoinToken)).toBe("bob");
  });

  it("hands out nothing when Chime fails, and records no seat", async () => {
    const { alice, meetings, room } = await roomOfTwo();
    await alice.join(room.id);
    meetings.failNext("createAttendee");

    expect(await rejection(alice.join(room.id))).toEqual({
      status: 503,
      code: "media_unavailable",
    });
    expect(await alice.received()).not.toContain("injected");
    expect((await alice.get(room.id)).seated).toEqual(["alice"]);
  });
});

describe("closing a room", () => {
  it("ends the meeting and every token in it", async () => {
    const { alice, bob, chime, room } = await roomOfTwo();
    const seats = [await alice.join(room.id), await bob.join(room.id)];

    await alice.close(room.id);

    for (const seat of seats) {
      expect(chime.admit(seat.meeting.MeetingId, seat.attendee.JoinToken)).toBeUndefined();
    }
    expect(chime.meetingIds()).toEqual([]);
    expect((await rejection(bob.join(room.id))).status).toBe(404);
  });

  it("keeps the meeting ID until Chime has confirmed the end", async () => {
    const { alice, bob, chime, meetings, realStore, room } = await roomOfTwo();
    const seat = await alice.join(room.id);
    meetings.failNext("deleteMeeting");

    expect((await rejection(alice.close(room.id))).status).toBe(503);
    // The meeting runs on, and the table still knows which one it is.
    expect((await realStore.get(room.id))?.meetingId).toBe(seat.meeting.MeetingId);
    // Nobody can take a new seat in the meantime.
    expect((await rejection(bob.join(room.id))).status).toBe(404);

    await alice.close(room.id);
    expect(chime.meetingIds()).toEqual([]);
    expect(await realStore.get(room.id)).toBeUndefined();
  });

  it("leaves no meeting behind when a first join races the close", async () => {
    const { alice, bob, chime, store, room } = await roomOfTwo();
    // Bob's meeting exists in Chime but is not on record when the room closes.
    store.before("setMeeting", () => alice.close(room.id));

    expect((await rejection(bob.join(room.id))).status).toBe(404);

    expect(chime.meetingIds()).toEqual([]);
    expect(await bob.received()).not.toContain("JoinToken");
  });
});
