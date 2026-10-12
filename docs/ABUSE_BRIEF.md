# Brief: bounding every public endpoint

The author's words: 「全体的にボットからのスパイクアクセスとセキュリティには本当に気をつけたい」.

A reader deploys an example into their own account and gets a public endpoint. A bot spike must not be able to run up an unbounded bill, take the endpoint down for good, or fill a store that then costs money every month. An audit found that almost nothing bounds requests today: the only backstop is the chapter 01 budget email (USD 10, 8 to 12 hours late).

## What to change

Free bounds go in by default. Bounds that cost money stay opt-in, with the worst case and the switch written in the prose.

1. **API Gateway HTTP APIs: throttle the default stage.** Keep the default stage (so logical IDs and `api.url` stay as they are) and set the route settings on it:

   ```ts
   // Requests per second the API accepts, and how far a burst may go past it. Beyond that: 429.
   const THROTTLE = { rate: 10, burst: 20 } as const;
   const stage = api.defaultStage?.node.defaultChild as apigwv2.CfnStage;
   stage.defaultRouteSettings = { throttlingRateLimit: THROTTLE.rate, throttlingBurstLimit: THROTTLE.burst };
   ```

   Use these numbers everywhere unless a chapter has a reason not to, and say what they bound: 10 per second is at most 25.92 million requests in a 30-day month. Work the monthly worst case out from the chapter's own prices (its pricing section, `examples/NN/src/cost.ts` or `data/pricing/`), and state it in the chapter's 「お金の話」.

2. **Stores that anyone can write to get a cap.** Chapter 13 caps rows per owner (`MAX_NOTES_PER_OWNER`); copy that shape. In-memory repositories refuse past a fixed number of notes. DynamoDB on-demand tables get `maxReadRequestUnits` / `maxWriteRequestUnits`.

3. **Lambda reserved concurrency is opt-in, not default.** A new AWS account can have a concurrency limit so low that reserving any fails the deploy, and this cannot be verified here. Offer it as a CDK context value (`-c reservedConcurrency=N`, validated like the chapter's other context) for functions that API Gateway throttling does not cover (function URLs behind CloudFront, Lambda@Edge is excluded), and explain when to turn it on.

4. **Say what happens when it is hammered.** Each chapter with a public endpoint gets a short, concrete passage (in 「ハマりどころ」 or 「お金の話」, whichever fits): who can call it, what stops a flood, the worst case in requests and USD from numbers in the repository, and what a reader should add before real traffic (AWS WAF and its price as chapter 21 gives it, auth, a CloudFront flat-rate plan only where the repo already has a source for it). No invented prices or quotas: where a number is not in the repository, say it is not verified here.

## Rules

- Follow `CONTRIBUTING.md` and `docs/CHAPTER_BRIEF.md`. CDK services are namespace imports (`apigwv2.CfnStage`). Code comments say why, briefly.
- Every stack has tests that pin its template. Update them, and add a test for each new bound that fails if the bound is removed (throttle present on the stage, cap enforced at N+1, etc.).
- Prose: both languages, same structure (`node tools/src/checks/content.ts` compares them). Chapters are now several pages: `book/content/{ja,en}/chapters/NN-slug.md` (opening) and `NN-slug/{build,more,local,deploy,wrap}.md`. Where the prose says something the code no longer does (for example 「本番にするなら」 listing throttling as future work), fix the prose. Keep the book's voice: plain, conversational, no marketing words.
- Do not touch `data/`, `book/theme/`, `book/site.ts`, `vite.config.ts`, or chapters outside your list. Report what should be recorded in `data/validation.json` instead of editing it.
- Verify with tests and type checks for your examples only, for example `nix develop -c vp test run examples/04-http-api` and the chapter's `typecheck` task, plus `node tools/src/checks/content.ts`. Do not run `vp run check:all`, `vp run build:book`, or anything that reaches AWS. Do not commit or push.
- Nothing has been deployed. Do not write as if it had: whether cdkd 0.296.28 applies `DefaultRouteSettings` and the DynamoDB throughput caps is not verified, and the chapter's verification memo must say so.
