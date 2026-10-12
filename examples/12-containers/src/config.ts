import { z } from "zod";

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

export const containersConfigSchema = z.object({
  // Absent: the stack is only the repository. Present: the service runs this image.
  imageTag: z
    .string()
    .regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/, "use letters, digits, '_', '.', and '-'")
    // "latest" says nothing about what is running, and the repository refuses to move a tag anyway.
    .refine((tag) => tag !== "latest", "name the build, for example a git commit hash")
    .optional(),
  taskSubnets: z.enum(TASK_SUBNETS).default("public"),
  allowedOrigin: z.url({ protocol: /^https?$/ }).default("http://localhost:5173"),
});

export type ContainersConfig = z.infer<typeof containersConfigSchema>;

/** Parses CDK context (`-c imageTag=...`); the message names every bad field. */
export function parseContainersConfig(input: unknown): ContainersConfig {
  const result = containersConfigSchema.safeParse(input);
  if (!result.success) {
    const problems = result.error.issues.map(
      (item) => `  ${item.path.join(".") || "(root)"}: ${item.message}`,
    );
    throw new Error(`Invalid container settings:\n${problems.join("\n")}`);
  }
  return result.data;
}
// #endregion schema
