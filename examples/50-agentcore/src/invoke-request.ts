import { SESSION_HEADER } from "./contract.ts";

// #region invoke-request
export type InvokeTarget = {
  region: string;
  runtimeArn: string;
  /** The endpoint of the runtime. Every runtime has one named DEFAULT. */
  qualifier: string;
};

/**
 * The HTTPS request that invokes a runtime whose inbound authorization is a JWT. The AWS
 * SDK signs with SigV4 and cannot send a bearer token, so this is a plain `fetch`.
 */
export function invocationRequest(
  target: InvokeTarget,
  call: { accessToken: string; sessionId: string; prompt: string },
): { url: string; init: { method: "POST"; headers: Record<string, string>; body: string } } {
  // The ARN goes in the path as one segment, slashes and colons escaped.
  const arn = encodeURIComponent(target.runtimeArn);
  const query = new URLSearchParams({ qualifier: target.qualifier });
  return {
    url: `https://bedrock-agentcore.${target.region}.amazonaws.com/runtimes/${arn}/invocations?${query}`,
    init: {
      method: "POST",
      headers: {
        authorization: `Bearer ${call.accessToken}`,
        "content-type": "application/json",
        accept: "text/event-stream",
        [SESSION_HEADER]: call.sessionId,
      },
      body: JSON.stringify({ prompt: call.prompt }),
    },
  };
}
// #endregion invoke-request
