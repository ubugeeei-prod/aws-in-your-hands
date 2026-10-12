---
title: "06 Auth: Run It Locally"
---

# 06 Auth: Run It Locally

## Be two people on your machine

<!-- section: 06.local -->

Let's run it. Copy `examples/06-auth/.env.example` to a file named `.env` in the same place.

<<< @/examples/06-auth/.env.example

You'll need two terminals.

```bash
vp run dev:app:api
vp run dev:app:web
```

Open <http://localhost:5173>, enter a user name (the default is `alice`), and sign in. Create a note, then sign in as `bob` in another browser or a private window. Bob's list should be empty. If you open the same note in two tabs and save in both, the tab that saved later shows both the saved content and your own input.

No Docker, no AWS credentials, no user pool.

### Development sign-in

There's no Cognito on your machine, so here is a stand-in.

<<< @/examples/06-auth/api/src/local-auth.ts

<<< @/examples/06-auth/api/src/dev.ts{dev}

`POST /local/token` takes a user name and returns a token for that user, unconditionally. There is no password. It's a tool for using the app locally as two users.

You wouldn't want that anywhere near a deployment. The way things are built guarantees it stays out.

- This endpoint and the development verification exist only in `dev.ts` and `local-auth.ts`. The Lambda entry point (`lambda.ts`) imports neither. They are not in the bundle
- The development token is signed with a shared secret (HS256). The API Gateway JWT authorizer accepts only RSA-based signatures, so even if this token were sent to the deployed API, it would not pass

Also, this is not an emulation of Cognito. Here is what it doesn't reproduce.

- Managed login and passwords: the real sign-in page, the password rules, the password change at first sign-in
- The authorization code and PKCE round trip: the SPA's code for Cognito (`web/src/auth/cognito.ts`) is never executed locally
- The API Gateway JWT authorizer: that an invalid token is rejected before it reaches the function, and the shape of the response when that happens
- Token expiry, refresh, and revocation: what happens after 1 hour

The second one matters most. What runs locally is "the app after sign-in", not "sign-in with Cognito".

### The SPA reads its settings at runtime

<<< @/examples/06-auth/web/src/config.ts{config}

At startup, the SPA reads `/config.json` to learn where the API is and how to sign in. `web/public/config.json` is for local use. When you deploy, it is replaced with a `config.json` built from the stack's outputs. Build the SPA once, and you can point it at any deployment.

There's no secret in this configuration. Anyone who loads the page can see both the client ID and the sign-in domain. An app that runs in a browser can't hold a secret, and such an app is called a public client.

## Sign in from the SPA

<!-- section: 06.pkce -->

To sign in, the SPA uses the authorization code grant combined with PKCE. The steps are 1 to 4 in the big-picture diagram.

<<< @/examples/06-auth/web/src/auth/provider.ts{provider}

<<< @/examples/06-auth/web/src/auth/cognito.ts{cognito}

One honest note before we go on. Sign-in with Cognito has **never been run**. This `web/src/auth/cognito.ts` has passed type checking and nothing more. It has not been run against a real user pool. It's the biggest "not yet" in this chapter, so please read it with that in mind.

Now, `signIn` creates two random values.

The first is state. It's there to check that the redirect coming back is the answer to the request this tab sent. If an attacker gets someone to follow a link containing a code from the attacker's own sign-in, the state doesn't match, so it isn't accepted.

The second is the code verifier, the PKCE secret. Only its hash (the code challenge) is sent to the sign-in page. When exchanging the code for tokens, the SPA presents the original value. Someone who saw the code along the way doesn't know the original value and can't make the exchange.

A public client can't hold a client secret. PKCE takes its place. The only challenge method Cognito supports is `S256`.

Navigating to the sign-in page discards the SPA's page. Until the user comes back, the two values wait in sessionStorage, which is per tab.

<<< @/examples/06-auth/web/src/auth/pending.ts{pending}

They can be taken out only once. When the state doesn't match, or when the request is too old, nothing is returned. A forged state, reuse of the same callback URL, a request older than 10 minutes: tests check that each of the three is rejected.

Cognito also has the implicit grant, which returns tokens directly in the URL without using a code. The official documentation explains that it is less secure because it exposes tokens on the user's side. The client in this chapter has the implicit grant disabled.

### Where does the token live?

The SPA holds the access token only in a variable in memory. It doesn't put it in localStorage or in a cookie.

| Location | After a reload | From a script that got into the page |
| --- | --- | --- |
| Memory (this chapter) | Gone. You sign in again | Readable while the page is open |
| localStorage | Remains | Readable at any time. Remains after the tab is closed |
| A server-side session and a cookie ([chapter 09](/en/chapters/09-ssr.md)) | Remains | Not readable (when `HttpOnly`) |

Signing in again on every reload is, frankly, a bit inconvenient. But managed login itself holds a session cookie that is valid for 1 hour, so during that time you can come back without retyping the password.

What about the refresh token? The token endpoint's response contains a refresh token too. The SPA discards it without storing it. Keeping it would make the session last longer, but it would mean a long-lived token sitting in the browser. This chapter leans to the short side.

With any of these approaches, if a malicious script gets into the page (XSS), it can call the API as the user while that page is open. Where the token is kept changes the extent of the damage, but it is not a substitute for defending against XSS itself.

The typed client fetches the token on every request.

<<< @/examples/06-auth/api/src/client.ts{client}

When the API returns 401, the SPA discards the token it holds and asks the user to sign in again.

"Sign out" starts the same way, by discarding the token the SPA holds. Then it navigates to the managed login `/logout` endpoint, which ends the session on the sign-in page's side as well. The local development sign-in has nowhere to navigate to, so it only discards the token.

### Show the conflict to the user

In chapter 05, an update from an old version was rejected with a 409, and the stored note came back as `current`. The screen in this chapter shows that to the user. It leaves the user's input in the fields, displays the saved content next to it, and lets the user choose between "Keep my text and save over it" and "Discard my text and use the saved note". The app doesn't decide on its own which one to keep.
