---
title: About This Book
sourceRevision: 1
---

# AWS in Your Hands

**Practical AWS for TypeScript Developers**

You are comfortable with TypeScript, HTTP, Git, and ordinary web application development. AWS accounts, IAM, networking, pricing, and operations are new to you. This book is written for that developer.

It does not try to move anyone off Cloudflare or Vercel. Those platforms are easy to start with and offer a good developer experience. The aim here is to make AWS one more tool you can choose. The book does not claim that AWS is always cheaper, faster, or better.

By the end, you should be able to explain the following about what you built:

- What you built, and why you chose that architecture
- Where your code runs
- What you are charged for
- What you can check on your own machine, and what you can only check in a real environment
- What you would add before using it in production

## What is finished so far

This book is still being written. Chapters 00 through 05 are complete, and chapter 06 onward exists only as outlines. An outline chapter is labeled planned at the top of its page.

| Chapters | Status |
| --- | --- |
| [00 Welcome](/en/chapters/00-welcome.md) through [05 DynamoDB](/en/chapters/05-dynamodb.md) | Text and samples exist. Verified locally. Unverified in AWS |
| [06 Login](/en/chapters/06-auth.md) through [24 celld](/en/chapters/24-celld.md) | planned. Outline only |

The [Validation Record](/en/reference/validation.md) lists which commands were run, when, and what passed.

## Where to start

- To read in order, start with [00 Welcome](/en/chapters/00-welcome.md).
- If you know Cloudflare D1, Workers, and Workers AI, read [Coming from Cloudflare](/en/guides/cloudflare.md).
- To follow distributed-systems topics such as idempotency and conflicts across chapters, read the [Distributed Systems Guide](/en/guides/distributed.md).
- To rebuild this book's own site with the same architecture, read [Reproduce This Site](/en/reference/book-site.md).

## Source code

All the code explained in the text lives in the same repository as the book. Code shown in the text is imported from the actual files. It is not a fragment rewritten for explanation. Each chapter ends with a list of the files that correspond to each section.
