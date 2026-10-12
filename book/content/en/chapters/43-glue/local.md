---
title: "43 Glue: Run It Locally"
---

# 43 Glue: Run It Locally

## Run it locally

<!-- section: 43.local -->

Of what [the previous page](/en/chapters/43-glue/build.md) wrote, the TypeScript side runs on your machine: the specification, the folder layout, the evaluation of the rules, and the model of runs. Spark does not. The Nix shell has neither Spark nor Python, so `glue/curate.py` cannot be run here.

Apply the specification to the sample raw files and print what the job has to write.

```bash
vp run glue:spec
```

```text
raw: 11 objects
  requests_json/dt=2026-10-10/local-1-2026-10-10-00-00-02-000001.gz  5328 bytes
  requests_json/dt=2026-10-10/local-1-2026-10-10-05-02-26-000002.gz  5238 bytes
  requests_json/dt=2026-10-10/local-1-2026-10-10-10-04-50-000003.gz  5261 bytes
  requests_json/dt=2026-10-10/local-1-2026-10-10-15-07-14-000004.gz  5198 bytes
  requests_json/dt=2026-10-10/local-1-2026-10-10-20-09-38-000005.gz  5179 bytes
  requests_json/dt=2026-10-11/local-1-2026-10-11-01-12-02-000006.gz  5239 bytes
  requests_json/dt=2026-10-11/local-1-2026-10-11-06-14-26-000007.gz  5323 bytes
  requests_json/dt=2026-10-11/local-1-2026-10-11-11-16-50-000008.gz  5258 bytes
  requests_json/dt=2026-10-11/local-1-2026-10-11-16-19-14-000009.gz  5213 bytes
  requests_json/dt=2026-10-11/local-1-2026-10-11-21-21-38-000010.gz  2841 bytes
  requests_json/dt=2026-10-11/local-1-2026-10-11-00-20-00-000011.gz  195 bytes

2026-10-10: 817 records read from dt=2026-10-10, dt=2026-10-11
  401 rows to requests_curated/dt=2026-10-10/
  Passed  IsComplete "event_id"
  Passed  IsUnique "event_id"
  Passed  IsComplete "at"
  Passed  ColumnValues "v" = 1
  Passed  ColumnValues "route" in ["/health", "/notes", "/notes/:id", "other"]
  Passed  ColumnValues "status" between 99 and 600
  Passed  ColumnValues "duration_ms" >= 0

2026-10-11: 817 records read from dt=2026-10-10, dt=2026-10-11
  400 rows to requests_curated/dt=2026-10-11/
  Passed  IsComplete "event_id"
  Passed  IsUnique "event_id"
  Passed  IsComplete "at"
  Passed  ColumnValues "v" = 1
  Passed  ColumnValues "route" in ["/health", "/notes", "/notes/:id", "other"]
  Passed  ColumnValues "status" between 99 and 600
  Passed  ColumnValues "duration_ms" >= 0

the ruleset, as the job is given it:
Rules = [
    IsComplete "event_id",
    IsUnique "event_id",
    IsComplete "at",
    ColumnValues "v" = 1,
    ColumnValues "route" in ["/health", "/notes", "/notes/:id", "other"],
    ColumnValues "status" between 99 and 600,
    ColumnValues "duration_ms" >= 0
]
```

Here is how to read it. There are 11 raw files. The fifth object was opened at 20:00 on the 10th and closed at 01:00 on the 11th: it is in the folder of the 10th and holds requests of the 11th as well. The last object, 195 bytes, is the one record that arrived late.

For either day, 817 records are read from the day's folder and its neighbours: 800 requests, 16 that were sent twice, and the one that was late. The sample has nothing in the folder before the first day or after the second, so the two days read the same files. Of those, 401 rows remain for the 10th and 400 for the 11th.

`Passed` is printed by this chapter's function. That AWS Glue Data Quality gives the same outcomes is checked after deploying.

When you change the columns or the rules, rewrite the generated block of the script.

```bash
vp run glue:contract
```

With nothing to change it prints `glue/curate.py was up to date` and leaves the file alone.

The tests run as in every chapter.

```bash
vp run test:unit
```

This chapter's tests cover the specification, the folders that are read and written, which days can be rebuilt, the invariant on the model of runs, the DQDL text and the evaluation of the rules, the columns and rules copied into the script, the pricing quantities, the comparison of rows read back from Parquet, and the stack's settings.

What is not reproduced locally: how Spark reads and writes JSON and Parquet, how Glue starts a job, whether the role's permissions are enough, the real evaluation by Data Quality, and the events and the alarm. None of them run here. The test that reads rows back from Parquet reads a file written by a JavaScript library. A file written by Spark has not been read yet.
