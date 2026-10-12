---
title: "22 Backup: Run It Locally"
---

# 22 Backup: Run It Locally

## Running it locally

<!-- section: 22.local -->

You can watch the whole flow without an AWS account.

```bash
vp run recovery:demo
```

It goes from accident to repair on an in-memory table and bucket. The output looks like this.

```text
09:04:00  two notes, one inspected image each. This is the point to return to.
09:09:00  since then: one edit, one note deleted by mistake, one image overwritten, one new note.

restored the table to 09:04:00. The bucket is still at 09:09:00.
cutting over gives back 1 note, loses 1, undoes edits to 1.

check: the restored table against the bucket as it is: 4 findings
  broken   attachment_without_object  u/alice/0mv50u5c00001/0mv50vfmo0002
  broken   attachment_size_mismatch  u/alice/0mv50wpxc0003/0mv50y0800004
  leftover inspection_without_object  u/alice/0mv50u5c00001/0mv50vfmo0002
  broken   inspection_for_other_bytes  u/alice/0mv50wpxc0003/0mv50y0800004

restored the bucket to 09:04:00: remove_delete_marker, copy_version

check again: 0 findings

repair: 0 actions, 0 findings left for a person
raised the version of 1 rolled-back note past the number the live table had reached.

not restored, and not found by any check: "diary, written after the point". It exists only in the old table.
```

With only the table restored, four findings. Restore the bucket to the same time, and there are none. The repair had nothing to do.

That is the order to prefer. **First bring both as close to the same time as you can. Use the repair only for what is still left.** Repair first, and it rewrites the inspection record to match the overwritten bytes; then you restore the bucket, and they disagree all over again.

Look at the last line, too. The diary written after the restore point shows up in no check. Lost data is something the difference tells you, not the check.

The tests run as always.

```bash
vp run test:unit
```

Here is what these two do not reproduce. How long a restore takes. The lag of `LatestRestorableDateTime`. The granularity of S3's timestamps. The events S3 sends when a delete marker is removed or a version is copied. IAM. All of these can only be checked against the real thing.
