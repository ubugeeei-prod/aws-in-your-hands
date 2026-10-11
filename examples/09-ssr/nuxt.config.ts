// Types only: these make `nitro` and `vize` below the pinned packages' own option types.
import type {} from "@nuxt/nitro-server";
import type {} from "@vizejs/nuxt";
import { defineNuxtConfig } from "nuxt/config";
import { buildEnvSchema } from "./core/env.ts";

const streaming = buildEnvSchema.parse(process.env).AIH_SSR_STREAMING === "true";

// #region config
export default defineNuxtConfig({
  compatibilityDate: "2026-10-01",
  telemetry: false,
  devtools: { enabled: false },
  // Vize compiles the .vue files. Linting runs as its own task.
  modules: ["@vizejs/nuxt"],
  vize: { lint: false },
  nitro: {
    // Ignored by `nuxt dev`. `nuxt build` writes a Lambda handler to .output/server/index.mjs.
    preset: "aws-lambda",
    // false: a handler that returns the whole response. true: one that writes to a stream.
    awsLambda: { streaming },
  },
});
// #endregion config
