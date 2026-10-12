import {
  CreateAttendeeCommand,
  CreateMeetingCommand,
  DeleteAttendeeCommand,
  DeleteMeetingCommand,
  GetMeetingCommand,
  NotFoundException,
  ThrottlingException,
} from "@aws-sdk/client-chime-sdk-meetings";
import { describe, expect, it } from "vite-plus/test";

import { createChimeMeetings } from "../src/chime-meetings.ts";
import { MeetingsError } from "../src/meetings.ts";

// The responses below are written by hand from the API reference's response syntax.
// No Chime call has been made, so the real shapes are not observed.
const MEETING = {
  MeetingId: "11111111-2222-3333-4444-555555555555",
  ExternalMeetingId: "room-1",
  MediaRegion: "ap-northeast-1",
  MediaPlacement: {
    AudioHostUrl: "audio.example.test:3478",
    AudioFallbackUrl: "wss://audio.example.test:443/calls/1",
    SignalingUrl: "wss://signal.example.test/control/1",
    TurnControlUrl: "https://turn.example.test/v2/turn_sessions",
    EventIngestionUrl: "https://events.example.test/v1/client-events",
  },
};
const ATTENDEE = {
  AttendeeId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  ExternalUserId: "user-1",
  JoinToken: "a-join-token",
  Capabilities: { Audio: "SendReceive", Video: "SendReceive", Content: "SendReceive" },
};

function setup(respond: (command: object) => unknown) {
  const sent: { input: unknown }[] = [];
  const client = {
    send: async (command: { input: unknown }) => {
      sent.push(command);
      return respond(command);
    },
  };
  return { meetings: createChimeMeetings(client as never, "ap-northeast-1"), sent };
}

const notFound = () => {
  throw new NotFoundException({ message: "not found", $metadata: {} });
};
const throttled = () => {
  throw new ThrottlingException({ message: "slow down", $metadata: {} });
};

describe("createChimeMeetings", () => {
  it("creates a meeting in the media Region it was given, under the caller's token", async () => {
    const { meetings, sent } = setup(() => ({ Meeting: MEETING }));
    const meeting = await meetings.createMeeting({ externalMeetingId: "room-1", token: "t-1" });

    expect(sent[0]).toBeInstanceOf(CreateMeetingCommand);
    expect(sent[0]?.input).toEqual({
      ClientRequestToken: "t-1",
      ExternalMeetingId: "room-1",
      MediaRegion: "ap-northeast-1",
    });
    // Only what the browser library reads is passed on.
    expect(meeting).toEqual({
      MeetingId: MEETING.MeetingId,
      MediaRegion: "ap-northeast-1",
      MediaPlacement: {
        AudioHostUrl: MEETING.MediaPlacement.AudioHostUrl,
        SignalingUrl: MEETING.MediaPlacement.SignalingUrl,
        TurnControlUrl: MEETING.MediaPlacement.TurnControlUrl,
        EventIngestionUrl: MEETING.MediaPlacement.EventIngestionUrl,
      },
    });
  });

  it("creates an attendee under the user's own ID", async () => {
    const { meetings, sent } = setup(() => ({ Attendee: ATTENDEE }));
    const attendee = await meetings.createAttendee(MEETING.MeetingId, "user-1");

    expect(sent[0]).toBeInstanceOf(CreateAttendeeCommand);
    expect(sent[0]?.input).toEqual({ MeetingId: MEETING.MeetingId, ExternalUserId: "user-1" });
    expect(attendee).toEqual({
      AttendeeId: ATTENDEE.AttendeeId,
      ExternalUserId: "user-1",
      JoinToken: "a-join-token",
    });
  });

  it("treats a meeting that is gone as an answer, not an error", async () => {
    const { meetings, sent } = setup(notFound);
    expect(await meetings.getMeeting("m")).toBeUndefined();
    expect(await meetings.createAttendee("m", "user-1")).toBe("meeting_gone");
    // Deleting twice is how a retry looks. It must succeed.
    await meetings.deleteAttendee("m", "a");
    await meetings.deleteMeeting("m");
    expect(sent.map((command) => command.constructor)).toEqual([
      GetMeetingCommand,
      CreateAttendeeCommand,
      DeleteAttendeeCommand,
      DeleteMeetingCommand,
    ]);
    expect(sent[2]?.input).toEqual({ MeetingId: "m", AttendeeId: "a" });
  });

  it("reports throttling and every other failure as a MeetingsError", async () => {
    const { meetings } = setup(throttled);
    for (const call of [
      () => meetings.createMeeting({ externalMeetingId: "room-1", token: "t-1" }),
      () => meetings.getMeeting("m"),
      () => meetings.createAttendee("m", "user-1"),
      () => meetings.deleteAttendee("m", "a"),
      () => meetings.deleteMeeting("m"),
    ]) {
      const error = await call().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(MeetingsError);
      expect((error as MeetingsError).cause).toBeInstanceOf(ThrottlingException);
    }
  });

  it("fails on the server when a response lacks what the browser needs", async () => {
    const withoutSignaling = {
      ...MEETING,
      MediaPlacement: { ...MEETING.MediaPlacement, SignalingUrl: undefined },
    };
    const meeting = setup(() => ({ Meeting: withoutSignaling })).meetings;
    await expect(
      meeting.createMeeting({ externalMeetingId: "r", token: "t-1" }),
    ).rejects.toBeInstanceOf(MeetingsError);

    const attendee = setup(() => ({ Attendee: { ...ATTENDEE, JoinToken: undefined } })).meetings;
    await expect(attendee.createAttendee("m", "user-1")).rejects.toBeInstanceOf(MeetingsError);
  });
});
