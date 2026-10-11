---
title: About This Book
sourceRevision: 3
---

# AWS in Your Hands

**Practical AWS for TypeScript Developers**

You know TypeScript, HTTP, Git, and ordinary web app development. AWS accounts, IAM, networking, pricing, and operations are new to you. If that sounds like you, this book is written for you.

It is not here to talk you out of Cloudflare or Vercel. Both are easy to start with and pleasant to work in. What this book wants is for AWS to be one more tool you can reach for. It won't claim that AWS is always cheaper, faster, or better.

By the end, you should be able to explain these things about what you built:

- What you built, and why you chose that architecture
- Where your code runs
- What you are charged for
- What you can check on your own machine, and what you can only check in a real environment
- What you would add before using it in production

## How much is written so far?

All 25 chapters, 00 through 24, have their text and their samples.

Written is not the same as run and checked, though. To be honest, the checking stops at the local machine.

- [00 Welcome](/en/chapters/00-welcome.md) through [24 celld](/en/chapters/24-celld.md): every chapter passes the local checks (`vp run check:all`). That covers formatting and lint, type checks, tests, CDK synth, loading the Lambda bundles, and building the book and checking its links
- Against AWS, no chapter has been deployed or run, not even once. The post-deployment steps in the text are prepared, but nobody has gone through them yet
- This book's own site is not published either. There is no public URL

What was checked locally differs from chapter to chapter. Some chapters have tests only. For others, the server was started and exercised with `curl` or a browser. The breakdown is in "Verification notes for this chapter" at the end of each chapter. Which commands were run, when, what passed, and what is still open is all in the [Validation Record](/en/reference/validation.md).

## Where do you start?

- To read in order, start with [00 Welcome](/en/chapters/00-welcome.md)
- If you know Cloudflare D1, Workers, and Workers AI, read [Coming from Cloudflare](/en/guides/cloudflare.md)
- To follow distributed-systems topics such as idempotency and conflicts across chapters, read the [Distributed Systems Guide](/en/guides/distributed.md)
- To rebuild this book's own site with the same architecture, read [Reproduce This Site](/en/reference/book-site.md)

## All the code is in the repository

Every piece of code the text explains lives in the same repository as the book. The code you see in a chapter is pulled in from the actual files. It is not a fragment rewritten for the explanation. The end of each chapter lists which files go with which section.
