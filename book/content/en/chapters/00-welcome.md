---
title: "00 Introduction: What You Will Build and How to Read"
sourceRevision: 3
---

# 00 Introduction: What You Will Build and How to Read

There is nothing to run in this chapter yet. It explains what the book builds, what order to read it in, and the conventions every chapter is written to.

## What you build

<!-- section: 00.build -->

The subject is a small notes app that accepts image attachments. It starts as a published static SPA, and each chapter adds one feature. The two figures below show which chapter adds what.

```figure
caption: The number on each arrow is the chapter that adds that part to the notes app.
node browser: Browser
node api: API Gateway HTTP API
node cf: CloudFront
node cognito: Cognito
node lambda: Lambda
node s3: S3 | SPA
node ddb: DynamoDB
edge browser -> cf: 03
edge cf -> s3: 03
edge browser -> api: 04
edge api -> lambda: 04
edge lambda -> ddb: 05
edge browser -> cognito: 06 login
group app: 06 API checks whose note it is = api, lambda
```

```figure
caption: In chapter 07 the browser uploads an image to S3, and in chapter 08 an S3 event leads to a Lambda function that checks the image.
direction: right
node browser: Browser
node s3: S3
node sqs: SQS
node lambda: Lambda | image check
edge browser -> s3: 07 presigned upload
edge s3 -> sqs: 08 S3 event
edge sqs -> lambda: 08
```

There are 68 chapters, numbered 00 through 68 with no chapter 65. All of them are written.

The features are not stacked into one large sample, though. Each chapter has its own `examples/<chapter number>-<name>/` directory, which holds only what that chapter needs for its explanation. Among the chapters up to 24, four can be worked through apart from the notes app: email ([chapter 15](/en/chapters/15-email.md)), AI ([chapter 17](/en/chapters/17-ai.md)), live streaming ([chapter 18](/en/chapters/18-live.md)), and celld ([chapter 24](/en/chapters/24-celld.md)).

## Reading order

<!-- section: 00.paths -->

Chapters 00 through 24 are written to be read in order. The sidebar arranges them in seven groups: Get Ready (00-02), Build the App (03-08), Choose Where It Runs (09-12), Store Data (13-14), Add Features (15-18), Operate It (19-22), and Run Your Own Servers (23-24).

Chapters from 25 on stand on their own. Each one names the chapters it builds on at its start, so once you have read those you can take it out of numerical order. The sidebar groups these chapters by subject, not by number.

| Sidebar group | Chapters from 25 on |
| --- | --- |
| Add Features | 51 |
| Run Your Own Servers | 64, 66, 67, 68 |
| Connect Services | 25, 61, 54, 47 |
| Deeper into Data | 30, 59, 60, 39, 58, 53, 38 |
| Analyze | 26, 49, 43, 27 |
| Deeper into AI | 36, 56, 50, 57 |
| Deeper into Compute | 29, 35, 41, 52, 34 |
| Protect and Prepare | 42, 46, 44, 28, 40 |
| Tune It | 31, 32, 55 |
| Developer Tools | 48, 37, 45, 62, 63 |
| Go to Production | 33 |

Add Features and Run Your Own Servers are groups from the first 24 chapters, and chapters 51, 64, 66, 67, and 68 continue them. Of these, [chapter 67](/en/chapters/67-firecracker.md) and [chapter 68](/en/chapters/68-nitro.md) are about what runs underneath Lambda, Fargate, and EC2.

The shortest path is to read chapters 00 through 08 in order and then add logs and metrics in chapter 19. Depending on what you want to build, one of the other paths in this table may suit you better.

| Path | Chapters | Best for |
| --- | --- | --- |
| Shortest | 00 → 01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 19 | You want to build the whole notes app |
| SQL | 00 → 01 → 02 → 04 → 13 → 22 | Your data is relational and you want to write SQL |
| SSR | 00 → 01 → 02 → 03 → 04 → 09 → 10 | You want server rendering with Nuxt or similar |
| Containers | 00 → 01 → 02 → 11 → 12 → 16 | You want to run an existing container |

Every path goes through chapters 01 and 02. Chapter 01 gets your account into a state that is safe to use, and chapter 02 builds the environment in which every command in this book runs.

If you want to write SQL against your data, you don't have to force it into DynamoDB in chapter 05. Once you finish chapter 04, you can go straight to chapter 13. If you also want to try RDS or Aurora Serverless v2 there, you need the network from chapter 11 first.

You can move on to a chapter from 25 on as soon as you have read the chapters it builds on. If you have finished the shortest path, for example, chapter 30 follows from chapter 05, chapters 61 and 25 from chapter 08, and chapter 29 from chapters 04 and 19. The review before going to production is in chapter 33, which builds on chapters 19 through 22.

Paths for readers who know Cloudflare D1, Workers, and Workers AI are collected in [Coming from Cloudflare](/en/guides/cloudflare.md).

## The conventions of this book

<!-- section: 00.conventions -->

A hands-on chapter covers roughly the following. A chapter leaves out the items that don't apply to it.

1. What you will be able to do by the end, and the prerequisites
2. A small architecture diagram showing what runs where
3. Why this architecture was chosen, and the conditions under which you would choose another
4. The complete source that the explanation refers to
5. Running locally, type checking, and tests, along with what cannot be reproduced locally
6. The steps for reviewing the diff, deploying, checking that it works, and detecting drift
7. What it costs while idle, while in use, and after deletion
8. Failure cases and how to investigate them
9. What to change before taking it to production
10. Cleanup, and what remains afterward
11. What the types protect, what is validated at run time, and which invariants are tested

Beyond that, the whole book keeps five rules.

First, you run commands as `vp run <task name>`. Tasks are defined in `vite.config.ts` at the repository root, and you run them from the root. `vp` is the CLI of a toolchain called Vite+, which you install in chapter 02.

Second, a task that touches AWS says so. Some tasks stay entirely within this repository, and others read or change AWS. A task that touches AWS prints the target account and Region before it runs.

Third, verification has three states.

- unverified: written, but not run
- verified locally: run on a local machine, and passed
- verified in AWS: run in a real AWS account, and passed

Passing locally is not evidence that something works in AWS, because IAM permissions, CDN behavior, and behavior under concurrency can't be checked on your own machine. Writing progress (planned, complete) is recorded separately from the verification state.

Fourth, prices come with their assumptions. Every amount carries its Region, the source of the unit price, the date it was checked, and the assumed usage. The calculations are on the [Pricing Worksheets](/en/reference/pricing.md) page, where you can change the inputs and recalculate. A price that could not be confirmed is written as "unknown", not filled in with 0 or a guess.

Fifth, there are no time estimates. The book does not offer durations it has not measured as a guide.

## The tools

<!-- section: 00.stack -->

| Purpose | Tool |
| --- | --- |
| Development environment | Nix (flake and devShell) |
| Installing dependencies and running tasks | Vite+ (`vp`) and pnpm |
| Defining infrastructure | TypeScript and AWS CDK v2 |
| Creating and updating infrastructure | cdkd |
| Calling AWS from the app | AWS SDK for JavaScript v3 |
| Frontend examples | Vue and Vite, with Vize compiling, type-checking, and linting `.vue` files |
| This book's site | Ox Content, S3, CloudFront |

Calculations use the Tokyo Region (`ap-northeast-1`), prices in USD, and a month of 730 hours.

The book does not use AWS Amplify. With CDK and the SDK used directly, it is easier to follow what gets created where.

One caveat about cdkd belongs here. cdkd is a tool that applies CDK code to AWS without going through CloudFormation. Its official documentation describes it as intended for development and testing, and recommends the AWS CDK CLI for production. This book uses cdkd anyway, because it suits the short cycles of change and check that you go through while learning. The standard path for production is covered in [chapter 20](/en/chapters/20-shipping.md), and chapter 02 explains cdkd in detail.

## Next

Next is [01 Account: Temporary Credentials, Regions, Budgets, and Cleanup](/en/chapters/01-account.md).

::: details Verification notes for this chapter

There is nothing in this chapter to run and check.

**Where the code is.**

| Section | Files |
| --- | --- |
| What you build, Reading order | `data/chapters.json` (IDs, prerequisites, and reading paths for all chapters) |
| The conventions of this book | `docs/EDITORIAL.md`, `data/validation.json` |
| The tools | `data/toolchain.json`, `flake.nix`, `package.json` |

:::
