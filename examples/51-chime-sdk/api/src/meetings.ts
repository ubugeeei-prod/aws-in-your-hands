import type { Attendee, Meeting } from "./contract.ts";

// #region gateway
// The five Chime calls this app makes, as the app needs them. A meeting that has ended
// and one that never existed look the same from here, and both are ordinary answers.
export type MeetingsGateway = {
  /** `token` is Chime's ClientRequestToken: a retry of the same request must send the same one. */
  createMeeting(input: { externalMeetingId: string; token: string }): Promise<Meeting>;
  getMeeting(meetingId: string): Promise<Meeting | undefined>;
  createAttendee(meetingId: string, externalUserId: string): Promise<Attendee | "meeting_gone">;
  /** Ends the attendee and its join token. Deleting what is already gone succeeds. */
  deleteAttendee(meetingId: string, attendeeId: string): Promise<void>;
  /** Ends the meeting, every attendee in it, and every connection. Already gone succeeds. */
  deleteMeeting(meetingId: string): Promise<void>;
};

/** Chime refused, throttled, or could not be reached. The caller hands out nothing. */
export class MeetingsError extends Error {
  constructor(operation: string, cause: unknown) {
    super(`Chime ${operation} failed`, { cause });
    this.name = "MeetingsError";
  }
}
// #endregion gateway
