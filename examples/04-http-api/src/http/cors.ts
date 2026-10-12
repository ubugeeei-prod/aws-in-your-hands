// Cross-origin requests: the headers a browser needs before it lets a page on one
// origin read an answer from another.

import type { Handler } from "./router.ts";

export type CorsOptions = {
  /** The one origin whose pages may read the answers. */
  origin: string;
  allowMethods: string[];
  allowHeaders: string[];
};

// #region cors
export function cors<Context>(options: CorsOptions, next: Handler<Context>): Handler<Context> {
  return async (request, context) => {
    // A browser asks first, with OPTIONS, before a request that is not "simple". No route sees it.
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": options.origin,
          "access-control-allow-methods": options.allowMethods.join(","),
          "access-control-allow-headers": options.allowHeaders.join(","),
          vary: "Origin, Access-Control-Request-Headers",
        },
      });
    }
    const response = await next(request, context);
    // A Response from elsewhere may have headers that cannot be changed. A copy always can.
    const answer = new Response(response.body, response);
    // The same value for every caller. A page on another origin gets it too, and its
    // browser refuses the answer because the value is not that page's origin.
    answer.headers.set("access-control-allow-origin", options.origin);
    answer.headers.append("vary", "Origin");
    return answer;
  };
}
// #endregion cors
