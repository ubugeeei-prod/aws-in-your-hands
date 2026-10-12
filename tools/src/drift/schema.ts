import * as v from "valibot";

// StackDriftJson in src/cli/commands/drift.ts of @go-to-k/cdkd 0.296.28.
// The published docs omit `skipped`; the source always emits it.

const resourceRef = v.object({ logicalId: v.string(), type: v.string() });

export const notComparedCauses = [
  "refused",
  "unresolvedToken",
  "readFailed",
  "readAborted",
  "baselineRefused",
  "uncertifiedBaseline",
  "noEchoParameter",
  "unreadableRecord",
  "unreadableMap",
] as const;

export const stackDriftSchema = v.object({
  stack: v.string(),
  region: v.string(),
  drifted: v.array(
    v.object({
      ...resourceRef.entries,
      changes: v.array(
        v.object({ path: v.string(), stateValue: v.unknown(), awsValue: v.unknown() }),
      ),
      referencesUnresolved: v.boolean(),
    }),
  ),
  clean: v.array(resourceRef),
  deleted: v.array(resourceRef),
  notSupported: v.array(resourceRef),
  skipped: v.array(resourceRef),
  notCompared: v.array(v.object({ ...resourceRef.entries, cause: v.picklist(notComparedCauses) })),
  warnings: v.optional(v.array(v.string())),
});

export const driftOutputSchema = v.array(stackDriftSchema);

export type StackDrift = v.InferOutput<typeof stackDriftSchema>;
