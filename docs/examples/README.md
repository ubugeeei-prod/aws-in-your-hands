# CI configuration examples

These files are examples, not active workflows: nothing in this repository runs them. To use
one, copy it to `.github/workflows/` and adjust the marked values.

None of them has been executed. The action versions are the ones the author knew of when writing;
pin each to a commit SHA you have checked before relying on it.

| File | Runs | Touches AWS |
| --- | --- | --- |
| `ci.yml` | `vp run check:all` on every push and pull request | No |
| `drift-schedule.yml` | `vp run <name>:infra:drift` on a schedule | Reads |
| `book-publish.yml` | `vp run book:publish` and `vp run book:smoke` on demand | Changes bucket content |

All three enter the same Nix devShell and call the same `vp run` tasks a person would run locally.
The two that reach AWS authenticate with GitHub's OIDC provider and short-lived credentials. The IAM
role they assume is not defined in this repository yet; that is planned for chapter 20.
