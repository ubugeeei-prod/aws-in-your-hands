import { createError, defineEventHandler, deleteCookie, getCookie, getRequestHeader, sendRedirect } from "h3";
import { isSameOrigin, SESSION_COOKIE, sessionIdSchema } from "../../../core/session.ts";
import { context } from "../../context.ts";

export default defineEventHandler((event) => {
  if (!isSameOrigin(getRequestHeader(event, "origin"), getRequestHeader(event, "host"))) {
    throw createError({ statusCode: 403, statusMessage: "Cross-site form post" });
  }
  const id = sessionIdSchema.safeParse(getCookie(event, SESSION_COOKIE));
  if (id.success) {
    // Deleting the cookie alone would leave a usable session behind for anyone who copied it.
    context.sessions.delete(id.data);
  }
  deleteCookie(event, SESSION_COOKIE, { path: "/me" });
  return sendRedirect(event, "/me", 303);
});
