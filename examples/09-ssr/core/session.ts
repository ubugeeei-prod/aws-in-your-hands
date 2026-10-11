import { z } from "zod";

// #region cookie
export const SESSION_COOKIE = "aih_session";
export const SESSION_TTL_SECONDS = 60 * 60;

/** 32 random bytes in base64url. The cookie carries this and nothing else. */
export const sessionIdSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const sessionCookieAttributes = (secure: boolean) =>
  ({
    // Not readable from JavaScript, so a script injected into the page cannot copy it.
    httpOnly: true,
    secure,
    sameSite: "lax",
    // The browser sends it only where pages may be personal.
    path: "/me",
    maxAge: SESSION_TTL_SECONDS,
  }) as const;
// #endregion cookie

// #region store
export type Session = {
  userName: string;
  /** For calling other APIs as this user. It never leaves the server. */
  accessToken: string;
  expiresAt: number;
};

export interface SessionStore {
  put(id: string, session: Session): void;
  get(id: string, nowMs: number): Session | undefined;
  delete(id: string): void;
}

/** One Map per process: fine for `nuxt dev`, wrong for Lambda. */
export function createMemorySessions(): SessionStore {
  const sessions = new Map<string, Session>();
  return {
    put: (id, session) => void sessions.set(id, session),
    get: (id, nowMs) => {
      const session = sessions.get(id);
      if (session !== undefined && session.expiresAt <= nowMs) {
        sessions.delete(id);
        return undefined;
      }
      return session;
    },
    delete: (id) => void sessions.delete(id),
  };
}
// #endregion store

export function findSession(store: SessionStore, cookieValue: string | undefined, nowMs: number): Session | undefined {
  const id = sessionIdSchema.safeParse(cookieValue);
  return id.success ? store.get(id.data, nowMs) : undefined;
}

// #region same-origin
/** A form on another site can post here too. Its Origin header gives it away. */
export function isSameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (origin === undefined || host === undefined || !URL.canParse(origin)) {
    return false;
  }
  return new URL(origin).host === host;
}
// #endregion same-origin

export const signInSchema = z.object({ name: z.string().trim().min(1).max(40) });
