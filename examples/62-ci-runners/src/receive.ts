import * as v from "valibot";

import { claimKey, type Claims } from "./claims.ts";
import { MAX_BODY_BYTES } from "./config.ts";
import { admit, type Policy, type Refusal, runnerName, screen } from "./decide.ts";
import { workflowJobSchema } from "./events.ts";
import type { GitHubFor } from "./github.ts";
import type { Launcher } from "./launcher.ts";
import { verify } from "./signature.ts";

export type ReceiveDeps = {
  /** Read on every delivery, so a rotated secret is picked up without a deploy. */
  webhookSecret: () => Promise<string>;
  policy: Policy;
  claims: Claims;
  github: GitHubFor;
  launcher: Launcher;
  /** Seconds since the epoch. */
  now: () => number;
  /** A few random characters for the runner's name. */
  nonce: () => string;
  log: (entry: Record<string, unknown>) => void;
};

export type Outcome =
  | { outcome: "launched"; taskArn: string }
  | { outcome: "skipped"; reason: Refusal }
  | { outcome: "duplicate" };

const answer = (status: number, body: Outcome | { error: string }): Response =>
  Response.json(body, { status });

// #region body
/** The exact bytes GitHub signed, or null once they pass the limit. Nothing is parsed yet. */
export async function readBytes(request: Request, maxBytes: number): Promise<Uint8Array | null> {
  if (request.body === null) {
    return new Uint8Array();
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request.body) {
    size += chunk.byteLength;
    if (size > maxBytes) {
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
// #endregion body

// #region receive
/** One webhook delivery in, at most one task out. */
export async function receive(request: Request, deps: ReceiveDeps): Promise<Response> {
  const body = await readBytes(request, MAX_BODY_BYTES);
  if (body === null) {
    return answer(413, { error: "too_large" });
  }
  // Before anything in the body is believed, or even parsed.
  const signature = request.headers.get("x-hub-signature-256");
  if (!verify(await deps.webhookSecret(), body, signature)) {
    return answer(401, { error: "bad_signature" });
  }
  if (request.headers.get("x-github-event") !== "workflow_job") {
    return answer(200, { outcome: "skipped", reason: "other_event" });
  }

  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(body).toString("utf8"));
  } catch {
    return answer(400, { error: "invalid_json" });
  }
  const delivery = v.safeParse(workflowJobSchema, json);
  if (!delivery.success) {
    return answer(400, { error: "invalid_payload" });
  }

  const screening = screen(delivery.output, deps.policy);
  if (screening.kind === "skip") {
    return answer(200, { outcome: "skipped", reason: screening.reason });
  }
  const { job } = screening;
  const key = claimKey(job.repository, job.jobId);
  if (!(await deps.claims.claim(key, deps.now()))) {
    return answer(200, { outcome: "duplicate" });
  }

  const github = deps.github(job.installationId, job.repository);
  let registered: number | undefined;
  try {
    const refusal = admit(await github.run(job.runId), job, deps.policy);
    if (refusal !== null) {
      // The claim stays: the answer for this job will not change, so a redelivery need not ask again.
      deps.log({ message: "job refused", ...job, reason: refusal });
      return answer(200, { outcome: "skipped", reason: refusal });
    }
    const name = runnerName(job.jobId, deps.nonce());
    const runner = await github.createRunner(name);
    registered = runner.runnerId;
    const { taskArn } = await deps.launcher.launch({
      runnerName: name,
      encodedJitConfig: runner.encodedJitConfig,
      jobId: job.jobId,
    });
    // The task exists from here on. Nothing below may undo it or report a failure.
    await deps.claims.complete(key, taskArn, deps.now()).catch((error: unknown) => {
      deps.log({ message: "claim not completed", ...job, taskArn, error: String(error) });
    });
    deps.log({ message: "runner launched", ...job, runner: name, taskArn });
    return answer(200, { outcome: "launched", taskArn });
  } catch (error) {
    deps.log({ message: "launch failed", ...job, error: String(error) });
    // A runner that was registered and has no task would sit in GitHub's list for a day.
    if (registered !== undefined) {
      await github.removeRunner(registered).catch((cause: unknown) => {
        deps.log({
          message: "runner not removed",
          ...job,
          runnerId: registered,
          error: String(cause),
        });
      });
    }
    // Give the job back, so that redelivering this delivery tries again.
    await deps.claims.release(key).catch((cause: unknown) => {
      deps.log({ message: "claim not released", ...job, error: String(cause) });
    });
    return answer(500, { error: "launch_failed" });
  }
}
// #endregion receive
