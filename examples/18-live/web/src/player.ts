import { create, isPlayerSupported, PlayerEventType, PlayerState } from "amazon-ivs-player";
// The player runs in a web worker backed by WebAssembly. Vite copies both
// files into the build and hands back their URLs.
import wasmWorker from "amazon-ivs-player/dist/assets/amazon-ivs-wasmworker.min.js?url";
import wasmBinary from "amazon-ivs-player/dist/assets/amazon-ivs-wasmworker.min.wasm?url";

import type { PlayerSignal } from "./viewer.ts";

export type Playback = {
  /** Asks for the stream again, for example after it was offline. */
  reload(): void;
  play(): void;
  setMuted(muted: boolean): void;
  /** Seconds this viewer is behind the IVS server, and whether low-latency mode is on. */
  latency(): { seconds: number; lowLatency: boolean };
  stop(): void;
};

export const playerSupported: boolean = isPlayerSupported;

// #region start
export function startPlayback(
  video: HTMLVideoElement,
  playbackUrl: string,
  on: { signal(signal: PlayerSignal): void; metadata(text: string): void },
): Playback {
  const player = create({ wasmWorker, wasmBinary });
  player.attachHTMLVideoElement(video);

  const states = [
    [PlayerState.IDLE, "Idle"],
    [PlayerState.READY, "Ready"],
    [PlayerState.BUFFERING, "Buffering"],
    [PlayerState.PLAYING, "Playing"],
    [PlayerState.ENDED, "Ended"],
  ] as const;
  for (const [event, state] of states) {
    player.addEventListener(event, () => on.signal({ kind: "state", state }));
  }
  player.addEventListener(PlayerEventType.ERROR, (error) =>
    on.signal({ kind: "error", type: error.type, code: error.code, message: error.message }),
  );
  // Timed metadata arrives with the video frames it was attached to.
  player.addEventListener(PlayerEventType.TEXT_METADATA_CUE, (cue) => on.metadata(cue.text));

  // Muted, so that the browser's autoplay policy lets playback start.
  player.setMuted(true);
  player.setAutoplay(true);
  player.load(playbackUrl);

  return {
    reload: () => player.load(playbackUrl),
    play: () => player.play(),
    setMuted: (muted) => player.setMuted(muted),
    latency: () => ({ seconds: player.getLiveLatency(), lowLatency: player.isLiveLowLatency() }),
    stop: () => player.delete(),
  };
}
// #endregion start
