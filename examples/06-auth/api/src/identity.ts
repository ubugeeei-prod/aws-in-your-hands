import { z } from "zod";

// #region identity
/** Who is asking, as far as this API is concerned. */
export type Identity = { sub: string };

/**
 * Returns the caller's identity, or undefined when there is none to trust.
 * The two entry points supply different implementations: in AWS the identity
 * comes from API Gateway, on a laptop from a locally signed development token.
 */
export type Authenticate = (request: {
  event: unknown;
  authorization: string | undefined;
}) => Promise<Identity | undefined>;
// #endregion identity

// #region api-gateway
// By the time the function runs, API Gateway's JWT authorizer has verified the
// token's signature, issuer, audience, and expiry, and has put the token's
// claims into the event. This code does not verify a signature; it reads what
// API Gateway verified.
//
// It still checks two things API Gateway does not know about this app:
// - token_use: Cognito issues ID tokens and access tokens. Only an access token
//   is meant for calling an API.
// - client_id: the token was issued to this app's client, not to another app
//   client that happens to live in the same user pool.
const claimsSchema = z.object({
  sub: z.string().min(1),
  token_use: z.literal("access"),
  client_id: z.string().min(1),
});

const eventSchema = z.object({
  requestContext: z.object({ authorizer: z.object({ jwt: z.object({ claims: z.unknown() }) }) }),
});

export function identityFromApiGateway(event: unknown, expectedClientId: string): Identity | undefined {
  const parsedEvent = eventSchema.safeParse(event);
  if (!parsedEvent.success) {
    // No authorizer context at all: the route was reached without the JWT
    // authorizer in front of it. Treat that as "nobody", never as "anybody".
    return undefined;
  }
  const claims = claimsSchema.safeParse(parsedEvent.data.requestContext.authorizer.jwt.claims);
  if (!claims.success || claims.data.client_id !== expectedClientId) {
    return undefined;
  }
  return { sub: claims.data.sub };
}
// #endregion api-gateway
