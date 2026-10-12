import * as v from "valibot";

import { errorCodes as notesErrorCodes } from "@aih/example-06-auth/api/src/contract.ts";

export const MAX_MEMBERS_PER_ROOM = 10;

// Chime's ExternalUserId takes 2 to 64 characters of a fixed set. A Cognito `sub` is a UUID
// and fits. Anything that would not fit is refused here, before it becomes a member.
export const subSchema = v.pipe(
  v.string(),
  v.regex(/^[-_.:@+=a-zA-Z0-9]{2,64}$/),
  // Chime reserves this prefix.
  v.check((value) => !value.toLowerCase().startsWith("aws:"), "Must not begin with aws:"),
);

// #region room
/** What a member sees of a room. Who is seated, never an attendee ID or a join token. */
export const roomSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  owner: subSchema,
  members: v.array(subSchema),
  seated: v.array(subSchema),
});
export type RoomView = v.InferOutput<typeof roomSchema>;
// #endregion room

// #region seat
// The two objects the browser library asks for, in the shape the Chime API returns them.
// Only the fields amazon-chime-sdk-js 3.32.0 reads are required.
const mediaUrl = v.pipe(v.string(), v.url());

export const meetingSchema = v.object({
  MeetingId: v.pipe(v.string(), v.minLength(1)),
  MediaRegion: v.pipe(v.string(), v.minLength(1)),
  MediaPlacement: v.object({
    AudioHostUrl: v.pipe(v.string(), v.minLength(1)),
    SignalingUrl: mediaUrl,
    TurnControlUrl: mediaUrl,
    EventIngestionUrl: v.optional(mediaUrl),
  }),
});
export type Meeting = v.InferOutput<typeof meetingSchema>;

export const attendeeSchema = v.object({
  AttendeeId: v.pipe(v.string(), v.minLength(1)),
  ExternalUserId: subSchema,
  /** A bearer secret: whoever presents it to the media service is this attendee. */
  JoinToken: v.pipe(v.string(), v.minLength(2)),
});
export type Attendee = v.InferOutput<typeof attendeeSchema>;

export const seatSchema = v.object({ meeting: meetingSchema, attendee: attendeeSchema });
export type Seat = v.InferOutput<typeof seatSchema>;
// #endregion seat

// #region error
export const errorCodes = [
  ...notesErrorCodes,
  // A member asked for something only the room's owner may do.
  "forbidden",
  // The room is full, or the same user is joining from two places at once.
  "room_full",
  "join_in_progress",
  // Chime refused or could not be reached. Nothing was handed out.
  "media_unavailable",
] as const;

export const errorSchema = v.object({
  error: v.object({
    code: v.picklist(errorCodes),
    message: v.string(),
    requestId: v.string(),
  }),
});
export type ErrorBody = v.InferOutput<typeof errorSchema>;
// #endregion error
