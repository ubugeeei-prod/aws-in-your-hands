import type { Attendee, Meeting } from "./contract.ts";
import type { MeetingsGateway } from "./meetings.ts";

// A model of the five calls, for the development server and the tests. It is not Chime.
// It holds only what the API reference states: a join token works until its attendee is
// deleted or its meeting ends, and deleting a meeting deletes its attendees.

// #region fake
export class FakeMeetings implements MeetingsGateway {
  readonly #meetings = new Map<string, Map<string, Attendee>>();
  readonly #newId: () => string;

  constructor(newId: () => string) {
    this.#newId = newId;
  }

  async createMeeting(): Promise<Meeting> {
    const meetingId = this.#newId();
    this.#meetings.set(meetingId, new Map());
    return this.#describe(meetingId);
  }

  async getMeeting(meetingId: string) {
    return this.#meetings.has(meetingId) ? this.#describe(meetingId) : undefined;
  }

  async createAttendee(meetingId: string, externalUserId: string) {
    const attendees = this.#meetings.get(meetingId);
    if (attendees === undefined) {
      return "meeting_gone" as const;
    }
    const attendee: Attendee = {
      AttendeeId: this.#newId(),
      ExternalUserId: externalUserId,
      JoinToken: `fake-join-token-${this.#newId()}`,
    };
    attendees.set(attendee.AttendeeId, attendee);
    return attendee;
  }

  async deleteAttendee(meetingId: string, attendeeId: string) {
    this.#meetings.get(meetingId)?.delete(attendeeId);
  }

  async deleteMeeting(meetingId: string) {
    this.#meetings.delete(meetingId);
  }

  /** What Chime does by itself: after five minutes with nobody connected, or after 24 hours. */
  end(meetingId: string): void {
    this.#meetings.delete(meetingId);
  }

  /** Who the media service would let in with this token: the attendee's user, or nobody. */
  admit(meetingId: string, joinToken: string): string | undefined {
    return [...(this.#meetings.get(meetingId)?.values() ?? [])].find(
      (attendee) => attendee.JoinToken === joinToken,
    )?.ExternalUserId;
  }

  meetingIds(): string[] {
    return [...this.#meetings.keys()];
  }

  attendeeCount(meetingId: string): number {
    return this.#meetings.get(meetingId)?.size ?? 0;
  }

  // The hosts are under .invalid, so a browser that tried to connect would fail at DNS.
  #describe(meetingId: string): Meeting {
    return {
      MeetingId: meetingId,
      MediaRegion: "local",
      MediaPlacement: {
        AudioHostUrl: "fake-media.invalid:3478",
        SignalingUrl: `wss://fake-media.invalid/control/${meetingId}`,
        TurnControlUrl: "https://fake-media.invalid/turn",
      },
    };
  }
}
// #endregion fake
