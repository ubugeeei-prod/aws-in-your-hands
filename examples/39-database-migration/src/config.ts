import * as v from "valibot";

export const MIGRATION_STACK = "AihDatabaseMigration";
export const REGION = "ap-northeast-1";

// #region config
const host = v.pipe(v.string(), v.regex(/^[a-z0-9.-]+$/, "a host name"));
const securityGroupId = v.pipe(v.string(), v.regex(/^sg-[0-9a-f]{8,17}$/, "a security group ID"));
const databaseName = v.pipe(v.string(), v.regex(/^[A-Za-z_][A-Za-z0-9_]*$/));
// The capacities AWS DMS Serverless offers, up to what a small database could want.
const capacity = v.picklist([1, 2, 4, 8, 16]);

const database = (side: "source" | "target") =>
  v.object({
    // `.invalid` never resolves: a deploy with nothing filled in fails at once.
    host: v.optional(host, `${side}.database.invalid`),
    securityGroupId: v.optional(securityGroupId, "sg-00000000"),
    databaseName: v.optional(databaseName, "postgres"),
  });

const configSchema = v.pipe(
  v.object({
    source: database("source"),
    target: database("target"),
    minCapacityUnits: v.optional(capacity, 1),
    maxCapacityUnits: v.optional(capacity, 2),
    /** `existing`: the account already has dms-vpc-role and dms-cloudwatch-logs-role. */
    accountRoles: v.optional(v.picklist(["create", "existing"]), "create"),
  }),
  v.check(
    (config) => config.minCapacityUnits <= config.maxCapacityUnits,
    "minCapacityUnits must not exceed maxCapacityUnits",
  ),
);

export type MigrationConfig = v.InferOutput<typeof configSchema>;

/** CDK context arrives as strings (`-c maxCapacityUnits=4`); numbers are read from them here. */
export function parseMigrationConfig(context: Record<string, unknown>): MigrationConfig {
  const number = (value: unknown): unknown =>
    typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : value;
  const side = (name: "source" | "target") => ({
    host: context[`${name}Host`],
    securityGroupId: context[`${name}SecurityGroupId`],
    databaseName: context[`${name}Database`],
  });
  return v.parse(configSchema, {
    source: side("source"),
    target: side("target"),
    minCapacityUnits: number(context["minCapacityUnits"]),
    maxCapacityUnits: number(context["maxCapacityUnits"]),
    accountRoles: context["accountRoles"],
  });
}
// #endregion config
