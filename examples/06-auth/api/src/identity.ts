import * as v from "valibot";

// #region identity
export type Identity = { sub: string };

/** `undefined` means there is nobody to trust. Each entry point supplies its own implementation. */
export type Authenticate = (request: {
  event: unknown;
  authorization: string | undefined;
}) => Promise<Identity | undefined>;
// #endregion identity

// #region api-gateway
// API Gateway's JWT authorizer has already verified the token, audience and
// scope included. token_use and client_id are checked again as a second layer.
const claimsSchema = v.object({
  sub: v.pipe(v.string(), v.minLength(1)),
  token_use: v.literal("access"),
  client_id: v.pipe(v.string(), v.minLength(1)),
});

const eventSchema = v.object({
  requestContext: v.object({ authorizer: v.object({ jwt: v.object({ claims: v.unknown() }) }) }),
});

export function identityFromApiGateway(
  event: unknown,
  expectedClientId: string,
): Identity | undefined {
  const parsedEvent = v.safeParse(eventSchema, event);
  if (!parsedEvent.success) {
    // A route without the authorizer in front means "nobody", never "anybody".
    return undefined;
  }
  const claims = v.safeParse(claimsSchema, parsedEvent.output.requestContext.authorizer.jwt.claims);
  if (!claims.success || claims.output.client_id !== expectedClientId) {
    return undefined;
  }
  return { sub: claims.output.sub };
}
// #endregion api-gateway
