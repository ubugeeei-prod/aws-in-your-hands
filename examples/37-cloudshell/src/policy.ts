// IAM policy documents for CloudShell. Nothing here calls AWS: scripts/policy.ts
// prints one, and the tests pin which actions each one lets through.

// #region actions
/** Every action in the cloudshell namespace (service reference v1.4, read 2026-10-13). */
export const CLOUDSHELL_ACTIONS = [
  "ApproveCommand",
  "CreateEnvironment",
  "CreateSession",
  "DeleteEnvironment",
  "DescribeEnvironments",
  "GetEnvironmentStatus",
  "GetFileDownloadUrls",
  "GetFileUploadUrls",
  "PutCredentials",
  "StartEnvironment",
  "StopEnvironment",
] as const;
export type CloudShellAction = (typeof CLOUDSHELL_ACTIONS)[number];

/** Without all four, the console answers with a permissions error instead of a prompt. */
export const LAUNCH_ACTIONS = [
  "CreateEnvironment",
  "CreateSession",
  "GetEnvironmentStatus",
  "StartEnvironment",
] as const satisfies readonly CloudShellAction[];

/** The presigned URLs behind Actions > Upload file and Download file. */
export const FILE_TRANSFER_ACTIONS = [
  "GetFileDownloadUrls",
  "GetFileUploadUrls",
] as const satisfies readonly CloudShellAction[];
// #endregion actions

// #region documents
export type Statement = {
  Sid: string;
  Effect: "Allow" | "Deny";
  Action: string[];
  // cloudshell:CreateEnvironment accepts no narrower resource than "*".
  Resource: "*";
  Condition?: Record<string, Record<string, string>>;
};
export type PolicyDocument = { Version: "2012-10-17"; Statement: Statement[] };

const named = (actions: readonly CloudShellAction[]) =>
  actions.map((action) => `cloudshell:${action}`);

export type ShellUse = {
  /** PutCredentials: the shell starts with the console session's identity. */
  credentials: boolean;
  /** Upload and download through the console. `curl` and `aws s3 cp` still work without it. */
  fileTransfer: boolean;
};

/** Open a shell, and only what `use` adds. Says nothing about what the shell may then call. */
export function allowShell(use: ShellUse): PolicyDocument {
  const actions: CloudShellAction[] = [
    ...LAUNCH_ACTIONS,
    ...(use.credentials ? (["PutCredentials"] as const) : []),
    ...(use.fileTransfer ? FILE_TRANSFER_ACTIONS : []),
  ];
  return {
    Version: "2012-10-17",
    Statement: [
      { Sid: "UseCloudShell", Effect: "Allow", Action: named(actions).sort(), Resource: "*" },
    ],
  };
}

/** An explicit deny wins over every allow, AdministratorAccess included. */
export function denyShell(): PolicyDocument {
  return {
    Version: "2012-10-17",
    Statement: [{ Sid: "DenyCloudShell", Effect: "Deny", Action: ["cloudshell:*"], Resource: "*" }],
  };
}

/** Only environments inside a VPC: the public kind, with its open egress, cannot be created. */
export function denyPublicEnvironments(): PolicyDocument {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "DenyCloudShellNonVpcEnvironments",
        Effect: "Deny",
        Action: ["cloudshell:CreateEnvironment"],
        Resource: "*",
        Condition: { Null: { "cloudshell:VpcIds": "true" } },
      },
    ],
  };
}
// #endregion documents

// #region evaluate
const matches = (pattern: string, action: CloudShellAction): boolean =>
  pattern === "*" || pattern === "cloudshell:*" || pattern === `cloudshell:${action}`;

/**
 * Which CloudShell actions a set of documents lets through. It knows action names and the two
 * wildcards above, and treats a conditional statement as not applying: it is a check on these
 * documents, not IAM's policy evaluation.
 */
export function allowedActions(documents: readonly PolicyDocument[]): CloudShellAction[] {
  const statements = documents
    .flatMap((document) => document.Statement)
    .filter((statement) => statement.Condition === undefined);
  const covered = (effect: Statement["Effect"], action: CloudShellAction) =>
    statements.some(
      (statement) =>
        statement.Effect === effect && statement.Action.some((item) => matches(item, action)),
    );
  return CLOUDSHELL_ACTIONS.filter(
    (action) => covered("Allow", action) && !covered("Deny", action),
  );
}

export const canLaunch = (documents: readonly PolicyDocument[]): boolean => {
  const allowed = new Set<CloudShellAction>(allowedActions(documents));
  return LAUNCH_ACTIONS.every((action) => allowed.has(action));
};
// #endregion evaluate
