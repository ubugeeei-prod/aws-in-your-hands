import { describe, expect, it } from "vite-plus/test";

import { InMemoryRoomStore, type Room } from "../src/room-store.ts";

// The conditions the service leans on. The DynamoDB store states the same ones as
// condition expressions; dynamodb-room-store.test.ts pins those.

const room = (extra: Partial<Room> = {}): Room => ({
  id: "r1",
  owner: "alice",
  members: ["alice", "bob"],
  closed: false,
  seats: {},
  ...extra,
});

async function storeWith(initial: Room) {
  const store = new InMemoryRoomStore();
  await store.create(initial);
  return store;
}

describe("InMemoryRoomStore: taking a seat", () => {
  const seat = { meetingId: "m1", sub: "bob", expected: undefined, next: "a1" };

  it("needs a member, an open room, the current meeting and an unchanged seat", async () => {
    expect(await (await storeWith(room({ meetingId: "m1" }))).setSeat("r1", seat)).toBe(true);

    const refused: Room[] = [
      room({ meetingId: "m1", members: ["alice"] }),
      room({ meetingId: "m1", closed: true }),
      room({ meetingId: "m2" }),
      room(),
      room({ meetingId: "m1", seats: { bob: "a0" } }),
    ];
    for (const initial of refused) {
      expect(await (await storeWith(initial)).setSeat("r1", seat), JSON.stringify(initial)).toBe(
        false,
      );
    }
    expect(await new InMemoryRoomStore().setSeat("r1", seat)).toBe(false);
  });

  it("lets a seat be given up by someone who is no longer a member, in a closed room", async () => {
    const store = await storeWith(
      room({ meetingId: "m1", members: ["alice"], closed: true, seats: { bob: "a1" } }),
    );
    expect(
      await store.setSeat("r1", { meetingId: "m1", sub: "bob", expected: "a1", next: undefined }),
    ).toBe(true);
    expect((await store.get("r1"))?.seats).toEqual({});
  });
});

describe("InMemoryRoomStore: the meeting", () => {
  it("is swapped only from the value the caller saw, and empties the seats", async () => {
    const store = await storeWith(room({ meetingId: "m1", seats: { alice: "a1" } }));
    expect(await store.setMeeting("r1", undefined, "m2")).toBe(false);
    expect(await store.setMeeting("r1", "m1", "m2")).toBe(true);
    expect(await store.get("r1")).toMatchObject({ meetingId: "m2", seats: {} });
  });

  it("cannot be set on a closed room, but can be cleared", async () => {
    const store = await storeWith(room({ meetingId: "m1", closed: true }));
    expect(await store.setMeeting("r1", "m1", "m2")).toBe(false);
    expect(await store.setMeeting("r1", "m1", undefined)).toBe(true);
    expect((await store.get("r1"))?.meetingId).toBeUndefined();
  });
});

describe("InMemoryRoomStore: members", () => {
  it("are not added to a closed or missing room, nor past the limit", async () => {
    expect(await (await storeWith(room({ closed: true }))).addMember("r1", "carol", 10)).toBe(
      false,
    );
    expect(await new InMemoryRoomStore().addMember("r1", "carol", 10)).toBe(false);
    const store = await storeWith(room());
    expect(await store.addMember("r1", "carol", 2)).toBe(false);
    expect(await store.addMember("r1", "bob", 2)).toBe(true);
    expect(await store.addMember("r1", "carol", 3)).toBe(true);
  });

  it("hands out copies, so a caller cannot change a room without a write", async () => {
    const store = await storeWith(room());
    const copy = await store.get("r1");
    copy?.members.push("mallory");
    expect((await store.get("r1"))?.members).toEqual(["alice", "bob"]);
  });
});
