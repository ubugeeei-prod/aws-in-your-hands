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
// Authorization code grant with PKCE against the standard OAuth endpoints.
// No AWS SDK, no Amplify.
export function createCognitoProvider(
  settings: CognitoSettings,
  storage: TabStorage,
  navigate: (url: string) => void,
): AuthProvider {
  // A user pool domain has fixed endpoint paths, so no discovery request is needed.
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
      // Only the hash of the verifier leaves the browser here.
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
      // The response also carries an ID token (checked by the library) and a
      // refresh token. Neither is kept, so the session ends with the access token.
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
