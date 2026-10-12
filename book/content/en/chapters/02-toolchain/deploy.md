---
title: "02 Toolchain: Deploy"
---

# 02 Toolchain: Deploy

This page picks up after bootstrap. You deploy the sample stack to AWS and see what diff and drift detection each compare.

## Deploying

<!-- section: 02.deploy -->

```bash
vp run hello:infra:diff
vp run hello:infra:deploy
```

`diff` shows what is about to be created. On the first run it should list two creations, the bucket and the bucket policy. `deploy` is the task that creates them. Both tasks print the account and Region before they run, and stop if the account does not match `AIH_AWS_ACCOUNT_ID`.

When the deploy finishes, it prints the bucket's name. You can also check it on the S3 pages of the console.

If you change a setting and take the diff again, only the changed part is shown.

```bash
vp run hello:infra:diff -c noncurrentVersionDays=30
```

## Diff and drift are different things

<!-- section: 02.diff-drift -->

So far, four things have appeared that each describe the bucket's configuration.

| | What it is | Where it lives |
| --- | --- | --- |
| Source | The CDK code | The repository |
| Template | The output of synth | `cdk.out/` |
| State | What cdkd recorded as "created like this" | The `cdkd-state-...` bucket |
| Actual resource | The configuration in AWS right now | AWS |

Diff compares the template with the state and previews what will change if you deploy this code. It does not look at the actual resource.

Drift detection compares the state with the actual resource and checks whether the recorded configuration is still what is in AWS. If someone changes a setting in the console, the difference shows up here.

So **an empty diff does not mean there is no drift**. If you suspend the bucket's versioning in the console, neither the code nor the state changes, and diff reports no changes.

The CloudFormation path has the same distinction. `cdk diff` compares one template with another, and comparison with the actual resources is a separate feature, CloudFormation drift detection, which is covered in [chapter 20](/en/chapters/20-shipping.md).

## Finding drift

<!-- section: 02.drift-gate -->

```bash
vp run hello:infra:drift
```

This task runs `cdkd drift AihHello --json`, writes the result to `reports/drift/AihHello.json`, and ends with a pass or a fail. It reads AWS but changes nothing.

The verdict is not left to cdkd's exit code alone, because the pinned version of cdkd also exits with code 0 in these cases:

- A resource is of a type that cannot be read back, and was not compared
- A resource was skipped in the comparison

Finding no difference is not the same as comparing everything and finding it all matched. This book's check, which the code calls the gate, passes only when every resource was compared and matched.

<<< @/tools/src/drift/report.ts{gate}

There are seven statuses.

| Status | Meaning | Gate exit code |
| --- | --- | --- |
| `clean` | Everything was compared and matched | 0 |
| `drifted` | Some configuration differs from the record | 10 |
| `deleted` | A recorded resource is not in AWS | 10 |
| `incomplete` | Something could not be compared, for example because a read failed | 11 |
| `unsupported` | A resource is of a type that cannot be read back, and was not compared | 11 |
| `failed` | The detection itself produced no result | 12 |
| `missing-target` | There is no record for the specified stack | 12 |

The exit codes are separate so that CI can tell a difference from a result that is unknown. The report keeps the time of the run, the account, the Region, and the number of resources compared and not compared.

Seen from this book's code, cdkd's output is also data that comes from outside, so the gate validates it against a schema before reading it. When the output is empty, does not include the specified stack, or contradicts the exit code, the gate does not read it charitably and reports `failed` or `missing-target`. This handling is tested against nine inputs in `tools/src/drift/fixtures/`. Those inputs were written by hand from cdkd's type definitions, however, and are not output captured from real AWS.

### When drift is found

You have three options, and a person decides which one to take.

- Return the actual resource to the record. Check the contents with `vp run hello:infra:drift:revert:preview`, then run `vp run hello:infra:drift:revert`. A change that requires replacement may recreate a resource that holds data, so always read the preview output
- Accept the actual configuration as correct. Run `vp run hello:infra:drift:accept`. Only the state is rewritten, and the CDK code does not change, so as it stands the next deploy puts the old value back. Change the code to the same value too
- Fix the code and deploy again. Change the code and run `vp run hello:infra:deploy`. If the change was intended, this is the proper procedure

Whichever you choose, run `vp run hello:infra:drift` once more at the end. A resolving command that succeeded is not proof that the stack matches.

### Try it

With the deployed bucket, you can try the following in order.

1. In the console, change the bucket's "Versioning" to "Suspend"
2. Run `vp run hello:infra:diff`. It should report no changes
3. Run `vp run hello:infra:drift`. It should report `drifted` and exit with code 10
4. Look at what will be reverted with `vp run hello:infra:drift:revert:preview`, then revert with `vp run hello:infra:drift:revert`
5. Run `vp run hello:infra:drift` once more and confirm `clean`

These steps say "should" because they have not been run against a real AWS account yet.
