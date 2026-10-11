// #region grant
const DATABASE_ROLE = /^[a-z_][a-z0-9_]*$/;
const IAM_ROLE_ARN = /^arn:aws:iam::\d{12}:role\/[A-Za-z0-9+=,.@_/-]+$/;

/**
 * What the admin runs once so that an IAM role may use the notes tables as a
 * database role. These statements take no `$1` parameters, so both names are
 * checked against a strict pattern before they are put into the text.
 */
export function grantStatements(databaseRole: string, iamRoleArn: string) {
  if (!DATABASE_ROLE.test(databaseRole)) {
    throw new Error(`${JSON.stringify(databaseRole)} is not a plain database role name`);
  }
  if (!IAM_ROLE_ARN.test(iamRoleArn)) {
    throw new Error(`${JSON.stringify(iamRoleArn)} is not an IAM role ARN`);
  }
  return {
    createRole: `CREATE ROLE ${databaseRole} WITH LOGIN`,
    // Aurora DSQL's own statement: this IAM role may log in as this database role.
    mapToIam: `AWS IAM GRANT ${databaseRole} TO '${iamRoleArn}'`,
    // Rows, not schema: no CREATE, no DROP, nothing outside `app`.
    privileges: [
      `GRANT USAGE ON SCHEMA app TO ${databaseRole}`,
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO ${databaseRole}`,
    ],
  };
}
// #endregion grant
