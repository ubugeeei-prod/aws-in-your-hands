# Chapter 01: account setup

Most of this chapter is console work you can't script (creating the account,
enabling MFA). What's here is the part you can run from a terminal.

- `budget.json`: a USD 10 monthly cost budget. `IncludeCredit` is `false`, so
  spending covered by credits still counts toward the alert.
- `notifications.example.json`: copy it to `notifications.json` (ignored by
  git) and put in your own address.

The tasks live in the root `vite.config.ts`, all with `cache: false`.

- `vp run account:whoami` prints the account, region, and caller your current
  credentials resolve to. It reads AWS and changes nothing.
- `vp run account:budget:create` creates the budget. It changes AWS. What AWS
  Budgets itself costs was not verified for this book, so check the official
  pricing page.
- `vp run account:budget:delete` deletes it.
