---
title: About This Book
sourceRevision: 5
---

# AWS in Your Hands

**Practical AWS for TypeScript Developers**

This book is for developers who are at home with TypeScript, HTTP, Git, and web app development, and who have not yet worked with AWS accounts, IAM, networking, pricing, or operations.

It does not ask you to leave Cloudflare or Vercel. Both are easy to start with and pleasant to develop on. The aim is to add AWS alongside them, so that you can choose by what you are building. The book does not claim that AWS is always cheaper, faster, or better.

The goal is that, when you finish, you can explain these things about what you built:

- What you built, and why you chose that architecture
- Where your code runs
- What you are charged for
- What you can check on your own machine, and what you can only check in a real environment
- What you would add before using it in production

## What is written, and what has been checked

There are 68 chapters, numbered 00 through 68 with no chapter 65. Every one has its text and its samples. Written is not the same as run and checked, though, and the checking goes only as far as what runs on a local machine.

- From [00 Introduction](/en/chapters/00-welcome.md) to [24 Self-hosting](/en/chapters/24-celld.md), every chapter passes the local checks (`vp run check:all`). Those checks are formatting and lint, type checks, tests, CDK synth, loading the Lambda bundles, and building the book and checking its links
- For the 43 chapters from 25 on, tests and other checks were run locally chapter by chapter. What was run differs by chapter. With all 68 chapters in place, `vp run check:all` passes as well (2026-10-13)
- No chapter has been deployed to AWS or run there, not even once. The post-deployment steps in the text are prepared, but they have not been run through
- This book's own site is not published yet either, and it has no public URL

What was checked locally differs by chapter. Some chapters have tests only, and for others the server was started and exercised with `curl` or a browser. A few chapters started real software locally, such as workerd in chapter 64 and YugabyteDB in chapter 66. The breakdown for each chapter is in "Verification notes for this chapter" at its end. Which commands were run, when, what passed, and what is still open are collected in the [Validation Record](/en/reference/validation.md).

## Where to start

- To read in order, start with [00 Introduction](/en/chapters/00-welcome.md). Chapters 00 through 24 are written to be read in order
- To go deeper into one subject, pick from chapter 25 on. Those chapters stand on their own and are grouped by subject in the sidebar. Each one names the chapters it builds on at its start
- If you know Cloudflare D1, Workers, and Workers AI, read [Coming from Cloudflare](/en/guides/cloudflare.md)
- To review an app before it goes to production, read [33 Production Readiness](/en/chapters/33-production-readiness.md)
- To follow distributed-systems topics such as idempotency and conflicts across chapters, read [State and Invariants by Chapter](/en/guides/distributed.md)
- To rebuild this book's site with the same architecture, read [Reproduce This Site](/en/reference/book-site.md)

## Where the code is

All the code the text explains is in the same repository as the book. The code shown in a chapter is pulled in from the actual files, not rewritten as a fragment for the explanation. The end of each chapter lists which files go with which section.
