import { MAX_MEMBERS_PER_ROOM, type RoomView, type Seat } from "./contract.ts";
import type { MeetingsGateway } from "./meetings.ts";
import type { Room, RoomStore } from "./room-store.ts";

export type RoomDeps = {
  store: RoomStore;
  meetings: MeetingsGateway;
  /** Room IDs and Chime request tokens. Unguessable in a deployment. */
  newId: () => string;
};

export type JoinOutcome =
  | { status: "seated"; seat: Seat }
  | { status: "not_found" }
  /** Lost to another join three times in a row. Nothing was handed out. */
  | { status: "busy" };

export type OwnerOutcome = "done" | "not_found" | "forbidden";

const JOIN_ATTEMPTS = 3;

const view = (room: Room): RoomView => ({
  id: room.id,
  owner: room.owner,
  members: room.members,
  seated: room.members.filter((member) => room.seats[member] !== undefined),
});

export function createRoomService({ store, meetings, newId }: RoomDeps) {
  // #region membership
  // To anyone who is not a member, a room does not exist. So a room ID tells a stranger nothing.
  const roomFor = async (sub: string, id: string): Promise<Room | undefined> => {
    const room = await store.get(id);
    return room !== undefined && !room.closed && room.members.includes(sub) ? room : undefined;
  };

  const ownedBy = async (
    sub: string,
    id: string,
  ): Promise<Room | Exclude<OwnerOutcome, "done">> => {
    const room = await store.get(id);
    if (room === undefined || !room.members.includes(sub)) {
      return "not_found";
    }
    return room.owner === sub ? room : "forbidden";
  };
  // #endregion membership

  return {
    async create(sub: string): Promise<RoomView> {
      const room: Room = { id: newId(), owner: sub, members: [sub], closed: false, seats: {} };
      await store.create(room);
      return view(room);
    },

    async get(sub: string, id: string): Promise<RoomView | undefined> {
      const room = await roomFor(sub, id);
      return room === undefined ? undefined : view(room);
    },

    async invite(sub: string, id: string, member: string): Promise<OwnerOutcome | "full"> {
      const room = await ownedBy(sub, id);
      if (typeof room === "string") {
        return room;
      }
      return (await store.addMember(id, member, MAX_MEMBERS_PER_ROOM)) ? "done" : "full";
    },

    // #region join
    async join(sub: string, id: string): Promise<JoinOutcome> {
      for (let attempt = 0; attempt < JOIN_ATTEMPTS; attempt += 1) {
        const room = await roomFor(sub, id);
        if (room === undefined) {
          return { status: "not_found" };
        }

        // The meeting may have ended by itself since the table last heard of it.
        let meeting =
          room.meetingId === undefined ? undefined : await meetings.getMeeting(room.meetingId);
        if (meeting === undefined) {
          const created = await meetings.createMeeting({ externalMeetingId: id, token: newId() });
          if (!(await store.setMeeting(id, room.meetingId, created.MeetingId))) {
            // Another join started one first. Ours has nobody in it: end it and use theirs.
            await meetings.deleteMeeting(created.MeetingId);
            continue;
          }
          meeting = created;
          room.seats = {};
        }

        // The old seat goes before the new one exists, so the old token is dead by now.
        const previous = room.seats[sub];
        if (previous !== undefined) {
          await meetings.deleteAttendee(meeting.MeetingId, previous);
        }
        const attendee = await meetings.createAttendee(meeting.MeetingId, sub);
        if (attendee === "meeting_gone") {
          continue;
        }

        // The token leaves this function only after the table says the seat is this user's.
        const seated = await store.setSeat(id, {
          meetingId: meeting.MeetingId,
          sub,
          expected: previous,
          next: attendee.AttendeeId,
        });
        if (seated) {
          return { status: "seated", seat: { meeting, attendee } };
        }
        // Removed from the room, room closed, meeting replaced, or the same user joined elsewhere.
        await meetings.deleteAttendee(meeting.MeetingId, attendee.AttendeeId);
      }
      return { status: "busy" };
    },
    // #endregion join

    // #region leave
    async leave(sub: string, id: string): Promise<"left" | "not_found"> {
      const room = await roomFor(sub, id);
      if (room === undefined) {
        return "not_found";
      }
      const seat = room.seats[sub];
      if (room.meetingId !== undefined && seat !== undefined) {
        // Chime first. If this throws, the table still names the seat and a retry finds it.
        await meetings.deleteAttendee(room.meetingId, seat);
        await store.setSeat(id, {
          meetingId: room.meetingId,
          sub,
          expected: seat,
          next: undefined,
        });
      }
      return "left";
    },
    // #endregion leave

    // #region revoke
    // Both follow one order: take the right away, then end what the right had produced,
    // then forget it. A step that fails leaves enough in the table for the same call to finish.
    async remove(sub: string, id: string, member: string): Promise<OwnerOutcome> {
      const owned = await ownedBy(sub, id);
      if (typeof owned === "string") {
        return owned;
      }
      if (member === owned.owner) {
        return "forbidden";
      }
      await store.removeMember(id, member);
      // Read again: a join that was under way either seated before this point or can no longer seat.
      const room = await store.get(id);
      const seat = room?.seats[member];
      if (room?.meetingId !== undefined && seat !== undefined) {
        await meetings.deleteAttendee(room.meetingId, seat);
        await store.setSeat(id, {
          meetingId: room.meetingId,
          sub: member,
          expected: seat,
          next: undefined,
        });
      }
      return "done";
    },

    async close(sub: string, id: string): Promise<OwnerOutcome> {
      const owned = await ownedBy(sub, id);
      if (typeof owned === "string") {
        return owned;
      }
      await store.close(id);
      const room = await store.get(id);
      if (room?.meetingId !== undefined) {
        // The meeting ID exists nowhere but in this item, and Chime has no call that lists
        // meetings. So the item is deleted only after the meeting is.
        await meetings.deleteMeeting(room.meetingId);
      }
      await store.delete(id);
      return "done";
    },
    // #endregion revoke
  };
}

export type RoomService = ReturnType<typeof createRoomService>;
