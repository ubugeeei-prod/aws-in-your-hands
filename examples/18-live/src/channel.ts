// #region settings
// BASIC passes the encoder's video through as one rendition: the cheapest input
// hour, and no lower quality for a slow viewer to fall back to.
export const channelSettings = {
  name: "aih-live",
  type: "BASIC",
  latencyMode: "LOW",
} as const;
// #endregion settings

// #region limits
export type ChannelType = "BASIC" | "STANDARD" | "ADVANCED_SD" | "ADVANCED_HD";

export type EncoderSettings = { width: number; height: number; videoKbps: number; keyframeSeconds: number };

// Total pixels and the longer edge of 1080p: the ingest limit of every channel type.
const maxPixels = 1920 * 1080;
const maxEdge = 1920;

/** Above 480p a BASIC channel takes 3.5 Mbps, at 480p or below 1.5 Mbps. */
export function maxVideoKbps(type: ChannelType, settings: Pick<EncoderSettings, "width" | "height">): number {
  if (type !== "BASIC") {
    return 8500;
  }
  return Math.min(settings.width, settings.height) > 480 ? 3500 : 1500;
}

/** Reasons IVS would drop or degrade this input. Empty when the settings fit. */
export function encoderProblems(type: ChannelType, settings: EncoderSettings): string[] {
  const problems: string[] = [];
  if (settings.width * settings.height > maxPixels || Math.max(settings.width, settings.height) > maxEdge) {
    problems.push(`${settings.width}x${settings.height} is larger than 1080p, the ingest limit`);
  }
  const limit = maxVideoKbps(type, settings);
  if (settings.videoKbps > limit) {
    problems.push(`${settings.videoKbps} kbps is over the ${limit} kbps a ${type} channel accepts at this size`);
  }
  if (settings.keyframeSeconds > 5) {
    problems.push(`a ${settings.keyframeSeconds} s keyframe interval is over 5 s; IVS recommends 2 s`);
  }
  return problems;
}
// #endregion limits

// #region ingest
/** What an RTMPS encoder needs. The stream key is appended by the encoder, never here. */
export function rtmpsServer(ingestEndpoint: string): string {
  return `rtmps://${ingestEndpoint}:443/app/`;
}
// #endregion ingest
