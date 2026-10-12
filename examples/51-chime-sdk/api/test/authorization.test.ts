import { describe, expect, it } from "vite-plus/test";

import { rejection, setup } from "./harness.ts";

// Invariant: a join token is created only for a signed-in member of the room, and reaches
// only that member.

describe("who gets a join token", () => {
  it("seats a member, as that member", async () => {
    const { alice, bob, chime } = await setup();
    const room = await alice.create();
    await alice.invite(room.id, "bob");

    const seat = await bob.join(room.id);

    expect(seat.attendee.ExternalUserId).toBe("bob");
    expect(chime.admit(seat.meeting.MeetingId, seat.attendee.JoinToken)).toBe("bob");
  });

  it("refuses a caller without a token before anything is created", async () => {
    const { alice, anonymous, chime } = await setup();
    const room = await alice.create();

    expect(await rejection(anonymous.join(room.id))).toEqual({
      status: 401,
      code: "unauthenticated",
    });
    expect(chime.meetingIds()).toEqual([]);
  });

  it("answers a signed-in stranger as if the room did not exist, and calls Chime for nothing", async () => {
    const { alice, carol, chime } = await setup();
    const room = await alice.create();
    await alice.join(room.id);
    const [meetingId = ""] = chime.meetingIds();

    for (const attempt of [
      () => carol.join(room.id),
      () => carol.get(room.id),
      () => carol.leave(room.id),
    ]) {
      expect(await rejection(attempt())).toEqual({ status: 404, code: "not_found" });
    }
    expect(await rejection(carol.join("no-such-room"))).toEqual({ status: 404, code: "not_found" });
    expect(chime.attendeeCount(meetingId)).toBe(1);
  });

  it("lets only the owner invite, remove and close", async () => {
    const { alice, bob, carol } = await setup();
    const room = await alice.create();
    await alice.invite(room.id, "bob");

    for (const attempt of [
      () => bob.invite(room.id, "carol"),
      () => bob.remove(room.id, "alice"),
      () => bob.close(room.id),
    ]) {
      expect(await rejection(attempt())).toEqual({ status: 403, code: "forbidden" });
    }
    // A stranger learns less than a member does.
    expect(await rejection(carol.close(room.id))).toEqual({ status: 404, code: "not_found" });
    expect((await alice.get(room.id)).members).toEqual(["alice", "bob"]);
  });

  it("keeps the owner in their own room", async () => {
    const { alice } = await setup();
    const room = await alice.create();
    expect(await rejection(alice.remove(room.id, "alice"))).toEqual({
      status: 403,
      code: "forbidden",
    });
  });

  it("refuses an ID that Chime would not take as an ExternalUserId", async () => {
    const { alice } = await setup();
    const room = await alice.create();
    for (const sub of ["x", "aws:root", "has space", "a".repeat(65)]) {
      expect(await rejection(alice.invite(room.id, sub)), sub).toEqual({
        status: 400,
        code: "invalid_request",
      });
    }
  });

  it("stops at ten members", async () => {
    const { alice } = await setup();
    const room = await alice.create();
    for (let n = 1; n < 10; n += 1) {
      await alice.invite(room.id, `guest-${n}`);
    }
    expect(await rejection(alice.invite(room.id, "guest-10"))).toEqual({
      status: 409,
      code: "room_full",
    });
    // Inviting someone who is already in is not a new member.
    await alice.invite(room.id, "guest-1");
  });
});

describe("where a join token goes", () => {
  it("sends each token to its own user and to nobody else", async () => {
    const { alice, bob } = await setup();
    const room = await alice.create();
    await alice.invite(room.id, "bob");
    const aliceSeat = await alice.join(room.id);

    // Everything Bob can ask for, after Alice has her seat.
    const bobSeat = await bob.join(room.id);
    await bob.get(room.id);
    const sentToBob = await bob.received();

    expect(sentToBob).toContain(bobSeat.attendee.JoinToken);
    expect(sentToBob).not.toContain(aliceSeat.attendee.JoinToken);
    expect(sentToBob).not.toContain(aliceSeat.attendee.AttendeeId);
  });

  it("marks the answer that carries a token as not to be cached", async () => {
    const { alice } = await setup();
    const room = await alice.create();
    await alice.join(room.id);
    expect(alice.responses.at(-1)?.headers.get("cache-control")).toBe("no-store");
  });

  it("shows members who is seated, and nothing that would let them sit there", async () => {
    const { alice, bob } = await setup();
    const room = await alice.create();
    await alice.invite(room.id, "bob");
    await alice.join(room.id);

    expect(await bob.get(room.id)).toEqual({
      id: room.id,
      owner: "alice",
      members: ["alice", "bob"],
      seated: ["alice"],
    });
  });
});
