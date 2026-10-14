# CI configuration examples

The files in this directory are examples, not active workflows. The repository's active
[`check` workflow](../../.github/workflows/check.yml) runs `vp run check:all` on pull requests and
pushes to `main`, without contacting AWS. To enable one of the AWS workflows below, copy it to
`.github/workflows/` and adjust the marked values.

None of them has been executed.

| File | Runs | Touches AWS |
| --- | --- | --- |
| `ci.yml` | `vp run check:all` on every push and pull request | No |
| `drift-schedule.yml` | `vp run <name>:infra:drift` (cdkd drift) on a schedule | Reads |
| `book-publish.yml` | `vp run book:publish` and `vp run book:smoke` on demand | Changes bucket content |

All three enter the same Nix devShell and call the same `vp run` tasks a person would run locally.

## Action versions

Every action is pinned to a commit SHA, with the release it belongs to in a trailing comment. The
SHAs are copied as they are from chapter 20's workflows (`examples/20-shipping/workflows/*.yml`), so
both sets use the same four pins: `actions/checkout`, `cachix/install-nix-action`,
`aws-actions/configure-aws-credentials`, and `actions/upload-artifact`. These examples use no action
that chapter 20 does not, so none is left on a floating tag. Check a SHA against the action's own
repository before you rely on it, and update both places together.

The pins moved `actions/checkout`, `aws-actions/configure-aws-credentials`, and
`actions/upload-artifact` across major versions from the tags these examples used before (`v4`).
The inputs passed here were not re-checked against the new versions by running them.

## IAM roles

The two workflows that reach AWS authenticate with GitHub's OIDC provider and short-lived
credentials. The roles they assume are **not defined in this repository**.

Chapter 20 does define an OIDC provider and four roles, in the `AihShipCi` stack
(`examples/20-shipping/infra/lib/ci-stack.ts`, deployed with `vp run ship:ci:deploy`). They do not
fit these two workflows:

- Chapter 20's `DriftRole` is for CloudFormation drift detection on the `AihShipApi*` stacks only.
  `drift-schedule.yml` runs cdkd's drift check, which reads cdkd's state and each resource of a
  cdkd-managed stack. No role for that exists yet.
- None of the four is written for publishing the book. Their own permissions are to assume the
  roles `cdk bootstrap` created and to read the `AihShipApi*` stacks; none of them is granted
  access to the book's bucket, which is what `book-publish.yml` needs.

To keep them apart from chapter 20's repository variables, the examples use different names:

| Variable | Used by | Role |
| --- | --- | --- |
| `AIH_CDKD_DRIFT_ROLE_ARN` | `drift-schedule.yml` | Read-only, for cdkd drift checks. Not defined here |
| `AIH_BOOK_PUBLISH_ROLE_ARN` | `book-publish.yml` | Publishes the book's content. Not defined here |
| `AIH_DRIFT_ROLE_ARN` | `examples/20-shipping/workflows/drift.yml` | `DriftRoleArn` of `AihShipCi`: CloudFormation drift on `AihShipApi*` |

If you write those two roles, chapter 20's `ci-stack.ts` shows a trust policy to start from: it
matches the token's `aud` and `sub` claims exactly, with one subject per kind of job. Nothing here has assumed any role from GitHub Actions,
chapter 20's included.
