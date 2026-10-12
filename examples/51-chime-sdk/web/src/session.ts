import {
  ConsoleLogger,
  DefaultDeviceController,
  DefaultMeetingSession,
  LogLevel,
  MeetingSessionConfiguration,
  MeetingSessionStatusCode,
} from "amazon-chime-sdk-js";

import type { Seat } from "../../api/src/contract.ts";
import type { CallSignal } from "./call.ts";

export type Tile = { id: number; user: string; local: boolean };

export type Call = {
  /** Ends the media session. The seat is given back by the page, through the API. */
  stop(): void;
  setMuted(muted: boolean): void;
  setCamera(on: boolean): Promise<void>;
  bindVideo(tileId: number, element: HTMLVideoElement): void;
};

// #region start
// From here on the browser talks to Chime's media service directly. The API is not involved
// again until the user leaves. What it gets from `seat` is where to connect and the join token.
export async function startCall(
  seat: Seat,
  audio: HTMLAudioElement,
  on: {
    signal(signal: CallSignal): void;
    presence(user: string, present: boolean): void;
    tile(tile: Tile): void;
    tileRemoved(tileId: number): void;
  },
): Promise<Call> {
  const logger = new ConsoleLogger("call", LogLevel.WARN);
  const devices = new DefaultDeviceController(logger);
  const session = new DefaultMeetingSession(
    new MeetingSessionConfiguration(seat.meeting, seat.attendee),
    logger,
    devices,
  );
  const av = session.audioVideo;

  av.addObserver({
    audioVideoDidStartConnecting: (reconnecting) => on.signal({ kind: "connecting", reconnecting }),
    audioVideoDidStart: () => on.signal({ kind: "started" }),
    audioVideoDidStop: (status) => {
      on.signal({ kind: "stopped", code: MeetingSessionStatusCode[status.statusCode()] });
      // Lets go of the microphone and the camera.
      void devices.destroy();
    },
    videoTileDidUpdate: (tile) => {
      if (tile.tileId !== null && tile.boundAttendeeId !== null && !tile.isContent) {
        // The external user ID is the `sub` the server created the attendee with.
        on.tile({ id: tile.tileId, user: tile.boundExternalUserId ?? "", local: tile.localTile });
      }
    },
    videoTileWasRemoved: (tileId) => on.tileRemoved(tileId),
  });
  av.realtimeSubscribeToAttendeeIdPresence((attendeeId, present, externalUserId) =>
    on.presence(externalUserId ?? attendeeId, present),
  );

  // The browser asks for the microphone here. The camera stays off until the user turns it on.
  const [microphone] = await av.listAudioInputDevices();
  if (microphone !== undefined) {
    await av.startAudioInput(microphone.deviceId);
  }
  await av.bindAudioElement(audio);
  av.start();

  return {
    stop: () => av.stop(),
    setMuted(muted) {
      if (muted) {
        av.realtimeMuteLocalAudio();
      } else {
        av.realtimeUnmuteLocalAudio();
      }
    },
    async setCamera(turnOn) {
      if (!turnOn) {
        av.stopLocalVideoTile();
        await av.stopVideoInput();
        return;
      }
      const [camera] = await av.listVideoInputDevices();
      if (camera !== undefined) {
        await av.startVideoInput(camera.deviceId);
        av.startLocalVideoTile();
      }
    },
    bindVideo: (tileId, element) => av.bindVideoElement(tileId, element),
  };
}
// #endregion start
