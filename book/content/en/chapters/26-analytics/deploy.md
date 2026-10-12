---
title: "26 Analytics: Deploy"
---

# 26 Analytics: Deploy

## Deploy and check

<!-- section: 26.deploy -->

From here you deploy to AWS and check with the real services that records reach S3 and that Athena can aggregate them. The steps in this section have not yet been run against AWS.

```bash
vp run analytics:infra:diff
vp run analytics:infra:deploy
```

The database name `aih_analytics` and the workgroup name `aih-analytics` are fixed in the stack. If the same account and Region already has something by either name, creation fails.

Next, send some requests.

```bash
vp run analytics:smoke
```

`analytics:smoke` creates a note, reads it, updates it, updates it again from the stale version to cause a 409, reads a note that does not exist to cause a 404, and deletes the note.

Records appear in the bucket only after the buffer interval has passed. For the JSON stream, wait 60 seconds. Then run the queries. Dates are in UTC.

```bash
vp run analytics:query --name actions --from 2026-10-12 --to 2026-10-12
vp run analytics:query --name routes --from 2026-10-12 --to 2026-10-12
```

`analytics:query` prints the SQL, hands it to Athena, waits for it to finish, and prints the result rows and the bytes scanned. Right after the smoke test it should return one each of `note_created`, `note_updated`, `update_conflicted` and `note_deleted`. The bytes scanned will be a few hundred, and the charge is for the 10 MB minimum.

If no rows come back, first look for objects under `requests_json/` in the bucket. If there are objects and still no rows, compare the table's `storage.location.template` with the objects' keys. If there are no objects, look under `errors/` and in the log group for Firehose's errors.

To try Parquet, deploy again with the format given.

```bash
vp run analytics:infra:deploy -c format=parquet
```

The settings of the stream and the table change, and records from then on go to `requests_parquet/`. Whether cdkd can apply this change as an update in place was not checked. If it cannot, delete the stack and create it again. The buffer interval becomes 300 seconds, so wait five minutes after the smoke test. The JSON records from before are not visible through the new table. Run the same query against both formats and compare the bytes scanned with the local measurement on the [previous page](/en/chapters/26-analytics/build.md).

For cdkd, the source of the pinned version (0.296.28) was read to see how it handles each resource type. The Firehose stream, the Glue database and table, the bucket, the roles, the function and the API have providers of their own. The Athena workgroup and the log stream for Firehose's errors have none and go through Cloud Control API. Whether those two types are on Cloud Control API's list of supported types, and whether cdkd can really create them, was not confirmed.

Drift detection works as in earlier chapters.

```bash
vp run analytics:infra:drift
```
