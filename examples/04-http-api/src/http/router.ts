// A handler takes a Request and answers with a Response: the same two types a browser's
// fetch() uses, and the ones Node.js, Lambda adapters, and edge runtimes all agree on.
// Nothing in this directory is a framework. Each file is one job a framework would have hidden.

// #region handler
/** A whole application: a request in, a response out. */
export type Fetch = (request: Request) => Response | Promise<Response>;

/** A part of one. `context` is what the application wants its parts to see: a request ID, the caller's identity. */
export type Handler<Context> = (request: Request, context: Context) => Response | Promise<Response>;
// #endregion handler

// #region router
export type Params = Record<string, string>;

export type Route<Context> = {
  method: string;
  pattern: URLPattern;
  handle: (request: Request, context: Context, params: Params) => Response | Promise<Response>;
};

/** `path` is a URLPattern pathname: "/notes/:id" matches "/notes/abc" and names the part `id`. */
export function route<Context>(
  method: string,
  path: string,
  handle: Route<Context>["handle"],
): Route<Context> {
  return { method, pattern: new URLPattern({ pathname: path }), handle };
}

// A URLPattern hands back the path as it was sent. "%20" is still "%20".
function decode(groups: Record<string, string | undefined>): Params | undefined {
  try {
    return Object.fromEntries(
      Object.entries(groups).map(([name, value]) => [name, decodeURIComponent(value ?? "")]),
    );
  } catch {
    // "%zz" names nothing.
    return undefined;
  }
}

/** The first route whose method and path both match answers. Otherwise `notFound` does. */
export function router<Context>(
  routes: Route<Context>[],
  notFound: Handler<Context>,
): Handler<Context> {
  return (request, context) => {
    for (const candidate of routes) {
      const match =
        candidate.method === request.method ? candidate.pattern.exec(request.url) : null;
      if (match === null) {
        continue;
      }
      const params = decode(match.pathname.groups);
      if (params === undefined) {
        break;
      }
      return candidate.handle(request, context, params);
    }
    return notFound(request, context);
  };
}
// #endregion router
