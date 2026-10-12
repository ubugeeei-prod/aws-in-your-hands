import { TASK } from "@aih/example-12-containers/src/config.ts";

import { type Deployment, parseDeployment } from "./definition.ts";
import { WORKERD } from "./release.ts";

/** The bundle each entry point becomes. scripts/bundle.ts writes them; the configuration embeds them. */
export const BUNDLES = {
  notes: { entry: "src/entry.ts", module: "notes.mjs" },
  scoped: { entry: "src/entry-scoped.ts", module: "scoped.mjs" },
  spin: { entry: "src/spin.ts", module: "spin.mjs" },
} as const;

// #region image
/**
 * What the container runs. The values that differ between environments come from the task
 * definition's environment, so one image serves every stage.
 */
export const imageDeployment: Deployment = parseDeployment({
  workers: [
    {
      name: "notes",
      module: BUNDLES.notes.module,
      compatibilityDate: WORKERD.compatibilityDate,
      bindings: [
        { from: "environment", name: "ALLOWED_ORIGIN", variable: "ALLOWED_ORIGIN" },
        { from: "environment", name: "LOG_LEVEL", variable: "LOG_LEVEL" },
        { from: "environment", name: "STAGE", variable: "STAGE" },
      ],
    },
  ],
  sockets: [
    {
      name: "http",
      address: `*:${TASK.containerPort}`,
      service: "notes",
      // The load balancer says which scheme the caller used.
      forwardedProtoHeader: "x-forwarded-proto",
    },
  ],
});
// #endregion image

// #region local
/** The same worker on this machine, with its settings written into the configuration. */
export const localDeployment = (port: number): Deployment =>
  parseDeployment({
    workers: [
      {
        name: "notes",
        module: BUNDLES.notes.module,
        compatibilityDate: WORKERD.compatibilityDate,
        bindings: [
          { from: "text", name: "ALLOWED_ORIGIN", value: "http://localhost:5173" },
          { from: "text", name: "STAGE", value: "local" },
        ],
      },
    ],
    sockets: [{ name: "http", address: `127.0.0.1:${port}`, service: "notes" }],
  });
// #endregion local
