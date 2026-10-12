import * as v from "valibot";

// #region env
const envSchema = v.object({
  STAGE: v.optional(v.pipe(v.string(), v.minLength(1)), "local"),
  // "dev" turns on the practice sign-in, which trusts whatever name is typed.
  AIH_SSR_SIGN_IN: v.optional(v.picklist(["dev", "off"]), "off"),
  // Lambda sets this in every execution environment.
  AWS_LAMBDA_FUNCTION_NAME: v.optional(v.string()),
});

export type Env = { stage: string; signIn: "dev" | "off" };

export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = v.safeParse(envSchema, source);
  if (!parsed.success) {
    const problems = parsed.issues.map((issue) => `${v.getDotPath(issue) ?? ""}: ${issue.message}`);
    throw new Error(`Invalid environment:\n  ${problems.join("\n  ")}`);
  }
  const env = parsed.output;
  if (env.AIH_SSR_SIGN_IN === "dev" && env.AWS_LAMBDA_FUNCTION_NAME !== undefined) {
    // Sessions live in memory here; chapter 04 showed why that cannot work on Lambda.
    throw new Error(
      "Invalid environment: AIH_SSR_SIGN_IN=dev is for local development and must not run on Lambda",
    );
  }
  return { stage: env.STAGE, signIn: env.AIH_SSR_SIGN_IN };
}
// #endregion env

export const buildEnvSchema = v.object({
  // Read by nuxt.config.ts. Selects which of Nitro's two Lambda entries is built.
  AIH_SSR_STREAMING: v.optional(v.picklist(["true", "false"]), "false"),
});
