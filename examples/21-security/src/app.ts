import { Hono } from "hono";

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

export type App = ReturnType<typeof createApp>;

export function createApp(options: AppOptions) {
  const app = new Hono();
  const failure = (code: ApiError["code"], message: string): ApiError => ({ code, message });

  app.get("/health", (c) => c.json({ status: "ok" as const, stage: options.stage }));

  // #region issue
  // Stands in for "something that needs a secret". A real service would authenticate the caller first.
  app.get("/token", async (c) => {
    const subject = subjectSchema.safeParse(c.req.query("sub"));
    if (!subject.success) {
      return c.json(
        failure("bad-request", "sub must be 1 to 64 characters of A-Z a-z 0-9 _ . @ -"),
        400,
      );
    }
    const key = await options.keyring.current();
    const expiresAt = options.now() + options.tokenTtlSeconds;
    return c.json({
      token: signToken(key, subject.data, expiresAt),
      keyVersion: key.versionId,
      expiresAt,
    });
  });
  // #endregion issue

  // #region check
  app.get("/verify", async (c) => {
    const token = parseToken(c.req.header(TOKEN_HEADER) ?? "");
    if (token === null) {
      return c.json(failure("invalid-token", `send a token in the ${TOKEN_HEADER} header`), 401);
    }
    const key = await options.keyring.find(token.versionId);
    // Same answer for "unknown key version" and "wrong signature": a caller learns nothing about which versions exist.
    const verdict = key === null ? "bad-signature" : verifyToken(token, key, options.now());
    if (verdict === "bad-signature") {
      return c.json(
        failure("invalid-token", "the token was not signed by a key this service accepts"),
        401,
      );
    }
    if (verdict === "expired") {
      return c.json(failure("expired-token", "the token has expired"), 401);
    }
    return c.json({
      subject: token.subject,
      keyVersion: token.versionId,
      expiresAt: token.expiresAt,
    });
  });
  // #endregion check

  // #region unavailable
  app.onError((error, c) => {
    // The name only. An SDK error can carry request details that do not belong in a response.
    options.log({ level: "error", message: "request failed", error: error.name });
    c.header("retry-after", "5");
    return c.json(
      failure(
        "signing-key-unavailable",
        error instanceof SecretAccessDenied
          ? "the function is not allowed to read its signing secret (yet)"
          : "the signing secret could not be read",
      ),
      503,
    );
  });
  // #endregion unavailable

  return app;
}
