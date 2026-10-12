import { getRequestHeader, getResponseHeader, getResponseStatus, setResponseHeader } from "h3";
import { defineNitroPlugin } from "nitropack/runtime";

import { cacheControlFor, NO_STORE } from "../../core/cache-control.ts";

// #region plugin
export default defineNitroPlugin((nitro) => {
  // Closed by default: an error page, or a route that skips the hook below, is never shared.
  nitro.hooks.hook("request", (event) => {
    setResponseHeader(event, "cache-control", NO_STORE);
  });

  // Runs after the handler, so it sees the status and whether a cookie is being set.
  nitro.hooks.hook("beforeResponse", (event) => {
    const decision = cacheControlFor({
      method: event.method,
      path: event.path.split("?")[0] ?? "/",
      status: getResponseStatus(event),
      hasCookie: getRequestHeader(event, "cookie") !== undefined,
      hasAuthorization: getRequestHeader(event, "authorization") !== undefined,
      setsCookie: getResponseHeader(event, "set-cookie") !== undefined,
    });
    setResponseHeader(event, "cache-control", decision.value);
  });
});
// #endregion plugin
