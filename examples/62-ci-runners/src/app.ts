import { type Fetch, route, router } from "@aih/example-04-http-api/src/http/router.ts";

import { receive, type ReceiveDeps } from "./receive.ts";

// #region app
/** The whole receiver: one route. Everything else is 404, with no hint of what is here. */
export function createApp(deps: ReceiveDeps): Fetch {
  const routes = router<undefined>(
    [route("POST", "/webhook", (request) => receive(request, deps))],
    () => new Response(null, { status: 404 }),
  );
  return (request) => routes(request, undefined);
}
// #endregion app
