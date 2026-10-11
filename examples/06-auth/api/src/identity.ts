import { z } from "zod";

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
    // A route without the authorizer in front means "nobody", never "anybody".
    return undefined;
  }
  const claims = claimsSchema.safeParse(parsedEvent.data.requestContext.authorizer.jwt.claims);
  if (!claims.success || claims.data.client_id !== expectedClientId) {
    return undefined;
  }
  return { sub: claims.data.sub };
}
// #endregion api-gateway
