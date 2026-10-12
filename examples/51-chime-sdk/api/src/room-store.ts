// #region room
export type Room = {
  id: string;
  owner: string;
  /** Who may take a seat. The owner is always one of them. */
  members: string[];
  /** Set before a room is torn down. A closed room seats nobody. */
  closed: boolean;
  /** The Chime meeting this room is using now, if any. */
  meetingId?: string;
  /** User → attendee ID in that meeting. One seat per user. */
  seats: Record<string, string>;
};
// #endregion room

// #region store
// Every method is one conditional write. `false` means the condition did not hold:
// somebody else changed the room first, and the caller decides what that means.
export type RoomStore = {
  create(room: Room): Promise<void>;
  get(id: string): Promise<Room | undefined>;
  /** False when the room is gone, closed, or already holds `max` members. */
  addMember(id: string, sub: string, max: number): Promise<boolean>;
  removeMember(id: string, sub: string): Promise<void>;
  /** Swaps the meeting if it still is `expected`. A new meeting starts with no seats, and needs an open room. */
  setMeeting(id: string, expected: string | undefined, next: string | undefined): Promise<boolean>;
  /**
   * Swaps one user's seat if it still is `expected`. Taking a seat also needs the user to be a
   * member, the room to be open, and the meeting to be the one the attendee was created in.
   */
  setSeat(id: string, change: SeatChange): Promise<boolean>;
  close(id: string): Promise<void>;
  delete(id: string): Promise<void>;
};

export type SeatChange = {
  meetingId: string;
  sub: string;
  expected: string | undefined;
  next: string | undefined;
};
// #endregion store

export class InMemoryRoomStore implements RoomStore {
  readonly #rooms = new Map<string, Room>();

  async create(room: Room) {
    if (this.#rooms.has(room.id)) {
      throw new Error(`room ${room.id} already exists`);
    }
    this.#rooms.set(room.id, structuredClone(room));
  }

  async get(id: string) {
    const room = this.#rooms.get(id);
    return room === undefined ? undefined : structuredClone(room);
  }

  async addMember(id: string, sub: string, max: number) {
    const room = this.#rooms.get(id);
    if (room === undefined || room.closed) {
      return false;
    }
    if (room.members.includes(sub)) {
      return true;
    }
    if (room.members.length >= max) {
      return false;
    }
    room.members.push(sub);
    return true;
  }

  async removeMember(id: string, sub: string) {
    const room = this.#rooms.get(id);
    if (room !== undefined) {
      room.members = room.members.filter((member) => member !== sub);
    }
  }

  async setMeeting(id: string, expected: string | undefined, next: string | undefined) {
    const room = this.#rooms.get(id);
    if (room === undefined || room.meetingId !== expected || (next !== undefined && room.closed)) {
      return false;
    }
    if (next === undefined) {
      delete room.meetingId;
    } else {
      room.meetingId = next;
    }
    room.seats = {};
    return true;
  }

  async setSeat(id: string, { meetingId, sub, expected, next }: SeatChange) {
    const room = this.#rooms.get(id);
    if (room === undefined || room.meetingId !== meetingId || room.seats[sub] !== expected) {
      return false;
    }
    if (next === undefined) {
      delete room.seats[sub];
      return true;
    }
    if (room.closed || !room.members.includes(sub)) {
      return false;
    }
    room.seats[sub] = next;
    return true;
  }

  async close(id: string) {
    const room = this.#rooms.get(id);
    if (room !== undefined) {
      room.closed = true;
    }
  }

  async delete(id: string) {
    this.#rooms.delete(id);
  }
}
