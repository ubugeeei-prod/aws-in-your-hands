// Arguments for the AWS CLI. Nothing here runs anything: src/aws-cli.ts does.

// Budgets is account-wide; its API endpoint is in us-east-1.
export const BUDGETS_REGION = "us-east-1";
/** cdkd 0.296.28 keeps each stack at <prefix>/<stack>/<region>/state.json. */
export const STATE_PREFIX = "cdkd";
export const stateBucketOf = (accountId: string) => `cdkd-state-${accountId}`;

// #region args
// Every call names its Region: CloudShell sets AWS_REGION to wherever the console was open.
const at = (region: string) => ["--region", region, "--output", "json"];

export const identityArgs = () => ["sts", "get-caller-identity", "--output", "json"];

export const budgetArgs = (accountId: string, budgetName: string) => [
  "budgets",
  "describe-budget",
  "--account-id",
  accountId,
  "--budget-name",
  budgetName,
  ...at(BUDGETS_REGION),
];

export const stateKeysArgs = (bucket: string, region: string) => [
  "s3api",
  "list-objects-v2",
  "--bucket",
  bucket,
  "--prefix",
  `${STATE_PREFIX}/`,
  "--query",
  "Contents[].Key",
  ...at(region),
];

/** `-` as the destination streams the object to standard output. */
export const stateBodyArgs = (bucket: string, key: string, region: string) => [
  "s3",
  "cp",
  `s3://${bucket}/${key}`,
  "-",
  "--region",
  region,
];

export const versionsArgs = (bucket: string, region: string, startingToken?: string) => [
  "s3api",
  "list-object-versions",
  "--bucket",
  bucket,
  "--max-items",
  "1000",
  ...(startingToken === undefined ? [] : ["--starting-token", startingToken]),
  ...at(region),
];

/** The batch travels in a file: a thousand keys do not fit comfortably in one argument. */
export const deleteArgs = (input: {
  bucket: string;
  file: string;
  region: string;
  accountId: string;
}) => [
  "s3api",
  "delete-objects",
  "--bucket",
  input.bucket,
  "--delete",
  `file://${input.file}`,
  // S3 answers 403 if the bucket belongs to any other account.
  "--expected-bucket-owner",
  input.accountId,
  ...at(input.region),
];
// #endregion args
