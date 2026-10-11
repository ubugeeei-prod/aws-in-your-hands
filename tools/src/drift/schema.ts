import { z } from "zod";

// StackDriftJson in src/cli/commands/drift.ts of @go-to-k/cdkd 0.296.28.
// The published docs omit `skipped`; the source always emits it.

const resourceRef = z.object({ logicalId: z.string(), type: z.string() });

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

export const stackDriftSchema = z.object({
  stack: z.string(),
  region: z.string(),
  drifted: z.array(
    resourceRef.extend({
      changes: z.array(z.object({ path: z.string(), stateValue: z.unknown(), awsValue: z.unknown() })),
      referencesUnresolved: z.boolean(),
    }),
  ),
  clean: z.array(resourceRef),
  deleted: z.array(resourceRef),
  notSupported: z.array(resourceRef),
  skipped: z.array(resourceRef),
  notCompared: z.array(resourceRef.extend({ cause: z.enum(notComparedCauses) })),
  warnings: z.array(z.string()).optional(),
});

export const driftOutputSchema = z.array(stackDriftSchema);

export type StackDrift = z.infer<typeof stackDriftSchema>;
