// Lambda does not hand a function a Request. It hands it a JSON object that API Gateway
// wrote, and expects a JSON object back. These two functions are the whole translation.

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";

import type { Handler } from "./router.ts";

// #region to-request
/** An HTTP API event (payload format 2.0) as the Request it describes. */
export function toRequest(event: APIGatewayProxyEventV2): Request {
  const { http, domainName } = event.requestContext;
  const query = event.rawQueryString === "" ? "" : `?${event.rawQueryString}`;
  // API Gateway has already joined repeated headers with commas.
  const headers = new Headers(
    Object.entries(event.headers).flatMap(([name, value]) =>
      value === undefined ? [] : [[name, value] as [string, string]],
    ),
  );
  // Cookies arrive apart from the other headers.
  if (event.cookies !== undefined && event.cookies.length > 0) {
    headers.set("cookie", event.cookies.join("; "));
  }
  const body =
    event.body === undefined || http.method === "GET" || http.method === "HEAD"
      ? null
      : // Bytes that are not text arrive as base64.
        event.isBase64Encoded
        ? Buffer.from(event.body, "base64")
        : event.body;
  return new Request(`https://${domainName}${event.rawPath}${query}`, {
    method: http.method,
    headers,
    body,
  });
}
// #endregion to-request

const TEXT =
  /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded)|[^;]+\+(json|xml))/i;

// #region to-result
/** A Response as the object Lambda sends back through API Gateway. */
export async function toResult(response: Response): Promise<APIGatewayProxyStructuredResultV2> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") {
      headers[name] = value;
    }
  });
  const cookies = response.headers.getSetCookie();
  const bytes = Buffer.from(await response.arrayBuffer());
  // The result is JSON, so anything that is not text has to travel as base64.
  const text = TEXT.test(response.headers.get("content-type") ?? "text/plain");
  return {
    statusCode: response.status,
    headers,
    ...(cookies.length === 0 ? {} : { cookies }),
    body: bytes.toString(text ? "utf8" : "base64"),
    isBase64Encoded: !text,
  };
}
// #endregion to-result

// #region handle
/** The event comes along as context, for what a Request cannot carry: what API Gateway verified. */
export function handleApiGateway(
  handler: Handler<{ event: APIGatewayProxyEventV2 }>,
): (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyStructuredResultV2> {
  return async (event) => toResult(await handler(toRequest(event), { event }));
}
// #endregion handle
