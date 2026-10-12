---
title: "50 AgentCore: A Runtime, Memory, Tools, and Identity for Agents"
sourceRevision: 1
---

# 50 AgentCore: A Runtime, Memory, Tools, and Identity for Agents

In [chapter 36](/en/chapters/36-bedrock.md) you wrote the loop that lets a model use tools, and ran it on Lambda. Amazon Bedrock AgentCore is a set of services that takes over the place where that loop runs and what it needs around it: an execution environment per session, memory, a way in to tools, authentication, and observability. This chapter has one point to make. Hand the loop to AgentCore, and it is still your code that decides whom the agent is working for. AgentCore separates sessions with microVMs, but it does not check whose session it is.

This chapter keeps chapter 36's loop and tools as they are, wraps them in the HTTP shape AgentCore Runtime asks for, and keeps the conversation's memory in AgentCore Memory. It uses no framework. The code is in `examples/50-agentcore/`, and it talks to the model through chapter 36's `ModelGateway`.

You pay for what you use, and this chapter's stack costs nothing from AgentCore while it has no session. A session does live on after its last invocation for as long as it is idle, though, and its memory is billed for that time. The amounts are on the [costs page](/en/chapters/50-agentcore/wrap.md). This chapter's stack has never been deployed to AWS, so everything said here about how AgentCore behaves comes from the documentation as read on 2026-10-13.

You need chapter 36's loop, the sign-in from [chapter 06](/en/chapters/06-auth.md), and least privilege from [chapter 21](/en/chapters/21-security.md). The models themselves are the subject of [chapter 56](/en/chapters/56-nova.md), and running a coding agent in isolation is [chapter 63](/en/chapters/63-agent-sandbox.md).

## What AgentCore Is

<!-- section: 50.what -->

AgentCore became generally available on October 13, 2025. Its documentation describes a platform for agents that works with any framework and any model, and its parts can be used separately. It is a different service from the API that calls Bedrock models (the Converse API of chapters 17 and 36): the endpoints are different, and so is the prefix of its IAM actions (`bedrock-agentcore:`).

In Tokyo (`ap-northeast-1`), the Regions table lists every part as available on 2026-10-13 except the payments feature (AgentCore payments).

There are two ways to hand over an agent's code. One is a container image (ARM64, up to 2 GB), and the other is code in a ZIP archive (direct code deployment). The runtimes for a ZIP are Python 3.10 to 3.14 and Node.js 22, and for Node.js the entry point is a `.js` file that is an HTTP server with `/invocations` and `/ping`. TypeScript does not run as it is, so it goes in as JavaScript. This chapter chose the ZIP, because everything from the bundle to synth can then be checked locally with no Docker daemon in the Nix shell.

On frameworks, the documentation names LangGraph, Strands Agents, CrewAI and others, and says an agent that uses no particular framework is fine too. All the Runtime asks of your code is the HTTP contract. There is a TypeScript SDK (`bedrock-agentcore` on npm) and a CLI that can create TypeScript projects (`@aws/agentcore`), but this chapter uses neither. The contract is small enough for chapter 04's parts.

## The Parts

<!-- section: 50.components -->

These are the names on the documentation's overview page. The last column says whether this chapter's stack uses the part.

| Name | What it is for | This chapter |
| --- | --- | --- |
| Runtime | Runs the code of an agent or a tool in a microVM per session | Used |
| Memory | Keeps the events of a conversation (short-term memory) and records extracted from them (long-term memory) | Short-term memory only |
| Identity | Decides who may call an agent, and keeps the credentials an agent uses to call outside services | Used as the Runtime's JWT check |
| Gateway | Puts APIs, Lambda functions and existing MCP servers behind one entrance as MCP tools | Not used |
| Observability | Sends metrics, logs and spans to CloudWatch | Default metrics and logs only |
| harness | You declare a model, tools and instructions, and AgentCore runs the loop | Not used |
| Code Interpreter | A sandbox that runs code the agent wrote | Not used |
| Browser | A browser the agent operates | Not used |
| Policy | Allows or denies tool calls that pass through a Gateway, by policy | Not used |
| Evaluations, Optimization | Evaluate an agent's output and propose configuration changes | Not used |
| Registry | A catalog of an organization's agents, MCP servers and tools | Not used |
| Payments | Lets an agent make small payments to paid APIs | Not available in Tokyo |

Whether each part is generally available or in preview was checked in the release notes and announcements. The service as a whole became generally available in October 2025, Policy and Evaluations in March 2026, harness on June 17, 2026, and Registry in August 2026. No statement names Memory on its own, but there is no preview note on it either. Within Optimization, Failure Insights is in public preview. For the Runtime's Instances (the mode that runs on EC2 in your own account) and for platform version V2, no statement of general availability or preview was found.

A few of the Runtime's numbers matter to this chapter. All were read on the quotas page on 2026-10-13 and can change. The current values are in [Quotas for Amazon Bedrock AgentCore](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/bedrock-agentcore-limits.html).

- One session gets at most 2 vCPU and 8 GB
- A synchronous request lasts up to 15 minutes, a stream up to 60 minutes, and a payload is at most 100 MB
- A session ends after 15 idle minutes, or 8 hours after it started (both can be configured)
- An account can run 2,500 sessions at once in Tokyo (an increase can be requested)
- 25 new sessions per second, and 1,000 requests per second across the data plane APIs
- A ZIP is at most 250 MB compressed and 750 MB uncompressed

## What Changes from Chapter 36's Loop

<!-- section: 50.takes-over -->

In chapter 36, a Lambda function URL took the request and the loop ran inside the function. In this chapter the loop and the tools are the same files. What changes is everything outside them.

```figure
caption: The client calls AgentCore Runtime, and the Runtime calls the agent inside the session's microVM
node client: Client | access token
node runtime: AgentCore Runtime | JWT authorizer
node agent: Agent process | session microVM
node model: Bedrock | ConverseStream
node notes: DynamoDB | notes
node memory: AgentCore Memory | events
edge client -> runtime: InvokeAgentRuntime
edge runtime -> agent: POST /invocations
edge agent -> model: chapter 36's loop
edge agent -> notes: Query, GetItem
edge agent -> memory: CreateEvent, ListEvents
group aws: AWS account = runtime, agent, model, notes, memory
mark agent
```

AgentCore takes over the following.

- **A place to run.** You hand over code, and the Runtime prepares a microVM, starts the code as an HTTP server on port 8080, and calls it with `POST /invocations`. Scaling and patching (for a ZIP, up to and including the Node.js runtime) become AWS's work
- **Session isolation.** Each session ID gets a microVM of its own, with separate CPU, memory and file system. When the session ends, the microVM is destroyed. On Lambda, one execution environment handled different users' requests one after another
- **Long sessions.** Invocations with the same session ID reach the same microVM, so the conversation's state can live in the process's memory or in files. A microVM lives for up to 8 hours
- **Authentication at the door.** In front of the Runtime, either an IAM signature or a JWT is checked. In chapter 06 that was the work of API Gateway's JWT authorizer
- **Memory.** Memory stores events per actor and session. You do not design a table for it
- **Observability.** Metrics for the number and duration of invocations, and the standard output as logs, go to CloudWatch

In return, some things are no longer yours to decide, or to see.

- The HTTP shape is fixed. The port is 8080, the paths are `/invocations` and `/ping`, and the architecture is ARM64 only. The only Node.js for a ZIP is 22, not the 24 the rest of this book uses
- When a microVM is created and when it goes away can be steered only through two timeouts. What you keep in the process's memory disappears once the session has been idle long enough
- A 4xx or 5xx that the agent itself returns reaches the caller as 424 (`RuntimeClientError`), according to the documentation. The status code you chose does not arrive at the client as it is
- Every session of every user runs as one execution role. Code inside the microVM can get that role's credentials from the metadata service. Nothing on the IAM side separates one user's permissions from another's

The last point is the subject of the next section.

If you want to hand over the loop itself, there is harness. You declare a model, tools and instructions, AgentCore runs the loop, and a microVM of the Runtime is where it runs. Tools can be MCP servers, a Gateway, the Browser, the Code Interpreter, or inline functions that run on the caller's side. This chapter does not use harness because chapter 36 decided, step by step, what stops the loop, and that should stay visible.

## Where the Boundary Is

<!-- section: 50.boundary -->

The invariant carried over from chapter 36 is: an agent acting for a user reaches only that user's notes. Chapter 36 held it by fixing the owner when the tools are made and by never letting the model's input name an owner. Moving the loop into the Runtime adds three places where the same condition can be threatened.

The first is who is calling. The Runtime's JWT authorizer checks the token's signature, issuer and client. If you configure the Runtime to pass the checked token on to the agent's code (by putting `Authorization` in the request header allowlist), the code can read the token's `sub`. The owner is that `sub`, never a value written in the request body. The Runtime has another way to pass a user's ID, in a header (`X-Amzn-Bedrock-AgentCore-Runtime-User-Id`), but the documentation states that this value is not verified, and this chapter does not use it.

The second is the session. The Runtime picks a microVM by session ID, but the documentation says that AgentCore does not enforce the mapping between sessions and users, and that the client's backend should keep it. When Bob, holding a valid token, calls with Alice's session ID, the Runtime delivers the request to Alice's microVM. Alice's conversation is still in it.

```figure
type: sequence
caption: The Runtime checks the token and does not look at whose session ID it is. The agent's code is what refuses
actor bob: Bob
actor runtime: Runtime
actor agent: Agent | Alice's session
step bob -> runtime: Bob's token, Alice's ID
note runtime: owner of the ID not checked
step runtime -> agent: POST /invocations
step agent -> agent: ownsSession(sub, id)
step agent -x bob: 403
```

This chapter makes it a rule that a session ID starts with a digest of its owner's ID, and the agent checks that on every request. Another user's session ID is of no use even to someone who knows it.

The third is memory. Memory's events are divided by actor and session, and IAM has a condition key, `bedrock-agentcore:actorId`. But a condition key is matched against the IAM principal that calls Memory, and in this setup that is the same execution role for every user's session. The documentation says so too: IAM conditions cannot express a JWT's user. Which actor's events are read is decided by the agent's code, from the checked `sub`.

In short, the boundary AgentCore draws is between one session and another, not between one user and another. The boundary between users is drawn by your own code, by carrying the token's `sub` to three places in the same way: the tools, the session ID, and Memory's actor. [Design and Build](/en/chapters/50-agentcore/build.md) shows those three places and the tests that try to break them.

## When to Use It, and When Not

<!-- section: 50.when -->

AgentCore Runtime fits when a conversation goes back and forth many times and you want its state in a process or in files, when the work does not fit in Lambda's 15 minutes, and when the agent runs code it wrote or drives a browser, so that sessions must be kept firmly apart.

For questions that are each complete in themselves, chapter 36's Lambda is enough. It has fewer parts, and it bills only for the time of the call. If all you need is the history of a conversation, you can also add one DynamoDB item to chapter 36's design.

A Gateway helps when several agents use the same tools, or when you want to show an existing API as MCP tools. This chapter has two tools, and they live in the agent's own process, so they do not go through a Gateway. If they did, you would need a separate path that carries the user's ID to the tool. For a Lambda target, the values the documentation lists as passed to the function are the tool's input and the names of the Gateway and the tool, and nothing that identifies the user. To pass the `Authorization` header to a target, it says to add an interceptor Lambda.

Cloudflare and Vercel have features for agents too. Their documentation was read on 2026-10-13.

Cloudflare's Agents maps each agent to a Durable Object. Each agent has its own SQLite database, can hold WebSocket connections and scheduled work, sleeps while idle, and is not billed for that time. State lives where the agent does, so no separate service plays the part of Memory. The unit of isolation is the Durable Object, not a microVM per session as in AgentCore. For running arbitrary code there is a separate Sandbox SDK. If your app is already on Workers and the agent only calls your own APIs and a model, Agents gets you there with fewer parts.

On Vercel, the AI SDK provides the loop as a component (`ToolLoopAgent`). Vercel Sandbox (Firecracker microVMs) is a place to run untrusted code, and it shares one idea with AgentCore Runtime: time spent waiting for I/O does not count as CPU. Workflow covers work that stops and resumes. A single product that hosts an agent in a microVM per session was not found in what was read.

What speaks for AgentCore is that the agent reaches data inside AWS through an IAM role, with no keys handed out, and that microVMs per session, memory and authentication all sit in the same account. More parts also means, as this chapter shows, more boundaries to carry through yourself.
