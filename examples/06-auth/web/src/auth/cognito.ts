import * as oauth from "oauth4webapi";
import { savePending, type TabStorage, takePending } from "./pending.ts";
import type { AuthProvider } from "./provider.ts";

export type CognitoSettings = {
  issuer: string;
  domain: string;
  clientId: string;
  redirectUri: string;
  signedOutUri: string;
};

// #region cognito
/**
 * OAuth 2.0 authorization code grant with PKCE against a Cognito user pool,
 * written against the standard endpoints with a general-purpose OAuth
 * library. Nothing here is specific to an AWS SDK or to Amplify.
 */
export function createCognitoProvider(
  settings: CognitoSettings,
  storage: TabStorage,
  navigate: (url: string) => void,
): AuthProvider {
  // The endpoints of a user pool domain are fixed paths, so they are stated
  // here rather than discovered with an extra request at start-up.
  const server: oauth.AuthorizationServer = {
    issuer: settings.issuer,
    authorization_endpoint: `${settings.domain}/oauth2/authorize`,
    token_endpoint: `${settings.domain}/oauth2/token`,
  };
  const client: oauth.Client = { client_id: settings.clientId };

  return {
    mode: "cognito",

    async signIn() {
      const codeVerifier = oauth.generateRandomCodeVerifier();
      const state = oauth.generateRandomState();
      savePending(storage, { state, codeVerifier, createdAt: Date.now() });

      const url = new URL(server.authorization_endpoint as string);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", settings.clientId);
      url.searchParams.set("redirect_uri", settings.redirectUri);
      url.searchParams.set("scope", "openid");
      url.searchParams.set("state", state);
      // Only the hash of the verifier leaves the browser at this point.
      url.searchParams.set("code_challenge", await oauth.calculatePKCECodeChallenge(codeVerifier));
      url.searchParams.set("code_challenge_method", "S256");
      navigate(url.toString());
      return undefined;
    },

    async completeSignIn(url) {
      if (!url.searchParams.has("code") && !url.searchParams.has("error")) {
        return undefined;
      }
      const pending = takePending(storage, url.searchParams.get("state"), Date.now());
      if (pending === undefined) {
        throw new Error("This sign-in response does not belong to a sign-in started in this tab.");
      }
      // Throws when the response is an error or its state does not match.
      const parameters = oauth.validateAuthResponse(server, client, url, pending.state);
      const response = await oauth.authorizationCodeGrantRequest(
        server,
        client,
        // A public client has no secret to authenticate with.
        oauth.None(),
        parameters,
        settings.redirectUri,
        pending.codeVerifier,
      );
      const tokens = await oauth.processAuthorizationCodeResponse(server, client, response, { requireIdToken: true });
      // The ID token is checked by the library and then dropped. The API is
      // called with the access token; the refresh token is not kept, so a
      // session ends when the access token does.
      return { accessToken: tokens.access_token, expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000 };
    },

    signOutUrl() {
      const url = new URL(`${settings.domain}/logout`);
      url.searchParams.set("client_id", settings.clientId);
      url.searchParams.set("logout_uri", settings.signedOutUri);
      return url.toString();
    },
  };
}
// #endregion cognito
