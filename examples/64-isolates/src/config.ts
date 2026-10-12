import {
  type ContainersConfig,
  parseContainersConfig,
} from "@aih/example-12-containers/src/config.ts";

export const REGION = "ap-northeast-1";
export const ISOLATES_STACK = "AihIsolates";

// #region config
/**
 * The same three settings as chapter 12's stack, read the same way: `imageTag` (absent: the
 * repository alone), `taskSubnets`, and `allowedOrigin`.
 */
export type IsolatesConfig = ContainersConfig;
export const parseIsolatesConfig: (input: unknown) => IsolatesConfig = parseContainersConfig;

/** One task is one workerd process. A second one is a second copy of every worker's memory. */
export const SERVICE = { desiredCount: 1 } as const;
// #endregion config
