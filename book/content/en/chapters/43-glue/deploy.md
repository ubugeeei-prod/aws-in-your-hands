---
title: "43 Glue: Deploy"
---

# 43 Glue: Deploy

## Deploy and check

<!-- section: 43.deploy -->

From here the stack goes to AWS and the job really runs. The steps on this page have not been carried out in a real account yet. This is where the Spark script runs for the first time.

```bash
vp run glue:infra:diff
vp run glue:infra:deploy
```

The database name `aih_glue`, the job name `aih-glue-curate`, the trigger name `aih-glue-curate-daily` and the log group names `/aih/glue/curate/error` and `/aih/glue/curate/output` are fixed in the stack. If something with the same name already exists in the same account and Region, creation fails.

Deploying alone starts nothing. The bucket is empty and the trigger is not activated.

Upload the sample raw files. They are the same 11 that `glue:spec` read on [the previous page](/en/chapters/43-glue/local.md).

```bash
vp run glue:seed
```

Run the job for the sample's two days. This is where it starts to cost: at least USD 0.0147 for one run.

```bash
vp run glue:run --days 2026-10-10,2026-10-11
```

`glue:run` starts a run, looks at its state every 15 seconds, and prints the state and the execution time when it ends. On `SUCCEEDED` there should be Parquet files under `requests_curated/dt=2026-10-10/` and `requests_curated/dt=2026-10-11/`.

If it fails, look at the error it prints and at the log group `/aih/glue/curate/error`. If it is a permission error, add the refused action to the role.

Next comes the check that matters most in this chapter: the rows the job wrote against the result of the specification.

```bash
vp run glue:verify
```

`glue:verify` downloads the Parquet files of the two days, reads them, and matches them by `event_id` against `curate` applied to the same sample. It counts rows that are missing, rows that do not belong, rows that are there twice, and rows with different values. When all four are zero, the script wrote what the specification says for that day.

<<< @/examples/43-glue/src/compare.ts{compare}

The rows read back also go through chapter 26's schema: not only ten columns, but each row a request record in the right shape.

<<< @/examples/43-glue/src/parquet.ts{read}

The invariant can be checked on the real thing too. Run the same `glue:run` once more and see that `glue:verify` says the same. The file names in the folders change; the rows should not.

To read the result from Athena, run a query like this one in chapter 26's workgroup or in one of your own. It needs no `DISTINCT` against duplicates and no condition that reads a day on each side.

```sql
SELECT action, count(*) AS events
FROM "aih_glue"."requests_curated"
WHERE dt = '2026-10-10' AND action IS NOT NULL
GROUP BY action
```

To have it run every day, start the trigger. While it is active, you pay for one run a day.

```bash
aws glue start-trigger --name aih-glue-curate-daily
aws glue stop-trigger --name aih-glue-curate-daily
```

If you are creating the stack now, `vp run glue:infra:deploy -c schedule=on` activates it as well. It has no effect on a trigger that already exists; [the build page](/en/chapters/43-glue/build.md) says why. The daily run reads yesterday and the day before, so the sample's two days are not among them. For real records, point chapter 26's stream at this bucket, or make chapter 26's bucket this job's input. Neither is in this chapter's stack.

The drift check is the same as in every chapter.

```bash
vp run glue:infra:drift
```

The pinned cdkd (0.296.28) has its own implementation for all 13 resource types this stack uses. That was checked by reading the source of the installed version. The script's asset goes to cdkd's asset bucket, and cdkd rewrites the bucket name inside the template. That, too, was read from the source and not seen in a deployment.
