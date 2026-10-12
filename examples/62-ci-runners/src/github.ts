import { createSign } from "node:crypto";

import * as v from "valibot";

import { type WorkflowRun, workflowRunSchema } from "./events.ts";

// #region interface
export type JitRunner = { runnerId: number; encodedJitConfig: string };

/** The three things the receiver asks of GitHub, for one repository of one installation. */
export type GitHub = {
  run(runId: number): Promise<WorkflowRun>;
  /** Registers a runner that takes one job and is then removed by GitHub. */
  createRunner(name: string): Promise<JitRunner>;
  removeRunner(runnerId: number): Promise<void>;
};
export type GitHubFor = (installationId: number, repository: string) => GitHub;
// #endregion interface

const base64url = (value: string | Buffer): string => Buffer.from(value).toString("base64url");

// #region jwt
/** The app's own identity: a JWT signed with its private key. Seconds since the epoch. */
export function appJwt(clientId: string, privateKeyPem: string, now: number): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  // Issued a minute ago in case the clocks differ, and good for nine: GitHub's limit is ten.
  const claims = base64url(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: clientId }));
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(privateKeyPem);
  return `${header}.${claims}.${base64url(signature)}`;
}
// #endregion jwt

const tokenSchema = v.object({ token: v.pipe(v.string(), v.minLength(1)) });
const jitSchema = v.object({
  runner: v.object({ id: v.pipe(v.number(), v.safeInteger()) }),
  encoded_jit_config: v.pipe(v.string(), v.minLength(1)),
});

export class GitHubError extends Error {
  readonly status: number;
  constructor(what: string, status: number) {
    super(`GitHub answered ${status} to ${what}`);
    this.name = "GitHubError";
    this.status = status;
  }
}

export type GitHubAppOptions = {
  clientId: string;
  /** Read when a token is needed, so the key is in memory only while a launch is under way. */
  privateKey: () => Promise<string>;
  runnerGroupId: number;
  labels: readonly string[];
  fetch: typeof fetch;
  now: () => number;
  apiUrl?: string;
};

// #region app
export function gitHubApp(options: GitHubAppOptions): GitHubFor {
  const api = options.apiUrl ?? "https://api.github.com";
  const call = async (what: string, path: string, init: RequestInit & { bearer: string }) => {
    const response = await options.fetch(`${api}${path}`, {
      method: init.method ?? "GET",
      ...(init.body === undefined ? {} : { body: init.body }),
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${init.bearer}`,
        "x-github-api-version": "2022-11-28",
        "user-agent": "aih-ci-runners",
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
    });
    if (!response.ok) {
      throw new GitHubError(what, response.status);
    }
    return response;
  };

  return (installationId, repository) => {
    const name = repository.slice(repository.indexOf("/") + 1);
    let token: Promise<string> | undefined;
    // One token per delivery, for this repository only, with the two permissions the calls need.
    const installationToken = (): Promise<string> =>
      (token ??= (async () => {
        const jwt = appJwt(options.clientId, await options.privateKey(), options.now());
        const response = await call(
          "an installation token request",
          `/app/installations/${installationId}/access_tokens`,
          {
            method: "POST",
            bearer: jwt,
            body: JSON.stringify({
              repositories: [name],
              permissions: { administration: "write", actions: "read" },
            }),
          },
        );
        return v.parse(tokenSchema, await response.json()).token;
      })());

    return {
      async run(runId) {
        const response = await call(
          "a workflow run request",
          `/repos/${repository}/actions/runs/${runId}`,
          {
            bearer: await installationToken(),
          },
        );
        return v.parse(workflowRunSchema, await response.json());
      },
      async createRunner(runner) {
        const response = await call(
          "a just-in-time runner request",
          `/repos/${repository}/actions/runners/generate-jitconfig`,
          {
            method: "POST",
            bearer: await installationToken(),
            body: JSON.stringify({
              name: runner,
              runner_group_id: options.runnerGroupId,
              labels: options.labels,
            }),
          },
        );
        const created = v.parse(jitSchema, await response.json());
        return { runnerId: created.runner.id, encodedJitConfig: created.encoded_jit_config };
      },
      async removeRunner(runnerId) {
        await call("a runner removal", `/repos/${repository}/actions/runners/${runnerId}`, {
          method: "DELETE",
          bearer: await installationToken(),
        });
      },
    };
  };
}
// #endregion app
