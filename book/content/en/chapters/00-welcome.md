---
title: "00 Welcome: What You Will Build and How to Read"
sourceRevision: 2
---

# 00 Welcome: What You Will Build and How to Read

Welcome. There is nothing to run in this chapter yet.

What does the book build? What order should you read it in? What rules does every chapter follow? Let's get those three out of the way first.

## What are we building?

<!-- section: 00.build -->

The subject is a small notes app that accepts image attachments. It starts out as nothing more than a published static SPA, and you add one feature at a time.

```text
03  Browser -> CloudFront -> S3 (SPA)
04  Browser -> API Gateway HTTP API -> Lambda
05                                      Lambda -> DynamoDB
06  Browser -> Cognito (login)          API checks whose note it is
07  Browser -> S3 (presigned upload)
08  S3 event -> SQS -> Lambda (thumbnail)
```

Chapters 03 through 06 are written. Chapter 07 onward is planned.

The features are not stacked into one huge sample. Each chapter has its own `examples/<chapter number>-<name>/` directory, and it holds only what that chapter needs to explain. Email, AI, live streaming, and celld will be recipes you can work through independently of the notes app.

## What order should you read in?

<!-- section: 00.paths -->

The shortest path is to read 00 through 08 in order and then add logs and metrics in chapter 19. Not everyone has to take that path, though.

| Path | Chapters | Best for |
| --- | --- | --- |
| Shortest | 00 → 01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 19 | You want to build the whole notes app |
| SQL | 00 → 01 → 02 → 04 → 13 → 22 | Your data is relational and you want to write SQL |
| SSR | 00 → 01 → 02 → 03 → 04 → 09 → 10 | You want server rendering with Nuxt or similar |
| Containers | 00 → 01 → 02 → 11 → 12 → 16 | You want to run an existing container |

Every path goes through chapters 01 and 02. Chapter 01 gets your account into a state that is safe to use, and chapter 02 builds the environment in which every command in this book runs.

If you want to write SQL against your data, you don't have to force it into DynamoDB in chapter 05. Once you finish chapter 04, you can go on to chapter 13. If you also want to try RDS or Aurora Serverless v2 there, you need the network from chapter 11 first.

The paths for people who know Cloudflare D1, Workers, and Workers AI are collected in [Coming from Cloudflare](/en/guides/cloudflare.md).

## The house rules

<!-- section: 00.conventions -->

A hands-on chapter covers roughly the following. Short chapters leave out the items that don't apply.

1. What you will be able to do by the end, and the prerequisites
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

On top of that, the whole book follows five rules.

**You run commands as `vp run <task name>`.** Tasks are defined in `vite.config.ts` at the repository root, and you run them from the root. `vp` is the CLI of a toolchain called Vite+, which you install in chapter 02.

**A task that touches AWS says so.** Tasks fall into two groups: those that stay entirely within this repository, and those that read or change AWS. A task in the second group prints the target account and Region before it runs.

**Verification has three states.**

- unverified: written, but not run
- verified locally: run on a local machine, and passed
- verified in AWS: run in a real AWS account, and passed

Passing locally is not evidence that something works in AWS. IAM permissions, CDN behavior, and behavior under concurrency can't be checked on your own machine. Writing progress (planned, complete) and verification state are also recorded as separate things.

**Prices come with their assumptions.** Every amount carries its Region, the source of the unit price, the date it was checked, and the assumed usage. The calculations are on the [Pricing Worksheets](/en/reference/pricing.md) page, where you can change the inputs and recalculate. A price that could not be confirmed is written as "unknown", not filled in with 0 or a guess.

**No time estimates.** The book does not offer durations it has not measured as a guide.

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

One thing about cdkd before we go on. cdkd is a tool that applies CDK code to AWS without going through CloudFormation. Its official documentation describes it as intended for development and testing, and recommends the AWS CDK CLI for production. This book uses cdkd anyway, because it suits the short iterations you do while learning. The standard path for production is planned for chapter 20. Chapter 02 goes into the details.

## Next

Let's move on to [01 Accounts, Temporary Credentials, Regions, Budgets, and Cleanup](/en/chapters/01-account.md).

::: details Verification notes for this chapter

There is nothing in this chapter to run and check.

**Where the code is.**

| Section | Files |
| --- | --- |
| What are we building?, What order should you read in? | `data/chapters.json` (IDs, prerequisites, and reading paths for all chapters) |
| The house rules | `docs/EDITORIAL.md`, `data/validation.json` |
| The tools | `data/toolchain.json`, `flake.nix`, `package.json` |

:::
