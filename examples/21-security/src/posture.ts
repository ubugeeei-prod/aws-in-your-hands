import { z } from "zod";

// #region snapshot
/** "Could not read" is its own answer. It must never be shown as "off", and never as "on". */
const probe = <T extends z.ZodType>(value: T) =>
  z.discriminatedUnion("read", [
    z.object({ read: z.literal(true), value }),
    z.object({ read: z.literal(false), reason: z.string() }),
  ]);

export const snapshotSchema = z.object({
  root: probe(z.object({ mfaEnabled: z.boolean(), accessKeysPresent: z.boolean() })),
  trails: probe(
    z.array(z.object({ name: z.string(), multiRegion: z.boolean(), logging: z.boolean() })),
  ),
  guardDuty: probe(z.array(z.object({ id: z.string(), status: z.string() }))),
  inspector: probe(z.object({ lambda: z.string(), ecr: z.string(), ec2: z.string() })),
  config: probe(z.array(z.object({ name: z.string(), recording: z.boolean() }))),
  organization: probe(z.object({ member: z.boolean(), allFeatures: z.boolean() })),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
// #endregion snapshot

/** When a control starts to earn its cost. */
export type Tier = "everyone" | "with-data" | "organization";
export type State = "on" | "off" | "unknown";
export type Item = { id: string; tier: Tier; state: State; charge: string; note: string };

type Probed<T> = { read: true; value: T } | { read: false; reason: string };

function item<T>(
  id: string,
  tier: Tier,
  charge: string,
  probed: Probed<T>,
  judge: (value: T) => { on: boolean; note: string },
): Item {
  if (!probed.read) {
    return { id, tier, charge, state: "unknown", note: `could not read: ${probed.reason}` };
  }
  const verdict = judge(probed.value);
  return { id, tier, charge, state: verdict.on ? "on" : "off", note: verdict.note };
}

// #region assess
export function assess(snapshot: Snapshot): Item[] {
  return [
    item("root-mfa", "everyone", "free", snapshot.root, (root) => ({
      on: root.mfaEnabled,
      note: root.mfaEnabled
        ? "the root user has MFA"
        : "the root user signs in with a password alone",
    })),
    item("root-access-keys", "everyone", "free", snapshot.root, (root) => ({
      on: !root.accessKeysPresent,
      note: root.accessKeysPresent
        ? "the root user has access keys; delete them"
        : "the root user has no access keys",
    })),
    {
      id: "cloudtrail-event-history",
      tier: "everyone",
      state: "on",
      charge: "free",
      note: "always on: 90 days of management events, per Region, nothing to configure",
    },
    item(
      "guardduty",
      "with-data",
      "per event and per GB analyzed, after a 30-day trial",
      snapshot.guardDuty,
      (detectors) => {
        const enabled = detectors.filter((detector) => detector.status === "ENABLED");
        return {
          on: enabled.length > 0,
          note:
            enabled.length > 0
              ? "a detector is enabled in this Region"
              : "no enabled detector in this Region",
        };
      },
    ),
    item(
      "inspector",
      "with-data",
      "per function, image, and instance scanned",
      snapshot.inspector,
      (inspector) => {
        const scanning = Object.entries(inspector)
          .filter(([, status]) => status === "ENABLED")
          .map(([kind]) => kind);
        return {
          on: scanning.length > 0,
          note:
            scanning.length > 0
              ? `scanning: ${scanning.join(", ")}`
              : "no scan type is enabled in this Region",
        };
      },
    ),
    item(
      "cloudtrail-trail",
      "organization",
      "S3 storage; the first copy of management events is free",
      snapshot.trails,
      (trails) => {
        const kept = trails.filter((trail) => trail.multiRegion && trail.logging);
        return {
          on: kept.length > 0,
          note:
            kept.length > 0
              ? `multi-Region trail logging: ${kept.map((trail) => trail.name).join(", ")}`
              : "no multi-Region trail is logging; history ends after 90 days",
        };
      },
    ),
    item(
      "config-recorder",
      "organization",
      "per configuration item recorded",
      snapshot.config,
      (recorders) => ({
        on: recorders.some((recorder) => recorder.recording),
        note: recorders.some((recorder) => recorder.recording)
          ? "a configuration recorder is recording in this Region"
          : "no configuration recorder is recording in this Region",
      }),
    ),
    item("organization-scps", "organization", "free", snapshot.organization, (organization) => ({
      on: organization.member && organization.allFeatures,
      note: organization.member
        ? organization.allFeatures
          ? "in an organization with all features, so SCPs can be attached"
          : "in an organization with consolidated billing only; SCPs need all features"
        : "a standalone account: no organization, so no SCPs",
    })),
  ];
}
// #endregion assess

// #region gate
/** The first tier is not optional. Anything off or unreadable there fails the task. */
export function failing(items: Item[]): Item[] {
  return items.filter((entry) => entry.tier === "everyone" && entry.state !== "on");
}
// #endregion gate
