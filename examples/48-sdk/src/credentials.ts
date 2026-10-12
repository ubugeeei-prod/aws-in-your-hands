import { defaultProvider } from "@aws-sdk/credential-provider-node";
import * as v from "valibot";

// #region chain
/**
 * The default chain of @aws-sdk/credential-provider-node 3.972.85, in the order it tries.
 * Read from its source; a test walks the real chain and compares.
 */
export const DEFAULT_CHAIN = [
  // AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY. Skipped whenever AWS_PROFILE is set.
  "fromEnv",
  // Only when the caller passed SSO fields in code. A profile's SSO settings go through fromIni.
  "fromSSO",
  // The profile in ~/.aws/config and ~/.aws/credentials: static keys, a role to assume,
  // IAM Identity Center, a process, or the session `aws login` wrote.
  "fromIni",
  // credential_process in the profile.
  "fromProcess",
  // AWS_WEB_IDENTITY_TOKEN_FILE and AWS_ROLE_ARN.
  "fromTokenFile",
  // The container credentials endpoint when its environment variables exist, as on ECS;
  // otherwise the EC2 instance metadata service, unless AWS_EC2_METADATA_DISABLED is set.
  "remoteProvider",
] as const;
export type ChainStep = (typeof DEFAULT_CHAIN)[number];
// #endregion chain

// #region source
// The marks the providers leave on what they return, from @aws-sdk/types 3.974.6.
const SOURCES = {
  CREDENTIALS_CODE: "given in code",
  CREDENTIALS_ENV_VARS: "environment variables",
  CREDENTIALS_ENV_VARS_STS_WEB_ID_TOKEN: "web identity token file",
  CREDENTIALS_STS_ASSUME_ROLE: "sts:AssumeRole",
  CREDENTIALS_STS_ASSUME_ROLE_WEB_ID: "sts:AssumeRoleWithWebIdentity",
  CREDENTIALS_PROFILE: "static keys in a profile",
  CREDENTIALS_PROFILE_SOURCE_PROFILE: "a profile's source_profile",
  CREDENTIALS_PROFILE_NAMED_PROVIDER: "a profile's credential_source",
  CREDENTIALS_PROFILE_STS_WEB_ID_TOKEN: "a profile's web identity token",
  CREDENTIALS_PROFILE_SSO: "IAM Identity Center, from a profile",
  CREDENTIALS_SSO: "IAM Identity Center",
  CREDENTIALS_PROFILE_SSO_LEGACY: "IAM Identity Center, from a profile (legacy form)",
  CREDENTIALS_SSO_LEGACY: "IAM Identity Center (legacy form)",
  CREDENTIALS_PROFILE_PROCESS: "a profile's credential_process",
  CREDENTIALS_PROCESS: "credential_process",
  CREDENTIALS_HTTP: "container credentials endpoint",
  CREDENTIALS_IMDS: "EC2 instance metadata",
  CREDENTIALS_PROFILE_LOGIN: "aws login, from a profile",
  CREDENTIALS_LOGIN: "aws login",
} as const;

const resolvedSchema = v.object({
  accessKeyId: v.string(),
  sessionToken: v.optional(v.string()),
  expiration: v.optional(v.date()),
  accountId: v.optional(v.string()),
  $source: v.optional(v.record(v.string(), v.string())),
});

export type CredentialReport = {
  /** The last four characters only. The rest of the ID, the secret and the token are never returned. */
  accessKeyIdEnd: string;
  temporary: boolean;
  expiresAt: string | undefined;
  accountId: string | undefined;
  /** Every provider that had a hand in it, outermost last. Empty when the SDK left no mark. */
  sources: string[];
  /** The steps of the default chain that were tried, in order. */
  tried: ChainStep[];
};

const stepLine = /defaultProvider::(\w+)$/;

/**
 * Resolves credentials the way a client with no `credentials` setting would, and says where
 * they came from. It calls no AWS API itself, but some providers do: a role in a profile calls
 * STS, IAM Identity Center and `aws login` refresh their tokens.
 */
export async function reportDefaultCredentials(): Promise<CredentialReport> {
  const tried: ChainStep[] = [];
  const logger = {
    debug(message: unknown) {
      const step = typeof message === "string" ? stepLine.exec(message)?.[1] : undefined;
      const known = DEFAULT_CHAIN.find((name) => name === step);
      if (known !== undefined) {
        tried.push(known);
      }
    },
    info() {},
    warn() {},
    error() {},
  };
  const resolved = v.parse(resolvedSchema, await defaultProvider({ logger })());
  return {
    accessKeyIdEnd: resolved.accessKeyId.slice(-4),
    temporary: resolved.sessionToken !== undefined,
    expiresAt: resolved.expiration?.toISOString(),
    accountId: resolved.accountId,
    sources: Object.keys(resolved.$source ?? {}).map((mark) =>
      mark in SOURCES ? SOURCES[mark as keyof typeof SOURCES] : mark,
    ),
    tried,
  };
}
// #endregion source
