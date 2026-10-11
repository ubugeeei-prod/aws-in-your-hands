---
title: "00 Welcome: What You Will Build and How to Read"
sourceRevision: 1
---

# 00 Welcome: What You Will Build and How to Read

There is nothing to run in this chapter. It covers what the book builds, what order to read it in, and what each chapter commits to.

## What you will build

<!-- section: 00.build -->

The subject is a small notes app that accepts image attachments. It starts as a published static SPA and gains one feature at a time.

```text
03  Browser -> CloudFront -> S3 (SPA)
04  Browser -> API Gateway HTTP API -> Lambda
05                                      Lambda -> DynamoDB
06  Browser -> Cognito (login)          API checks whose note it is
07  Browser -> S3 (presigned upload)
08  S3 event -> SQS -> Lambda (thumbnail)
```

Chapters 03 through 06 are written. Chapter 07 onward is planned.

The features are not stacked into one large sample. Each chapter has its own `examples/<chapter number>-<name>/` directory, which contains only what that chapter needs to explain. Email, AI, live streaming, and celld will be recipes you can work through independently of the notes app.

## Reading order

<!-- section: 00.paths -->

The shortest path is to read 00 through 08 in order and then add logs and metrics in chapter 19. Not everyone needs to take that path.

| Path | Chapters | Best for |
| --- | --- | --- |
| Shortest | 00 → 01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 19 | You want to build the whole notes app |
| SQL | 00 → 01 → 02 → 04 → 13 → 22 | Your data is relational and you want to write SQL |
| SSR | 00 → 01 → 02 → 03 → 04 → 09 → 10 | You want server rendering with Nuxt or similar |
| Containers | 00 → 01 → 02 → 11 → 12 → 16 | You want to run an existing container |

Every path needs chapters 01 and 02. Chapter 01 gets your account into a state that is safe to use, and chapter 02 builds the environment in which every command in this book runs.

If you want to write SQL against your data, you do not have to force it into DynamoDB in chapter 05. Once you finish chapter 04, you can go on to chapter 13. If you also want to try RDS or Aurora Serverless v2 there, you need the network from chapter 11 first.

The paths for people who know Cloudflare D1, Workers, and Workers AI are collected in [Coming from Cloudflare](/en/guides/cloudflare.md).

## What each chapter commits to

<!-- section: 00.conventions -->

A hands-on chapter contains the following. Short chapters leave out the items that do not apply.

1. The chapter's outcome and prerequisites
2. A small architecture diagram showing what runs where
3. Why this architecture was chosen, and the conditions under which you would choose another
4. The complete source that the explanation refers to
5. Running locally, type checking, and tests, along with what cannot be reproduced locally
6. The steps for reviewing the diff, deploying, checking that it works, and detecting drift
7. Cost: while idle, while in use, and after deletion
8. Failure cases and how to investigate them
9. What to change before taking it to production
10. Cleanup, and what remains afterward
11. What the types protect, what is validated at run time, and which invariants are tested

The whole book follows these rules.

**Commands are run as `vp run <task name>`.** Tasks are defined in `vite.config.ts` at the repository root and are run from the root. `vp` is the CLI of a toolchain called Vite+, which chapter 02 installs.

**A task that touches AWS says so.** Tasks fall into two groups: those that stay entirely within this repository, and those that read or change AWS. A task in the second group prints the target account and Region before it runs.

**Verification has three states.**

| State | Meaning |
| --- | --- |
| unverified | Written, but not run |
| verified locally | Run on a local machine, and passed |
| verified in AWS | Run in a real AWS account, and passed |

Passing locally is not evidence that something works in AWS. IAM permissions, CDN behavior, and behavior under concurrency cannot be checked on your own machine. Writing progress (planned, complete) and verification state are recorded as separate things.

**Prices come with their assumptions.** Every amount is accompanied by its Region, the source of the unit price, the date it was checked, and the assumed usage. The calculations are on the [Pricing Worksheets](/en/reference/pricing.md) page, where you can change the inputs and recalculate. A price that could not be confirmed is written as "unknown", not filled in with 0 or a guess.

**No time estimates.** The book does not offer durations it has not measured as a guide.

## What this book uses

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

The book does not use AWS Amplify. Using CDK and the SDK directly makes it easier to follow what gets created where.

One note about cdkd up front. cdkd is a tool that applies CDK code to AWS without going through CloudFormation. Its official documentation describes it as intended for development and testing, and recommends the AWS CDK CLI for production. This book uses cdkd because it suits short iterations while learning. The standard path for production is planned for chapter 20. Chapter 02 explains the details.

## Next

Continue to [01 Accounts, Temporary Credentials, Regions, Budgets, and Cleanup](/en/chapters/01-account.md).

## Source map for this chapter

| Section | Corresponding files |
| --- | --- |
| What you will build, Reading order | `data/chapters.json` (IDs, prerequisites, and reading paths for all chapters) |
| What each chapter commits to | `docs/EDITORIAL.md`, `data/validation.json` |
| What this book uses | `data/toolchain.json`, `flake.nix`, `package.json` |
