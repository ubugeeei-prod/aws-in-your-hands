import {
  type Handler,
  type Params,
  route,
  router,
} from "@aih/example-04-http-api/src/http/router.ts";
import type { Logger } from "@aih/example-04-http-api/src/log.ts";
import { isKeySegment, type KeyParts } from "@aih/example-07-uploads/api/src/keys.ts";
import type { Failure } from "@aih/example-17-ai/src/contract.ts";

import type { DescriptionView, ErrorBody } from "./contract.ts";
import {
  type DescribeDeps,
  ensureDescription,
  forgetDescription,
  type Outcome,
  readDescription,
} from "./describe.ts";

export type AppDeps<Context> = {
  describe: DescribeDeps;
  /** Who is calling, as a key segment. `undefined` means nobody to trust. */
  ownerOf: (context: Context) => string | undefined;
  stage: string;
  backend: string;
  log: Logger;
  newRequestId: () => string;
  now: () => number;
};

const PATH = "/notes/:noteId/attachments/:attachmentId/description";

// What a failure looks like as an HTTP status. Chapter 17's table, for the same codes.
const STATUS = {
  throttled: 429,
  unavailable: 503,
  timeout: 504,
  cancelled: 503,
  interrupted: 502,
  bad_output: 502,
  rejected: 502,
  misconfigured: 500,
  internal: 500,
} as const satisfies Record<Failure["code"], number>;

export function createApp<Context>(deps: AppDeps<Context>): Handler<Context> {
  type Scope = { requestId: string; owner: string | undefined };

  const failure = (
    status: number,
    code: ErrorBody["error"]["code"],
    message: string,
    { requestId }: Scope,
    retryable?: boolean,
  ) =>
    Response.json(
      {
        error: { code, message, requestId, ...(retryable === undefined ? {} : { retryable }) },
      } satisfies ErrorBody,
      { status },
    );

  // #region parts
  // The owner is never read from the path. The other two parts are, and must be segments:
  // "..", "/" or "%2F" in either would name a key outside the caller's prefix.
  const partsOf = (scope: Scope, params: Params): KeyParts | Response => {
    if (scope.owner === undefined) {
      return failure(401, "unauthenticated", "The request carries no identity.", scope);
    }
    const noteId = params["noteId"] ?? "";
    const attachmentId = params["attachmentId"] ?? "";
    return isKeySegment(noteId) && isKeySegment(attachmentId)
      ? { owner: scope.owner, noteId, attachmentId }
      : failure(404, "attachment_missing", "No such attachment.", scope);
  };
  // #endregion parts

  // #region answer
  const answer = (
    outcome: Outcome,
    scope: Scope,
    absent: "attachment_missing" | "not_described",
  ) => {
    switch (outcome.status) {
      case "ready": {
        const { description } = outcome;
        return Response.json({
          status: "ready",
          outcome: description.outcome,
          ...(description.outcome === "described" ? { text: description.text } : {}),
          modelId: description.modelId,
          createdAt: description.createdAt,
          reused: outcome.billed === null,
        } satisfies DescriptionView);
      }
      case "in_progress":
        // 202: accepted, not done. The caller asks again with GET.
        return Response.json(outcome, {
          status: 202,
          headers: { "retry-after": String(outcome.retryAfterSeconds) },
        });
      case "missing":
        return failure(404, absent, "Nothing is stored for this attachment.", scope);
      case "unsupported":
        return failure(
          422,
          "unsupported_image",
          `The upload cannot be described (${outcome.reason}).`,
          scope,
        );
      case "failed": {
        const { code, retryable } = outcome.failure;
        return failure(
          STATUS[code],
          code,
          "The description could not be generated.",
          scope,
          retryable,
        );
      }
    }
  };
  // #endregion answer

  const routes = router<Scope>(
    [
      route("GET", "/health", () =>
        Response.json({
          status: "ok",
          stage: deps.stage,
          backend: deps.backend,
          modelId: deps.describe.modelId,
        }),
      ),
      route("GET", "/me", (_request, scope) =>
        scope.owner === undefined
          ? failure(401, "unauthenticated", "The request carries no identity.", scope)
          : Response.json({ owner: scope.owner }),
      ),
      // #region routes
      // PUT: "make sure there is one". The only route that can call the model.
      route("PUT", PATH, async (_request, scope, params) => {
        const parts = partsOf(scope, params);
        if (parts instanceof Response) {
          return parts;
        }
        const startedAt = deps.now();
        const outcome = await ensureDescription(deps.describe, parts);
        deps.log({
          level: outcome.status === "failed" ? "warn" : "info",
          message: "describe",
          requestId: scope.requestId,
          modelId: deps.describe.modelId,
          outcome: outcome.status === "failed" ? outcome.failure.code : outcome.status,
          // The billed quantities, whenever the model was called: also for an answer thrown away.
          billed: "billed" in outcome ? outcome.billed : null,
          durationMs: deps.now() - startedAt,
        });
        return answer(outcome, scope, "attachment_missing");
      }),
      route("GET", PATH, async (_request, scope, params) => {
        const parts = partsOf(scope, params);
        return parts instanceof Response
          ? parts
          : answer(await readDescription(deps.describe, parts), scope, "not_described");
      }),
      route("DELETE", PATH, async (_request, scope, params) => {
        const parts = partsOf(scope, params);
        if (parts instanceof Response) {
          return parts;
        }
        await forgetDescription(deps.describe, parts);
        return new Response(null, { status: 204 });
      }),
      // #endregion routes
    ],
    (_request, scope) => failure(404, "not_found", "No such route.", scope),
  );

  return async (request, context) => {
    const scope: Scope = { requestId: deps.newRequestId(), owner: deps.ownerOf(context) };
    let response: Response;
    try {
      response = await routes(request, scope);
    } catch (error) {
      deps.log({
        level: "error",
        message: "unhandled error",
        requestId: scope.requestId,
        error: error instanceof Error ? error.stack : String(error),
      });
      response = failure(500, "internal", "The request could not be completed.", scope);
    }
    response.headers.set("x-request-id", scope.requestId);
    return response;
  };
}
