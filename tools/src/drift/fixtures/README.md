# drift fixtures

One file per shape of a `cdkd drift <stack> --json` run: exit code, stderr, and
stdout, as the gate receives them.

Written by hand from the `StackDriftJson` type and the documented exit codes of
`@go-to-k/cdkd` 0.296.28. None was captured from a real AWS account. That is
part of the chapter 02 cloud validation, which has not been run yet (see
`data/validation.json`).
