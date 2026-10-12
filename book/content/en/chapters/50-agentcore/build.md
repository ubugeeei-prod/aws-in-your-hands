---
title: "50 AgentCore: Design and Build"
---

# 50 AgentCore: Design and Build

This page starts by wrapping chapter 36's loop in AgentCore Runtime's HTTP contract, then implements the three boundaries named on the [first page](/en/chapters/50-agentcore.md) in turn (who is calling, the session, memory), and ends with the stack.

## The HTTP Shape the Runtime Asks For

<!-- section: 50.contract -->

What the Runtime asks of an agent is an HTTP server listening on `0.0.0.0:8080` and two paths. `GET /ping` says whether the agent is alive, and `POST /invocations` takes an invocation. AgentCore does not define what the body of `/invocations` contains. The documentation's example is `{"prompt": "..."}`, but each agent decides its own.

This chapter's body is one prompt.

<<< @/examples/50-agentcore/src/contract.ts{payload}

Because it is a `v.strictObject`, a body that adds `owner` or `messages` gets a 400. The prompt is limited to a string on the advice of AgentCore's security guide. Some frameworks pass a `toolUse` block found in the input straight on to tool execution, and the guide asks you to check that `prompt` is a string. This chapter's loop only ever treats the input as a string, but it is refused at the door all the same.

`/ping` is one line.

<<< @/examples/50-agentcore/src/agent.ts{ping}

Besides `Healthy`, `status` can be `HealthyBusy`, and while an agent answers `HealthyBusy` the Runtime treats the session as in use and does not end it. The value is for agents that keep working in the background. This chapter's agent does nothing outside an invocation, so it always answers `Healthy`. An agent that kept answering `HealthyBusy` by mistake would keep its session alive to the maximum lifetime, with its memory billed all the while.

`/invocations` checks the request and then calls chapter 36's loop. The checks run in the following order, and when any of them refuses, the model is not called.

<<< @/examples/50-agentcore/src/agent.ts{guard}

The call into the loop is almost the same as in chapter 36's `app.ts`.

<<< @/examples/50-agentcore/src/agent.ts{invoke}

The tools are chapter 36's `createNoteTools`, made for this request's user. None are kept ready in the session. The answer is the same events as in chapter 36 (`delta`, `tool`, `done`, `error`), sent as server-sent events. The Runtime's HTTP contract allows both a JSON response and a `text/event-stream` response.

## Who Is Calling

<!-- section: 50.identity -->

The stack gives the Runtime a JWT authorizer and lets the `Authorization` header through to the agent. The agent reads the user from the token it receives.

<<< @/examples/50-agentcore/src/identity.ts{claims}

<<< @/examples/50-agentcore/src/identity.ts{forwarded}

This function does not check the signature. It rests on the documentation's account that the Runtime has done the check, and that the only requests reaching port 8080 of the microVM are those that came through the Runtime. AWS's own walkthrough also says the agent may skip signature validation. The issuer and the client ID are compared so that the code stops if the authorizer's settings and its own ever disagree; that is no substitute for a signature. A test deliberately pins that this function accepts a token with a nonsense signature, so that nobody takes it for a verifier and uses it somewhere else.

Outside the Runtime this function proves nothing. The local server uses chapter 06's local sign-in, which does verify a signature. Both have the shape of chapter 06's `Authenticate`, so the body of the agent does not know which one it was given.

## Tying a Session ID to Its Owner

<!-- section: 50.session-id -->

To the Runtime a session ID is a string of 33 characters or more and nothing else. This chapter adds one rule about how an ID is made: its first 32 characters come from the SHA-256 of the user's ID.

<<< @/examples/50-agentcore/src/session-id.ts{session-id}

On every request the agent computes the digest again from the token's `sub` and compares it with the start of the session ID. If they differ, it answers 403. The digest is not a secret. The point is that Bob may know Alice's session ID, and still cannot use it, because Bob's `sub` does not produce the same prefix.

The first design kept, inside the process, the user who opened the session first. With that, whoever calls first after a microVM is replaced becomes the owner. If Bob called first with Alice's session ID, the conversation would not leak, but Alice would be locked out of her own session. With the owner in the ID itself there is nothing to remember, and the answer does not change when the process is replaced.

Bob's request has reached Alice's microVM by the time it is refused, because the Runtime routes on the session ID alone. The agent is written in an order that never touches the session's state before the user has been checked. The same rule has to be followed on the client's side, where session IDs are made, and `newSessionId` is what the script and the local server use.

## A Session's Memory

<!-- section: 50.memory -->

Answering the second question of a conversation takes the exchange of the first. This chapter records an exchange as one kind of event, and holds the state as the result of folding the events.

<<< @/examples/50-agentcore/src/session.ts{event}

<<< @/examples/50-agentcore/src/session.ts{reduce}

`reduce` accepts only the event with the next number. An event that arrives twice (a retried write) and a number that skips ahead (an event in between was lost) both leave the state as it was. So the state comes out the same whatever order the store returns events in, and however many times. The last 6 exchanges are remembered, and an answer is cut at 2,000 characters. Remembered exchanges are sent to the model again with every later question, so this is what bounds the tokens of one question.

What is remembered is the user's question and the text of an answer the model finished writing. The content of notes that the tools returned is not remembered. If a later question needs it, the note is read again, for whoever is asking then. An answer that was cut short is not remembered, and neither is one that a guardrail stopped.

<<< @/examples/50-agentcore/src/session.ts{history}

Chapter 36's loop starts a conversation from one question. The loop is left alone. The way in to the model is wrapped instead, to put the remembered exchanges in front.

<<< @/examples/50-agentcore/src/history.ts{with-history}

The process's memory goes away with the session's microVM. With the stack's settings that happens after 5 idle minutes. So that the conversation can still go on, the events are written to the short-term memory of AgentCore Memory. Every call of the store's interface takes an actor.

<<< @/examples/50-agentcore/src/memory-store.ts{store}

The first time the process sees a session, the agent reads its events from the store and builds the state.

<<< @/examples/50-agentcore/src/agent.ts{open}

When an answer is complete, the agent writes to the store first and moves the process's state forward only if the write succeeded (`remember`, in `invoke` above). When the store refuses, the user still gets the answer, and the log says the exchange was not remembered. This way, what the process remembers is always the fold of the events the store accepted, and the conversation does not diverge when the microVM is replaced. Writes go one at a time per session. Writing the tests showed that two answers finishing together took the same number, and one of them vanished from the store.

The mapping to AgentCore Memory is two pure functions.

<<< @/examples/50-agentcore/src/memory-events.ts{write}

<<< @/examples/50-agentcore/src/memory-events.ts{read}

`clientToken` is there so that an exchange written twice is stored once. The SDK's type definitions say that when the token matches a previous request, AgentCore ignores the request without returning an error. The reading side checks once more that each returned event belongs to the actor and the session it asked for. Only the following adapter calls AWS, and neither the local server nor the tests use it.

<<< @/examples/50-agentcore/src/agentcore-memory.ts{adapter}

This chapter uses short-term memory only. Long-term memory has a model extract things such as a user's preferences or a summary from the events and stores them, and the extraction runs asynchronously in the background. There are four built-in strategies (user preferences, semantic, session summaries, episodic). With it, what came up in a conversation outlives the session, so it is a feature to turn on after deciding what stays and when it goes.

## The Stack

<!-- section: 50.stack -->

The stack creates the Runtime, the Memory, the execution role, the notes table, and a user pool with a client.

The agent's code is bundled into one `app.js` by esbuild during synth.

<<< @/examples/50-agentcore/infra/lib/bundle.ts{bundle}

<<< @/examples/50-agentcore/infra/lib/agentcore-stack.ts{code}

The `bundling` setting of `s3assets.Asset` is normally for building inside a container, but when `local.tryBundle` succeeds no container is started. It is the same flow as `NodejsFunction` in `lambda-nodejs` calling esbuild during synth, written out by hand here. The output is CommonJS because the ZIP has no `package.json` in it, and Node.js loads a `.js` file as CommonJS then.

The Runtime.

<<< @/examples/50-agentcore/infra/lib/agentcore-stack.ts{runtime}

Without `authorizerConfiguration`, the Runtime takes invocations by IAM signature (SigV4). A Runtime takes either IAM or a JWT, not both. With IAM, what reaches the agent is no more than "this IAM principal called"; who the app's user is does not arrive. `PUBLIC` for `networkMode` is about the agent's outgoing traffic. It does not mean that anyone can call it.

`lifecycleConfiguration` shortens the idle timeout from the default 15 minutes to 5, and the maximum lifetime from 8 hours to 1. Memory is billed until the session ends, so idle time is cost. Make it too short, and the microVM is gone while a user is still thinking, and the next question pays for a start and for reading Memory again.

No platform version is given, so it is the default, V1. V2 is a newer mode that starts from a snapshot of a prepared environment, and it is available in Tokyo. The documentation says that CloudFormation and the CDK do not yet support setting `platformVersion`, while `CfnRuntime` in the pinned `aws-cdk-lib` (2.273.0) has that property. Which is right was not settled by a deployment, so this chapter leaves it alone.

The user pool is a small one, for this chapter only.

<<< @/examples/50-agentcore/infra/lib/agentcore-stack.ts{users}

It has no sign-in page and no password API that can be called from the internet. A token is obtained with `AdminInitiateAuth` by an IAM identity of this account. That is a shortcut for checking the deployment. A real app would name chapter 06's client here.

The Memory is a resource with no strategy at all: short-term memory only.

<<< @/examples/50-agentcore/infra/lib/agentcore-stack.ts{memory}

The execution role.

<<< @/examples/50-agentcore/infra/lib/agentcore-stack.ts{role}

The trust policy lets `bedrock-agentcore.amazonaws.com` assume the role only for a resource of this account and Region. The statements for logs and metrics are the ones the Runtime guide lists for an execution role. The guide also lists X-Ray actions and `logs:PutResourcePolicy`; this chapter configures neither tracing nor log delivery, and leaves them out. Whether the Runtime starts without them was not checked.

The permissions on the notes table and on the Memory cover the whole table and the whole Memory. The execution role can read any user's notes and any actor's events. IAM cannot narrow it further, so the code does. The stack's tests stop changes that would undermine that premise (a write permission appearing, a new `*`).

<<< @/examples/50-agentcore/infra/test/agentcore-stack.test.ts{resource-types}

The pinned cdkd (0.296.28) has an implementation of its own for `AWS::BedrockAgentCore::Runtime`. The properties that implementation writes do not include `RequestHeaderConfiguration`, though, and cdkd sends a resource with a property its own implementation does not handle through Cloud Control API. `AWS::BedrockAgentCore::Memory` and `AWS::Cognito::UserPoolClient` have no implementation of their own and go through Cloud Control API as well. The user pool, the table, the role and the policy each have one.
