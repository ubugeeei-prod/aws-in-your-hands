import * as v from "valibot";

export const REGION = "ap-northeast-1";
export const CONTAINERS_STACK = "AihContainers";

// #region size
/** One task. 1024 CPU units are one vCPU, so this is a quarter of one. */
export const TASK = { cpuUnits: 256, memoryMiB: 512, containerPort: 8080 } as const;

/** How many tasks the service keeps, and how far auto scaling may go. The upper bound is also a bound on the bill. */
export const SERVICE = { desiredCount: 2, maxCount: 4, targetCpuPercent: 60 } as const;

/** Connections one task holds at once. Each may carry a 64 KiB body, so this bounds memory in flight. */
export const MAX_CONNECTIONS = 512;
// #endregion size

// #region schema
/** Where the tasks live. "public" needs nothing from chapter 11 beyond its default layout. */
export const TASK_SUBNETS = ["public", "private"] as const;
export type TaskSubnets = (typeof TASK_SUBNETS)[number];

export const containersConfigSchema = v.object({
  // Absent: the stack is only the repository. Present: the service runs this image.
  imageTag: v.optional(
    v.pipe(
      v.string(),
      v.regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/, "use letters, digits, '_', '.', and '-'"),
      // "latest" says nothing about what is running, and the repository refuses to move a tag anyway.
      v.check((tag) => tag !== "latest", "name the build, for example a git commit hash"),
    ),
  ),
  taskSubnets: v.optional(v.picklist(TASK_SUBNETS), "public"),
  allowedOrigin: v.optional(
    v.pipe(v.string(), v.url(), v.regex(/^https?:\/\//, "Must be an http or https URL.")),
    "http://localhost:5173",
  ),
});

export type ContainersConfig = v.InferOutput<typeof containersConfigSchema>;

/** Parses CDK context (`-c imageTag=...`); the message names every bad field. */
export function parseContainersConfig(input: unknown): ContainersConfig {
  const result = v.safeParse(containersConfigSchema, input);
  if (!result.success) {
    const problems = result.issues.map(
      (item) => `  ${v.getDotPath(item) ?? "(root)"}: ${item.message}`,
    );
    throw new Error(`Invalid container settings:\n${problems.join("\n")}`);
  }
  return result.output;
}
// #endregion schema
