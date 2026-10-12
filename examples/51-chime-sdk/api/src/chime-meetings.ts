import {
  type ChimeSDKMeetingsClient,
  CreateAttendeeCommand,
  CreateMeetingCommand,
  DeleteAttendeeCommand,
  DeleteMeetingCommand,
  GetMeetingCommand,
  NotFoundException,
} from "@aws-sdk/client-chime-sdk-meetings";
import * as v from "valibot";

import { attendeeSchema, meetingSchema } from "./contract.ts";
import { type MeetingsGateway, MeetingsError } from "./meetings.ts";

// #region chime
/** `mediaRegion` is where the audio and video go. The client's own Region is where the API is called. */
export function createChimeMeetings(
  client: Pick<ChimeSDKMeetingsClient, "send">,
  mediaRegion: string,
): MeetingsGateway {
  // NotFoundException becomes `missing`. Anything else is a failure the caller must not paper over.
  const attempt = async <T, Missing>(
    operation: string,
    missing: Missing,
    run: () => Promise<T>,
  ): Promise<T | Missing> => {
    try {
      return await run();
    } catch (error) {
      if (error instanceof NotFoundException) {
        return missing;
      }
      throw new MeetingsError(operation, error);
    }
  };

  return {
    async createMeeting({ externalMeetingId, token }) {
      try {
        const response = await client.send(
          new CreateMeetingCommand({
            ClientRequestToken: token,
            ExternalMeetingId: externalMeetingId,
            MediaRegion: mediaRegion,
          }),
        );
        // Checked here, so a field the browser needs is missed on the server, not in a call.
        return v.parse(meetingSchema, response.Meeting);
      } catch (error) {
        throw new MeetingsError("CreateMeeting", error);
      }
    },
    getMeeting: (meetingId) =>
      attempt("GetMeeting", undefined, async () => {
        const response = await client.send(new GetMeetingCommand({ MeetingId: meetingId }));
        return v.parse(meetingSchema, response.Meeting);
      }),
    createAttendee: (meetingId, externalUserId) =>
      attempt("CreateAttendee", "meeting_gone" as const, async () => {
        const response = await client.send(
          new CreateAttendeeCommand({ MeetingId: meetingId, ExternalUserId: externalUserId }),
        );
        return v.parse(attendeeSchema, response.Attendee);
      }),
    deleteAttendee: (meetingId, attendeeId) =>
      attempt("DeleteAttendee", undefined, async () => {
        await client.send(
          new DeleteAttendeeCommand({ MeetingId: meetingId, AttendeeId: attendeeId }),
        );
      }),
    deleteMeeting: (meetingId) =>
      attempt("DeleteMeeting", undefined, async () => {
        await client.send(new DeleteMeetingCommand({ MeetingId: meetingId }));
      }),
  };
}
// #endregion chime
