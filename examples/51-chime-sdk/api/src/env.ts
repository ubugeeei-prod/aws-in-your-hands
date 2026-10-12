import * as v from "valibot";

// The media Regions the CreateMeeting reference lists for the commercial partition (read 2026-10-13).
export const MEDIA_REGIONS = [
  "af-south-1",
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-south-1",
  "ap-southeast-1",
  "ap-southeast-2",
  "ca-central-1",
  "eu-central-1",
  "eu-north-1",
  "eu-south-1",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "sa-east-1",
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
] as const;
export type MediaRegion = (typeof MEDIA_REGIONS)[number];

// #region env
// Read next to chapter 05's variables (ALLOWED_ORIGIN, NOTES_STORE, TABLE_NAME, ...).
const meetingsEnvSchema = v.variant("MEETINGS", [
  // No Chime call is made: join tokens are made up and lead nowhere.
  v.object({ MEETINGS: v.literal("fake") }),
  v.object({
    MEETINGS: v.literal("chime"),
    /** Where the audio and video are hosted. The API itself is called in the function's Region. */
    MEDIA_REGION: v.picklist(MEDIA_REGIONS),
  }),
]);

export type MeetingsEnv = v.InferOutput<typeof meetingsEnvSchema>;

export function parseMeetingsEnv(source: Record<string, string | undefined>): MeetingsEnv {
  const result = v.safeParse(meetingsEnvSchema, source);
  if (!result.success) {
    const problems = result.issues.map((issue) => `${v.getDotPath(issue) ?? ""}: ${issue.message}`);
    throw new Error(`Invalid environment:\n  ${problems.join("\n  ")}`);
  }
  return result.output;
}
// #endregion env
