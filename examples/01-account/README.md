# Chapter 01: account setup artifacts

This chapter is mostly console work that cannot be scripted (creating the
account, enabling MFA). The files here are the parts that can be reproduced
from a terminal.

| File | Used by |
| --- | --- |
| `budget.json` | `vp run account:budget:create` — a USD 10 monthly cost budget. `IncludeCredit` is `false`, so spending covered by credits still counts toward the alert. |
| `notifications.example.json` | Copy to `notifications.json` (ignored by git), replace the address, then run the task. |

Tasks (all defined in the repository root `vite.config.ts`, all `cache: false`):

- `vp run account:whoami` — prints the account, region, and caller the current credentials resolve to. Reads AWS; changes nothing.
- `vp run account:budget:create` — creates the budget. Changes AWS. What AWS Budgets itself costs was not verified for this book; check the official pricing page.
- `vp run account:budget:delete` — deletes it.
