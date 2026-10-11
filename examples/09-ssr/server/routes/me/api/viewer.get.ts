import { defineEventHandler, getCookie } from "h3";
import type { Viewer } from "../../../../core/profile.ts";
import { findSession, SESSION_COOKIE } from "../../../../core/session.ts";
import { context } from "../../../context.ts";

// #region viewer
export default defineEventHandler(async (event): Promise<Viewer> => {
  const session = findSession(context.sessions, getCookie(event, SESSION_COOKIE), context.now().getTime());
  // The token goes from the session to the upstream API. Only the profile comes back out.
  const profile = session === undefined ? undefined : await context.identity.profile(session.accessToken);
  return profile === undefined ? { signedIn: false, signIn: context.env.signIn } : { signedIn: true, profile };
});
// #endregion viewer
