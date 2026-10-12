---
title: "06 Auth: Run It Locally"
---

# 06 Auth: Run It Locally

[The previous page](/en/chapters/06-auth.md) showed how the API establishes the caller and keeps each user to their own notes. This page runs that app on your machine without Cognito and reads the sign-in code on the SPA side.

## Run it as two users on your machine

<!-- section: 06.local -->

Copy `examples/06-auth/.env.example` to a file named `.env` in the same place.

<<< @/examples/06-auth/.env.example

Use two terminals and run one of these tasks in each.

```bash
vp run dev:app:api
vp run dev:app:web
```

Open <http://localhost:5173>, enter a user name (the default is `alice`), and sign in. After you create a note, sign in as `bob` in another browser or a private window. Bob's list should be empty. If you open the same note in two tabs and save in both, the tab that saved second shows both the saved content and your own input.

You need no Docker, no AWS credentials, and no user pool.

### Development sign-in

There is no Cognito on your machine, so the example provides a stand-in.

<<< @/examples/06-auth/api/src/local-auth.ts

<<< @/examples/06-auth/api/src/dev.ts{dev}

`POST /local/token` takes a user name and returns a token for that user unconditionally. There is no password. It exists so that you can use the app locally as two users.

If this endpoint were ever deployed, anyone could become any user. Two mechanisms guarantee that it isn't.

- The endpoint and the development verification exist only in `dev.ts` and `local-auth.ts`. The Lambda entry point (`lambda.ts`) imports neither, so they aren't in the bundle
- The development token is signed with a shared secret (HS256). The API Gateway JWT authorizer accepts only RSA-family signatures, so this token fails if you send it to the deployed API

The development sign-in is not a simulation of Cognito. It doesn't reproduce the following.

- Managed login and passwords, which means the real sign-in page, the password rules, and the first-time password change
- The authorization code and PKCE round trip. The SPA's Cognito code (`web/src/auth/cognito.ts`) never runs locally
- The API Gateway JWT authorizer. Neither the rejection of an invalid token before it reaches the function nor the shape of that response is reproduced
- Token expiry, renewal, and revocation. You can't see locally what happens after an hour

The second item matters most. What runs on your machine is the app after sign-in, not sign-in with Cognito.

### The SPA reads its settings at run time

<<< @/examples/06-auth/web/src/config.ts{config}

When the SPA starts, it reads `/config.json` to learn where the API is and how to sign in. `web/public/config.json` is for local use, and at deploy time it is replaced by a `config.json` generated from the stack outputs. A single build of the SPA can therefore be pointed at any deployment.

These settings contain no secrets. Anyone who loads the page can see the client ID and the sign-in domain. An app that runs in a browser can't hold a secret, and such an app is called a public client.

## Sign in from the SPA

<!-- section: 06.pkce -->

The SPA signs in with the authorization code grant combined with PKCE. The steps are 1 to 4 in the figure on [the chapter's first page](/en/chapters/06-auth.md) that runs from sign-in to the exchange for an access token.

<<< @/examples/06-auth/web/src/auth/provider.ts{provider}

<<< @/examples/06-auth/web/src/auth/cognito.ts{cognito}

Sign-in with Cognito has **never been run**. This `web/src/auth/cognito.ts` has passed type checking and nothing more, and it has never run against a real user pool. It is the largest unverified part of the chapter, so read it with that in mind.

`signIn` generates two random values.

The first is the state, which confirms that the redirect coming back answers the request this tab sent. If an attacker gets you to follow a link containing an authorization code from their own sign-in, the state doesn't match and the SPA rejects it.

The second is the code verifier, the secret in PKCE. Only its hash (the code challenge) is sent to the sign-in page. The SPA presents the original value when it exchanges the authorization code for tokens. Someone who saw the authorization code on the way doesn't know the original value and can't make the exchange.

A public client can't hold a client secret, and PKCE takes its place. `S256` is the only challenge method Cognito supports.

Moving to the sign-in page discards the SPA's page. Until the browser comes back, the two values are kept in sessionStorage, which is per tab.

<<< @/examples/06-auth/web/src/auth/pending.ts{pending}

The stored values can be taken out only once, and nothing is returned when the state doesn't match or the request is too old. The tests check that a forged state, a reused callback URL, and a request older than 10 minutes are each rejected.

Cognito also has an implicit grant, which skips the authorization code and returns tokens directly in the URL. The official documentation describes it as less secure because it exposes tokens on the user's side. This chapter's client has the implicit grant disabled.

### Where the token is kept

The SPA holds the access token only in a variable in memory. It doesn't put it in localStorage or in a cookie.

| Location | After a reload | From a script that got into the page |
| --- | --- | --- |
| Memory (this chapter) | Gone. You sign in again | Readable while the page is open |
| localStorage | Remains | Readable at any time. Remains after the tab is closed |
| A server-side session and a cookie ([chapter 09](/en/chapters/09-ssr.md)) | Remains | Not readable (when `HttpOnly`) |

Signing in again after every reload is inconvenient. Managed login keeps its own session cookie that is valid for one hour, though, so during that time you come back without retyping your password.

The token endpoint's response also contains a refresh token, and the SPA discards it without storing it. Keeping it would let you stay signed in longer, but it would put a long-lived token in the browser, so this chapter chooses the shorter life.

Whichever option you choose, a malicious script that gets into the page (XSS) can call the API as the user for as long as the page is open. Where the token is kept changes how far the damage reaches, but it doesn't replace defending against XSS itself.

The typed client asks for the token on every request.

<<< @/examples/06-auth/api/src/client.ts{client}

When the API returns 401, the SPA discards the token it holds and prompts you to sign in again.

Pressing "Sign out" also discards the local token first. The SPA then moves to managed login's `/logout` to end the session on the sign-in side as well. The local development sign-in has nowhere to move to, so it only discards the token.

### Show the conflict to the user

Chapter 05 made an update from an old version fail with a 409 and return the saved note as `current`. This chapter's screen shows that conflict to the user. It keeps your input in the fields, displays the saved content beside it, and asks you to choose between saving again with your input and taking the saved content. The app never decides by itself which one to keep.
