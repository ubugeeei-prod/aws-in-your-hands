import { createSign } from "node:crypto";

import * as v from "valibot";

const API = "https://api.github.com";

// #region app-secret
/** The secret's JSON. Only the launcher reads it; a task never sees the key. */
export const githubAppSchema = v.strictObject({
  clientId: v.pipe(v.string(), v.minLength(1)),
  installationId: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  /** The account the app is installed on. A request for another owner's repository is refused. */
  owner: v.pipe(v.string(), v.minLength(1)),
  privateKey: v.pipe(v.string(), v.startsWith("-----BEGIN")),
});
export type GithubApp = v.InferOutput<typeof githubAppSchema>;
// #endregion app-secret

const base64url = (value: string | Buffer): string => Buffer.from(value).toString("base64url");

// #region jwt
/** The JWT a GitHub App signs to ask for an installation token. Valid for nine minutes. */
export function appJwt(app: Pick<GithubApp, "clientId" | "privateKey">, now: Date): string {
  const seconds = Math.floor(now.getTime() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  // GitHub's page: issued 60 seconds in the past against clock drift, expiring within 10 minutes.
  const payload = base64url(
    JSON.stringify({ iat: seconds - 60, exp: seconds + 9 * 60, iss: app.clientId }),
  );
  const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(app.privateKey);
  return `${header}.${payload}.${base64url(signature)}`;
}
// #endregion jwt

// #region token
/** The two permissions a task needs, on one repository. */
export const TOKEN_PERMISSIONS = { contents: "write", pull_requests: "write" } as const;

export type HttpRequest = {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
};

const headers = (bearer: string): Record<string, string> => ({
  accept: "application/vnd.github+json",
  authorization: `Bearer ${bearer}`,
  "content-type": "application/json",
  "user-agent": "aih-agent-sandbox",
});

/** The request that makes an installation token for one repository and nothing else. */
export function tokenRequest(
  app: GithubApp,
  repository: string,
  now: Date,
): HttpRequest | undefined {
  const [owner, name] = repository.split("/");
  if (name === undefined || owner?.toLowerCase() !== app.owner.toLowerCase()) {
    return undefined;
  }
  return {
    url: `${API}/app/installations/${app.installationId}/access_tokens`,
    method: "POST",
    headers: headers(appJwt(app, now)),
    // Without `repositories` the token would reach every repository the app is installed on.
    body: JSON.stringify({ repositories: [name], permissions: TOKEN_PERMISSIONS }),
  };
}

const tokenResponseSchema = v.object({
  token: v.pipe(v.string(), v.minLength(1)),
  expires_at: v.pipe(v.string(), v.isoTimestamp()),
  permissions: v.record(v.string(), v.string()),
  repositories: v.optional(v.array(v.object({ full_name: v.string() }))),
});

export type GitToken = { token: string; expiresAt: Date };

/** Reads GitHub's answer, and refuses a token that is wider than the one that was asked for. */
export function readToken(body: unknown, repository: string, deadline: Date): GitToken {
  const answer = v.parse(tokenResponseSchema, body);
  // "metadata: read" comes with every token; anything else that was not asked for is a surprise.
  const extra = Object.keys(answer.permissions).filter(
    (name) => name !== "metadata" && !Object.hasOwn(TOKEN_PERMISSIONS, name),
  );
  if (extra.length > 0) {
    throw new Error(`the token carries permissions that were not asked for: ${extra.join(", ")}`);
  }
  const names = (answer.repositories ?? []).map((item) => item.full_name.toLowerCase());
  if (names.length !== 1 || names[0] !== repository.toLowerCase()) {
    throw new Error("the token is not limited to the one repository");
  }
  const expiresAt = new Date(answer.expires_at);
  if (expiresAt.getTime() <= deadline.getTime()) {
    throw new Error("the token would expire before the task's deadline");
  }
  return { token: answer.token, expiresAt };
}
// #endregion token

// #region pull-request
export type PullRequest = {
  repository: string;
  head: string;
  base: string;
  title: string;
  body: string;
};

/** The request that opens the pull request. Merging it is left to a person and to the repository's rules. */
export function pullRequest(pull: PullRequest, token: string): HttpRequest {
  return {
    url: `${API}/repos/${pull.repository}/pulls`,
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ title: pull.title, head: pull.head, base: pull.base, body: pull.body }),
  };
}
// #endregion pull-request
