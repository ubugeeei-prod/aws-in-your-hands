---
title: "02 Toolchain: Deploy"
---

# 02 Toolchain: Deploy

## Deploying

<!-- section: 02.deploy -->

```bash
vp run hello:infra:diff
vp run hello:infra:deploy
```

`diff` shows what is about to be created. On the first run it should list two creations: the bucket and the bucket policy. `deploy` is what creates them. Both print the account and Region before they run, and stop if the account doesn't match `AIH_AWS_ACCOUNT_ID`.

When the deploy finishes, it prints the bucket name. You can also confirm it on the S3 page of the console.

Change a setting and take the diff again, and only the change appears.

```bash
vp run hello:infra:diff -c noncurrentVersionDays=30
```

## diff and drift are different things

<!-- section: 02.diff-drift -->

So far, four things have appeared that each describe "the bucket's configuration."

| | What it is | Where it lives |
| --- | --- | --- |
| Source | The CDK code | The repository |
| template | The output of synth | `cdk.out/` |
| state | What cdkd recorded as "created like this" | The `cdkd-state-...` bucket |
| Actual resource | The configuration in AWS right now | AWS |

diff compares the template with the state. It's a preview: "what will change if I deploy this code?" It doesn't look at the actual resource.

drift compares the state with the actual resource. It's a confirmation: "is the recorded configuration still what is in AWS?" If someone changes a setting in the console, the difference shows up here.

So **an empty diff doesn't mean there is no drift**. If you suspend the bucket's versioning in the console, neither the code nor the state changes, so diff reports no changes.

The CloudFormation path has the same distinction. `cdk diff` compares one template with another, and comparison with the actual resources is a separate feature, CloudFormation drift detection. That is covered in [Chapter 20](/en/chapters/20-shipping.md).

## Finding drift

<!-- section: 02.drift-gate -->

```bash
vp run hello:infra:drift
```

This task runs `cdkd drift AihHello --json`, writes the result to `reports/drift/AihHello.json`, and ends with a pass or fail. It reads AWS but doesn't change it.

The pass/fail decision isn't left to cdkd's exit code alone. That's because cdkd, in the pinned version, also returns exit code 0 in these cases.

- A resource is of a type that has no way to be read back, so it was not compared
- A resource was skipped in the comparison

"No difference was found" and "everything was compared and matched" aren't the same, are they? This book's gate passes only when every resource was compared and matched.

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

The exit codes are separate so that CI can tell "there is a difference" from "unknown." The report keeps the time of the run, the account, the Region, and the number of resources compared and not compared.

The report is read only after cdkd's output has been validated against a schema. Seen from this book's code, cdkd's output is also data that comes from outside. The output was empty, it didn't include the specified stack, its contents contradict the exit code: in cases like these the gate doesn't read it charitably and reports `failed` or `missing-target`. These cases are tested against nine inputs in `tools/src/drift/fixtures/`. Note, though, that the fixtures were written by hand from cdkd's type definitions. They are not output captured from real AWS.

### When drift is found

You have three options. A person decides which one to take.

- Return the actual resource to the record. Check the contents with `vp run hello:infra:drift:revert:preview`, then run `vp run hello:infra:drift:revert`. For a change that requires replacement, a resource that holds data may be recreated. Always read the preview
- Accept the actual configuration as correct. Run `vp run hello:infra:drift:accept`. Only the state is rewritten. The CDK code doesn't change, so the next deploy puts it back. Change the code to the same value too
- Fix the code and deploy again. Change the code and run `vp run hello:infra:deploy`. If the change was intended, this is the proper procedure

Whichever you choose, run `vp run hello:infra:drift` once more at the end. A resolving command that succeeded is not proof that the stack matches.

### Try it

With the deployed bucket, you can try the following in order.

1. In the console, change the bucket's "Versioning" to "Suspend"
2. Run `vp run hello:infra:diff`. It should report no changes
3. Run `vp run hello:infra:drift`. It should report `drifted` and exit with code 10
4. Look at what will be reverted with `vp run hello:infra:drift:revert:preview`, then revert with `vp run hello:infra:drift:revert`
5. Run `vp run hello:infra:drift` once more and confirm `clean`

These steps say "should" because they haven't been run against a real AWS account yet.
