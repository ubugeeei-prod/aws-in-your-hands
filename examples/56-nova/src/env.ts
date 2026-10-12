import * as v from "valibot";

import { explainUnknown, resolveRoute, routesFor } from "./catalog.ts";

/** What describing an image asks of a model. */
export const DESCRIBE_NEED = { input: ["image", "text"], output: "text", api: "Converse" } as const;

// #region env
const wholeNumber = (min: number, max: number) =>
  v.pipe(
    v.string(),
    v.transform(Number),
    v.number(),
    v.integer(),
    v.minValue(min),
    v.maxValue(max),
  );

const envSchema = v.pipe(
  v.object({
    // No default: whether a request costs money is chosen, never assumed.
    NOVA_BACKEND: v.picklist(["scripted", "bedrock"]),
    // A retired or mistyped ID stops the process when it starts, not at the first request.
    DESCRIBE_MODEL_ID: v.pipe(
      v.string(),
      v.check(
        (id) => routesFor(DESCRIBE_NEED).some(({ route }) => route.id === id),
        ({ input }) =>
          resolveRoute(input) === undefined
            ? explainUnknown(input)
            : `${input} does not take an image and answer with text through Converse`,
      ),
    ),
    MEDIA_BUCKET: v.optional(v.pipe(v.string(), v.minLength(3))),
    /** The account that owns the bucket. Converse wants it when the caller is another account. */
    MEDIA_BUCKET_OWNER: v.optional(v.pipe(v.string(), v.regex(/^\d{12}$/))),
    // Lambda sets this itself.
    AWS_REGION: v.optional(v.pipe(v.string(), v.minLength(1)), "ap-northeast-1"),
    MAX_OUTPUT_TOKENS: v.optional(wholeNumber(1, 1000), "300"),
    INFERENCE_TIMEOUT_MS: v.optional(wholeNumber(1000, 60_000), "30000"),
    LEASE_SECONDS: v.optional(wholeNumber(1, 900), "60"),
    DESCRIPTION_LANGUAGE: v.optional(v.picklist(["ja", "en"]), "ja"),
    LOG_LEVEL: v.optional(v.picklist(["debug", "info", "warn", "error"]), "info"),
    STAGE: v.optional(v.pipe(v.string(), v.minLength(1)), "local"),
  }),
  // A claim that expires while its own call may still be running lets a second call start.
  v.check(
    (env) => env.LEASE_SECONDS * 1000 > env.INFERENCE_TIMEOUT_MS,
    "LEASE_SECONDS must be longer than INFERENCE_TIMEOUT_MS",
  ),
  v.check(
    (env) => env.NOVA_BACKEND !== "bedrock" || env.MEDIA_BUCKET !== undefined,
    "MEDIA_BUCKET is required with NOVA_BACKEND=bedrock",
  ),
);

export type Env = v.InferOutput<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = v.safeParse(envSchema, source);
  if (!result.success) {
    const problems = result.issues.map((issue) => `${v.getDotPath(issue) ?? ""}: ${issue.message}`);
    throw new Error(`Invalid environment:\n  ${problems.join("\n  ")}`);
  }
  return result.output;
}
// #endregion env
