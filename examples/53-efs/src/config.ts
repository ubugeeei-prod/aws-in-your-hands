import * as v from "valibot";

export const REGION = "ap-northeast-1";
export const EFS_STACK = "AihEfs";

// #region mount
/** Lambda accepts a local mount path only under /mnt/. */
export const MOUNT_PATH = "/mnt/notes";

/** What the access point shows as "/": one directory of the file system, owned by one POSIX identity. */
export const ACCESS_POINT = {
  path: "/notes-app",
  uid: "1001",
  gid: "1001",
  // The owner may enter, list, and write. Nobody else may do anything.
  permissions: "750",
} as const;

export const NFS_PORT = 2049;
// #endregion mount

// #region schema
/** What happens to the file system, and the notes in it, when the stack is destroyed. */
export const DATA_ON_DESTROY = ["delete", "retain"] as const;

// `-c backup=true` arrives as a string; cdk.json may hold a boolean.
const flag = v.pipe(
  v.union([v.boolean(), v.picklist(["true", "false"])]),
  v.transform((value) => value === true || value === "true"),
);

export const efsConfigSchema = v.object({
  dataOnDestroy: v.optional(v.picklist(DATA_ON_DESTROY), "delete"),
  // Off for practice: recovery points are billed and stay in the vault after the stack is gone.
  backup: v.optional(flag, false),
  allowedOrigin: v.optional(
    v.pipe(v.string(), v.url(), v.regex(/^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/)),
    "http://localhost:5173",
  ),
});

export type EfsConfig = v.InferOutput<typeof efsConfigSchema>;
// #endregion schema

/** Parses settings from CDK context; the message names every bad field. */
export function parseEfsConfig(input: unknown): EfsConfig {
  const result = v.safeParse(efsConfigSchema, input);
  if (!result.success) {
    const problems = result.issues.map(
      (item) => `  ${v.getDotPath(item) ?? "(root)"}: ${item.message}`,
    );
    throw new Error(`Invalid EFS settings:\n${problems.join("\n")}`);
  }
  return result.output;
}
