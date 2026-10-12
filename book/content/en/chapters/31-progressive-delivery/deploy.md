---
title: "31 Progressive Delivery: Deploy"
---

# 31 Progressive Delivery: Deploy

From here you deploy to AWS and run the shift and the flags against the real services. The steps on this page have not yet been run against real AWS. Where it says what "should" happen, that is an expectation read from the code and the documentation, not the result of a run.

## Deploying

<!-- section: 31.deploy -->

```bash
vp run rollout:infra:diff
vp run rollout:infra:deploy
```

<<< @/examples/31-progressive-delivery/infra/bin/app.ts{app}

This creates the HTTP API, the function, version 1, the alias `live`, two alarms, the AppConfig application, environment, configuration profile, and deployment strategy, two roles, and the log group. Nothing in it is billed by the hour.

For cdkd, the pinned version (0.296.28) was read to see how it handles each resource type. API Gateway, the function, its permissions, the alarms, the roles, the policies, and the log group have dedicated implementations. `AWS::Lambda::Alias`, `AWS::Lambda::Version`, and the four AppConfig types have none and go through the Cloud Control API. None of them is on the list cdkd keeps of types Cloud Control cannot create. Whether they can actually be created is unconfirmed.

Once it is deployed, call it.

```bash
vp run rollout:probe
```

Every answer should come from version 1, and the `flags:` line should say `defaults`. No flags have been handed out yet, so the function is running on the defaults in its code.

Hand out the first version of the flags. Both are off in it.

```bash
vp run flags:deploy --apply
vp run flags:status
```

After `flags:status` shows `COMPLETE`, the `flags:` line of `rollout:probe` should change to `live`. Handing out takes five minutes, and watching the alarms five more.

Whoever runs these tasks needs, apart from the permissions to deploy the stack, `lambda:GetAlias`, `lambda:UpdateAlias`, `lambda:PublishVersion`, `cloudwatch:DescribeAlarms`, and the AppConfig permissions to store a version and to start and stop a deployment.

## Shifting in steps

<!-- section: 31.shift-steps -->

Start by watching a broken version being taken back. Deploy with a setting that answers 500 to half the requests.

```bash
vp run rollout:infra:deploy -c fault=50
vp run rollout:probe
```

After the deploy, the result of `rollout:probe` should be unchanged. The broken code is in `$LATEST`, and the alias still points at version 1.

Start the shift. Without `--apply` it only prints the alias as it is now and what it would do.

```bash
vp run rollout:start
vp run rollout:start --apply
```

The script publishes the current `$LATEST` as version 2, adds a 10% weight to the alias, and reads the alarms every 30 seconds. In another terminal, keep sending requests.

```bash
vp run rollout:probe --count 300
```

About half the requests that land on version 2 should answer 500, and API Gateway's `5xx` alarm should go into `ALARM`. The script finds that at its next read, removes the weight, prints `rolled-back`, and exits non-zero. How long the alarm takes to fire has not been measured. Metrics are aggregated by the minute, so expect 10% of requests to keep reaching the broken version for a minute or two after the first 500.

```bash
vp run rollout:status
```

It shows the alias back at 100% on version 1, and the state of the alarms. Wait for the alarms to return to `OK`, then deploy the fixed code and shift again. While one is firing, `rollout:start` declines to start.

```bash
vp run rollout:infra:deploy -c fault=0
vp run rollout:start --apply
```

This time version 3 is published, and after five minutes at 10% and five at 100% the run should end with `completed`. Keep `rollout:probe` running throughout. If not one request arrives, no alarm can fire, and the shift completes having checked nothing.

Use `--plan` to change the plan and `--bake` to change the bake time.

```bash
vp run rollout:start --plan Linear10PercentEvery1Minute --bake 120 --apply
```

To go back after a shift has finished, name the version to return to.

```bash
vp run rollout:rollback --to 1
vp run rollout:rollback --to 1 --apply
```

If you stopped the script in the middle of a shift, `rollout:rollback --apply` without `--to` removes the weight and returns to the old version. To continue instead, name the same version: `rollout:start --version 3 --apply`.

Finally, look at drift.

```bash
vp run rollout:infra:drift
```

The alias points at wherever the shift took it, not at the version 1 written in the template. That this difference is reported is by this chapter's design. How it is reported has not been checked. It is a difference to accept, so do not run `drift:revert` on this stack. If the alias is written back to the template's value, requests return to the first version all at once.

## Releasing a flag

<!-- section: 31.flag-steps -->

Once the code has reached everyone, release the feature. Edit `values` in `flags/flags.json` and set `noteStats` to 10%.

```json
"noteStats": { "enabled": true, "rolloutPercent": 10 }
```

```bash
vp run flags:check
vp run flags:deploy
vp run flags:deploy --apply
vp run flags:status
```

`flags:check` checks the file and prints the shape the application receives. `flags:deploy` without `--apply` only prints the same. With `--apply` it stores a new version and starts handing it out.

Until it has been handed out, calling `/stats` with varying `x-client-id` values should get a 200 for about one ID in ten. Partway through, though, an ID that is in the rollout still gets a 404 when the request lands on an execution environment that has not received the new configuration yet. The extension checks AppConfig every 45 seconds, so even after the deployment finishes it can take up to that long to reach everywhere.

To raise the percentage, change the number and repeat the steps. A flag change, like a code change, stays behind as a diff of a file in the repository.

If you notice a problem while it is being handed out, stop it.

```bash
vp run flags:stop
vp run flags:stop --apply
```

After a deployment has finished, the normal way back, for an operational switch like `readOnly` too, is to correct the file and run `flags:deploy` again. `flags:stop` can also revert a completed deployment to the previous version, but the file in the repository still holds the new values, and the next `flags:deploy` hands the same values out again. If you revert, revert the file too.

The two alarms watch flag deployments as well. If a problem on the code side fires an alarm while flags are being handed out, the flags go back to the previous version too. AppConfig does not tell which of the two was the cause. Not running a code shift and a flag deployment at the same time makes it easier to read afterwards what happened.
