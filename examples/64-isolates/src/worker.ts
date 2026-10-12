import type { Fetch } from "@aih/example-04-http-api/src/http/router.ts";

/** What workerd calls: the default export of the main module. `env` holds the bindings the config declares. */
export type Worker = { fetch(request: Request, env: unknown): Promise<Response> };

// #region adapter
/**
 * Makes an app the default export workerd asks for. Bindings arrive with the
 * first request, not at import, so the app is composed then and kept.
 */
export function asWorker(compose: (bindings: Record<string, string | undefined>) => Fetch): Worker {
  let app: Fetch | undefined;
  return {
    async fetch(request, env) {
      // Not kept when compose throws: a broken configuration fails every request, health checks included.
      app ??= compose(textBindings(env));
      return app(request);
    },
  };
}

/** Only the text bindings. A binding that is an object (a service, a namespace) is not configuration. */
export function textBindings(env: unknown): Record<string, string | undefined> {
  if (typeof env !== "object" || env === null) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}
// #endregion adapter
