import {
  createError,
  defineEventHandler,
  getRequestHeader,
  getRequestProtocol,
  readBody,
  sendRedirect,
  setCookie,
} from "h3";
import {
  isSameOrigin,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  sessionCookieAttributes,
  signInSchema,
} from "../../../core/session.ts";
import { context } from "../../context.ts";

// #region sign-in
export default defineEventHandler(async (event) => {
  if (context.env.signIn !== "dev") {
    throw createError({ statusCode: 404, statusMessage: "Not found" });
  }
  if (!isSameOrigin(getRequestHeader(event, "origin"), getRequestHeader(event, "host"))) {
    throw createError({ statusCode: 403, statusMessage: "Cross-site form post" });
  }
  const form = signInSchema.safeParse(await readBody(event));
  if (!form.success) {
    throw createError({ statusCode: 400, statusMessage: "A name of 1 to 40 characters is required" });
  }

  // A real BFF exchanges an authorization code for tokens here (chapter 06's token endpoint).
  const { accessToken } = context.identity.signIn(form.data.name);
  const sessionId = context.newSecret();
  context.sessions.put(sessionId, {
    userName: form.data.name,
    accessToken,
    expiresAt: context.now().getTime() + SESSION_TTL_SECONDS * 1000,
  });
  // The browser gets the session id. The token stays in the store.
  setCookie(event, SESSION_COOKIE, sessionId, sessionCookieAttributes(getRequestProtocol(event) === "https"));
  return sendRedirect(event, "/me", 303);
});
// #endregion sign-in
