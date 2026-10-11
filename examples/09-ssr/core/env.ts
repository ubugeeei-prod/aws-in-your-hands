import { z } from "zod";

// #region env
const envSchema = z.object({
  STAGE: z.string().min(1).default("local"),
  // "dev" turns on the practice sign-in, which trusts whatever name is typed.
  AIH_SSR_SIGN_IN: z.enum(["dev", "off"]).default("off"),
  // Lambda sets this in every execution environment.
  AWS_LAMBDA_FUNCTION_NAME: z.string().optional(),
});

export type Env = { stage: string; signIn: "dev" | "off" };

export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${z.prettifyError(parsed.error)}`);
  }
  if (parsed.data.AIH_SSR_SIGN_IN === "dev" && parsed.data.AWS_LAMBDA_FUNCTION_NAME !== undefined) {
    // Sessions live in memory here; chapter 04 showed why that cannot work on Lambda.
    throw new Error("Invalid environment: AIH_SSR_SIGN_IN=dev is for local development and must not run on Lambda");
  }
  return { stage: parsed.data.STAGE, signIn: parsed.data.AIH_SSR_SIGN_IN };
}
// #endregion env

export const buildEnvSchema = z.object({
  // Read by nuxt.config.ts. Selects which of Nitro's two Lambda entries is built.
  AIH_SSR_STREAMING: z.enum(["true", "false"]).default("false"),
});
