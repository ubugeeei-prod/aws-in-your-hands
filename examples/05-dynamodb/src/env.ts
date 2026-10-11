import { z } from "zod";

// #region env
// `z.url()` alone accepts "localhost:8000" (it parses as a URL whose scheme
// is "localhost"), so the scheme is spelled out.
const httpUrl = z.url({ protocol: /^https?$/ });

const base = z.object({
  ALLOWED_ORIGIN: httpUrl,
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  STAGE: z.string().min(1).default("local"),
});

// Required variables depend on the store, so a missing TABLE_NAME fails at startup.
const envSchema = z.discriminatedUnion("NOTES_STORE", [
  base.extend({ NOTES_STORE: z.literal("memory") }),
  base.extend({
    NOTES_STORE: z.literal("dynamodb"),
    TABLE_NAME: z.string().min(3),
    // DynamoDB Local only. In AWS the SDK finds the regional endpoint itself.
    DYNAMODB_ENDPOINT: httpUrl.optional(),
  }),
]);

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid environment:\n  ${problems.join("\n  ")}`);
  }
  return result.data;
}
// #endregion env
