# drift fixtures

Each file is one recorded shape of a `cdkd drift <stack> --json` run: the exit
code, stderr, and stdout exactly as the gate receives them.

They were written by hand from the `StackDriftJson` type and the documented
exit codes of `@go-to-k/cdkd` 0.296.28. None of them was captured from a real
AWS account. Capturing real output is part of the chapter 02 cloud validation,
which has not been run yet (see `data/validation.json`).
