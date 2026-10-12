import { type Awslambda, streamFunctionUrl } from "@aih/example-17-ai/src/function-url.ts";

import type { App } from "./app.ts";

// #region adapter
/**
 * Chapter 17's adapter hands the app a Request and nothing else. This app also needs the
 * event, because that is where Lambda wrote who signed the request. So the event is
 * captured per invocation, and chapter 17's code does the writing.
 */
export function streamWithEvent(app: App, runtime: Awslambda) {
  const inner: Awslambda = {
    // Already inside a streamified handler: nothing to mark a second time.
    streamifyResponse: (handler) => handler,
    HttpResponseStream: runtime.HttpResponseStream,
  };
  return runtime.streamifyResponse((event, responseStream, context) =>
    streamFunctionUrl((request) => app(request, { event }), inner)(event, responseStream, context),
  );
}
// #endregion adapter
