import * as v from "valibot";

import { jsonObject } from "@aih/example-21-security/src/json-object.ts";

import { at, isSetTo, ofType, setting, type Template } from "../template.ts";
import type { Problem } from "./rule.ts";

// #region bucket-public
const BLOCKS = [
  "BlockPublicAcls",
  "BlockPublicPolicy",
  "IgnorePublicAcls",
  "RestrictPublicBuckets",
] as const;
const PUBLIC_ACLS = ["PublicRead", "PublicReadWrite"];

// jsonObject, not v.looseObject: that one takes an array for an object and would hide every statement in it.
const statementsSchema = v.pipe(
  v.union([jsonObject, v.array(jsonObject)]),
  v.transform((value) => [value].flat()),
);

const isEveryone = (principal: unknown): boolean =>
  principal === "*" || [at(principal, "AWS")].flat().includes("*");

/** A bucket the template does not close, or a bucket policy that lets everyone in. */
export function bucketPublic(template: Template): Problem[] {
  const problems: Problem[] = [];
  for (const bucket of ofType(template, "AWS::S3::Bucket")) {
    const block = bucket.properties["PublicAccessBlockConfiguration"];
    if (block === undefined) {
      problems.push({
        resource: bucket.id,
        detail: "no PublicAccessBlockConfiguration: the template does not block public access",
      });
    } else {
      for (const key of BLOCKS.filter((name) => !isSetTo(at(block, name), true))) {
        problems.push({
          resource: bucket.id,
          detail: `PublicAccessBlockConfiguration.${key} is not true`,
        });
      }
    }
    const acl = setting(bucket.properties["AccessControl"]);
    if (typeof acl === "object" && PUBLIC_ACLS.includes(String(acl.value))) {
      problems.push({ resource: bucket.id, detail: `AccessControl is ${acl.value}` });
    }
  }
  for (const policy of ofType(template, "AWS::S3::BucketPolicy")) {
    const statements = v.safeParse(
      statementsSchema,
      at(policy.properties, "PolicyDocument", "Statement"),
    );
    if (!statements.success) {
      problems.push({ resource: policy.id, detail: "the bucket policy could not be read" });
      continue;
    }
    for (const statement of statements.output) {
      // A condition may narrow "everyone" to one distribution or one VPC. It is not evaluated here.
      if (
        statement["Effect"] === "Allow" &&
        isEveryone(statement["Principal"]) &&
        statement["Condition"] === undefined
      ) {
        problems.push({
          resource: policy.id,
          detail: `allows ${[statement["Action"]].flat().join(", ")} to everyone, with no condition`,
        });
      }
    }
  }
  return problems;
}
// #endregion bucket-public

// #region table-pitr
const PITR = ["PointInTimeRecoverySpecification", "PointInTimeRecoveryEnabled"] as const;

/** A table whose past cannot be restored. */
export function tablePitr(template: Template): Problem[] {
  const problems: Problem[] = [];
  for (const table of ofType(template, "AWS::DynamoDB::Table")) {
    if (!isSetTo(at(table.properties, ...PITR), true)) {
      problems.push({ resource: table.id, detail: "point-in-time recovery is not enabled" });
    }
  }
  // One setting per replica: a global table can have it on in one Region and off in another.
  for (const table of ofType(template, "AWS::DynamoDB::GlobalTable")) {
    const replicas = table.properties["Replicas"];
    if (!Array.isArray(replicas) || replicas.length === 0) {
      problems.push({ resource: table.id, detail: "the replicas could not be read" });
      continue;
    }
    for (const replica of replicas) {
      if (!isSetTo(at(replica, ...PITR), true)) {
        const region = setting(at(replica, "Region"));
        problems.push({
          resource: table.id,
          detail: `point-in-time recovery is not enabled for the replica in ${
            typeof region === "object" ? region.value : "a Region set at deploy time"
          }`,
        });
      }
    }
  }
  return problems;
}
// #endregion table-pitr

// #region stateful-delete
/** Types that hold what the repository cannot rebuild: data, identities, secrets, keys, history. */
export const STATEFUL_TYPES = [
  "AWS::DynamoDB::Table",
  "AWS::DynamoDB::GlobalTable",
  "AWS::S3::Bucket",
  "AWS::RDS::DBInstance",
  "AWS::RDS::DBCluster",
  "AWS::DSQL::Cluster",
  "AWS::EFS::FileSystem",
  "AWS::EC2::Volume",
  "AWS::Cognito::UserPool",
  "AWS::SecretsManager::Secret",
  "AWS::KMS::Key",
  "AWS::Logs::LogGroup",
] as const;

const KEEPS = ["Retain", "RetainExceptOnCreate", "Snapshot"];

/** Without a DeletionPolicy CloudFormation deletes, except these two, which it snapshots. */
const snapshotsByDefault = (type: string, properties: Record<string, unknown>): boolean =>
  type === "AWS::RDS::DBCluster" ||
  (type === "AWS::RDS::DBInstance" && properties["DBClusterIdentifier"] === undefined);

/** A stateful resource that goes away with its stack, or with a replacing update. */
export function statefulDelete(template: Template): Problem[] {
  const problems: Problem[] = [];
  for (const resource of ofType(template, ...STATEFUL_TYPES)) {
    const lost: string[] = [];
    const onDelete = setting(resource.deletionPolicy);
    if (onDelete === "intrinsic") {
      lost.push("DeletionPolicy is decided at deploy time");
    } else if (onDelete === "absent") {
      if (!snapshotsByDefault(resource.type, resource.properties)) {
        lost.push("no DeletionPolicy (CloudFormation deletes)");
      }
    } else if (!KEEPS.includes(String(onDelete.value))) {
      lost.push(`DeletionPolicy is ${onDelete.value}`);
    }
    // A replacing update deletes the old resource whatever DeletionPolicy says.
    const onReplace = setting(resource.updateReplacePolicy);
    if (onReplace === "intrinsic") {
      lost.push("UpdateReplacePolicy is decided at deploy time");
    } else if (onReplace === "absent") {
      lost.push("no UpdateReplacePolicy (a replacement deletes the old one)");
    } else if (!KEEPS.includes(String(onReplace.value))) {
      lost.push(`UpdateReplacePolicy is ${onReplace.value}`);
    }
    if (lost.length > 0) {
      problems.push({ resource: resource.id, detail: lost.join("; ") });
    }
  }
  return problems;
}
// #endregion stateful-delete
