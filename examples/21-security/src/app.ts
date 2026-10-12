import * as v from "valibot";

import { type Fetch, route, router } from "@aih/example-04-http-api/src/http/router.ts";

import { type ApiError, subjectSchema, TOKEN_HEADER } from "./contract.ts";
import type { Keyring } from "./keyring.ts";
import type { Logger } from "./log.ts";
import { SecretAccessDenied } from "./secret-source.ts";
import { parseToken, signToken, verifyToken } from "./token.ts";

export type AppOptions = {
  stage: string;
  keyring: Keyring;
  tokenTtlSeconds: number;
  /** Unix seconds. */
  now: () => number;
  log: Logger;
};

export type App = Fetch;

const failure = (status: number, code: ApiError["code"], message: string): Response =>
  Response.json({ code, message } satisfies ApiError, { status });

export function createApp(options: AppOptions): App {
  const routes = router<void>(
    [
      route("GET", "/health", () => Response.json({ status: "ok", stage: options.stage })),

      // #region issue
      // Stands in for "something that needs a secret". A real service would authenticate the caller first.
      route("GET", "/token", async (request) => {
        // A missing `sub` is null, and null is not a string.
        const subject = v.safeParse(subjectSchema, new URL(request.url).searchParams.get("sub"));
        if (!subject.success) {
          return failure(
            400,
            "bad-request",
            "sub must be 1 to 64 characters of A-Z a-z 0-9 _ . @ -",
          );
        }
        const key = await options.keyring.current();
        const expiresAt = options.now() + options.tokenTtlSeconds;
        return Response.json({
          token: signToken(key, subject.output, expiresAt),
          keyVersion: key.versionId,
          expiresAt,
        });
      }),
      // #endregion issue

      // #region check
      route("GET", "/verify", async (request) => {
        const token = parseToken(request.headers.get(TOKEN_HEADER) ?? "");
        if (token === null) {
          return failure(401, "invalid-token", `send a token in the ${TOKEN_HEADER} header`);
        }
        const key = await options.keyring.find(token.versionId);
        // Same answer for "unknown key version" and "wrong signature": a caller learns nothing about which versions exist.
        const verdict = key === null ? "bad-signature" : verifyToken(token, key, options.now());
        if (verdict === "bad-signature") {
          return failure(
            401,
            "invalid-token",
            "the token was not signed by a key this service accepts",
          );
        }
        if (verdict === "expired") {
          return failure(401, "expired-token", "the token has expired");
        }
        return Response.json({
          subject: token.subject,
          keyVersion: token.versionId,
          expiresAt: token.expiresAt,
        });
      }),
      // #endregion check
    ],
    () => new Response("404 Not Found", { status: 404 }),
  );

  // #region unavailable
  // A route throws when the signing key cannot be read. Nothing else in this API throws on purpose.
  return async (request) => {
    try {
      return await routes(request);
    } catch (error) {
      // The name only. An SDK error can carry request details that do not belong in a response.
      options.log({
        level: "error",
        message: "request failed",
        error: error instanceof Error ? error.name : "?",
      });
      const response = failure(
        503,
        "signing-key-unavailable",
        error instanceof SecretAccessDenied
          ? "the function is not allowed to read its signing secret (yet)"
          : "the signing secret could not be read",
      );
      response.headers.set("retry-after", "5");
      return response;
    }
  };
  // #endregion unavailable
}
