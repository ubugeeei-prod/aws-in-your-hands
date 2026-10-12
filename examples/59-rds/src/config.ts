import * as v from "valibot";

export const RDS_STACK = "AihRds";
export const REGION = "ap-northeast-1";
/** The database created inside the instance. `postgres` exists as well and stays empty. */
export const DATABASE_NAME = "notes";
export const POSTGRES_PORT = 5432;

// #region profiles
/** What separates an instance to practise on from one that holds data someone needs. */
export const PROFILES = {
  practice: {
    // One instance in one Availability Zone. A failure of either is an outage.
    multiAz: false,
    // The shortest retention that still allows point-in-time recovery and read replicas.
    backupRetentionDays: 1,
    deletionProtection: false,
    // Destroying the stack deletes the instance, its automated backups, and takes no final snapshot.
    survivesStack: false,
    // The volume never grows by itself. Storage that grew cannot be shrunk again.
    maxAllocatedStorageGiB: undefined,
  },
  production: {
    multiAz: true,
    backupRetentionDays: 14,
    deletionProtection: true,
    survivesStack: true,
    maxAllocatedStorageGiB: 100,
  },
} as const satisfies Record<string, ProfileSettings>;

export type ProfileSettings = {
  multiAz: boolean;
  backupRetentionDays: number;
  deletionProtection: boolean;
  survivesStack: boolean;
  maxAllocatedStorageGiB: number | undefined;
};
// #endregion profiles

// #region config
const configSchema = v.object({
  allowedOrigin: v.optional(
    v.pipe(v.string(), v.url(), v.regex(/^https?:\/\//)),
    "http://localhost:5173",
  ),
  profile: v.optional(v.picklist(["practice", "production"]), "practice"),
  // `18.3`. Amazon RDS stops offering old minor versions to new instances:
  // `aws rds describe-db-engine-versions --engine postgres` lists what it has today.
  postgresVersion: v.optional(v.pipe(v.string(), v.regex(/^1[4-9]\.\d{1,2}$/)), "18.3"),
  instanceClass: v.optional(
    v.pipe(v.string(), v.regex(/^[a-z][a-z0-9]+\.[a-z0-9]+$/)),
    "t4g.micro",
  ),
  // A second, billed instance. With it, RDS may not manage the master password.
  readReplica: v.optional(
    v.pipe(
      v.picklist(["true", "false"]),
      v.transform((text) => text === "true"),
    ),
    "false",
  ),
});

export type RdsConfig = v.InferOutput<typeof configSchema>;

/** CDK context arrives as strings: `-c profile=production -c readReplica=true`. */
export function parseRdsConfig(context: Record<string, unknown>): RdsConfig {
  return v.parse(configSchema, {
    allowedOrigin: context["allowedOrigin"],
    profile: context["profile"],
    postgresVersion: context["postgresVersion"],
    instanceClass: context["instanceClass"],
    readReplica: context["readReplica"],
  });
}
// #endregion config
