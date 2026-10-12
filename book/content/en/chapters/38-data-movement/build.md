---
title: "38 Data Movement: Design and Build"
---

# 38 Data Movement: Design and Build

[The previous page](/en/chapters/38-data-movement.md) compared the ways to move data and settled on DataSync for the attachments archive. This page goes through DataSync's parts and settings in turn, puts the stacks together, and uses a local model to check what the task copies and what it deletes.

## The parts of DataSync

<!-- section: 38.datasync -->

DataSync has four words.

- **Agent.** A virtual machine you place in your own network. You need one when the other side is NFS or SMB storage on premises. This chapter uses none
- **Location.** A registration of somewhere to copy from or to. For S3 it is a bucket together with the role DataSync uses to reach it
- **Task.** A source location, a destination location, the settings for how to copy, and a schedule, as one resource. It has nothing to do with chapter 12's ECS tasks
- **Task execution.** One run of a task. It goes through `QUEUED`, `LAUNCHING`, `LAUNCHED`, `PREPARING`, `TRANSFERRING`, and `VERIFYING`, and ends in `SUCCESS` or `ERROR`

Whether you need an agent depends on the other side. Taking the rows of the documentation's table that matter to this chapter: S3 to S3 needs no agent, in one account or across accounts. Another cloud's object storage to S3 runs without an agent in Enhanced mode, explained next, and needs one in Basic mode. NFS and SMB need an agent in either mode.

### Basic mode and Enhanced mode

A task has one of two modes, and the mode cannot be changed after the task is created.

Enhanced mode lists, prepares, transfers, and verifies in parallel. The number of objects one execution can handle is described as "virtually unlimited", and its logs are JSON. Basic mode prepares, transfers, and verifies one after the other. The number one execution can handle has a quota: between AWS storage services, 25 million files, objects, and directories together. S3 prefixes are counted as directories.

The documentation recommends Enhanced mode for copies between S3 buckets. This chapter chose Basic mode all the same.

<<< @/examples/38-data-movement/src/task.ts{archive-task}

The reason is the price. According to the AWS Price List, Basic mode in the Osaka Region costs USD 0.0125 per GB copied. Enhanced mode costs USD 0.015 per GB, plus USD 0.55 per execution. Run once a day, the execution fee alone comes to USD 16.50 a month. The notes app's attachments are far from Basic mode's quota in both number and size.

The time to switch to Enhanced mode is when objects and prefixes together approach 25 million, when large objects take too long to transfer, or when you want to move data from another cloud without an agent. The mode changes only by creating the task again; the CloudFormation reference also says that changing `TaskMode` replaces the resource.

The quota figures were read on DataSync's quotas page on 2026-10-13. Four more from the same page: an account can have 100 tasks per Region, which can be raised on request. One task's filters can be 102,400 characters in all. One task can have 50 executions queued. An execution's history is deleted after 30 days. The current values are in the Service Quotas console under AWS DataSync.

## The task's settings

<!-- section: 38.task -->

How the copy is made is decided by the task's options. The ones this chapter uses are written as a type.

<<< @/examples/38-data-movement/src/task.ts{options}

`TransferMode` decides what is a candidate for copying. `CHANGED`, after an initial full copy, copies only the data and metadata that differ between the source and the destination. `ALL` copies everything in the source every time, without looking at the destination.

`OverwriteMode` is about objects that already exist in the destination. The default, `ALWAYS`, overwrites when the source's contents or metadata have changed. `NEVER` does not overwrite even when the source has changed. The documentation describes `NEVER` as a way to protect changes made in the destination from being overwritten.

`PreserveDeletedFiles` is about what has disappeared from the source. The default, `PRESERVE`, leaves it in the destination. `REMOVE` deletes from the destination what the source does not have.

Some settings cannot be combined. `ALL` does not examine the destination, so it cannot know what to delete. The documentation says `ALL` and `REMOVE` cannot be configured together. Combinations like this are refused locally, before a deploy.

<<< @/examples/38-data-movement/src/task.ts{check}

### Verification

DataSync always checks contents with checksums during a transfer. What `VerifyMode` decides is the additional verification after the transfer has finished.

- `ONLY_FILES_TRANSFERRED` compares, for the data that was copied, the checksum calculated at the source with the one calculated at the destination. The documentation recommends this setting
- `POINT_IN_TIME_CONSISTENT` examines the whole of the source and the destination at the end of the transfer to confirm that the two are in step. It is the default in Basic mode and cannot be used in Enhanced mode
- `NONE` does no additional verification

This chapter sets `ONLY_FILES_TRANSFERRED` explicitly. The source is the bucket of a running application, and uploads arrive in the middle of an execution. A verification that compares everything would be expected to judge the two "not in step" because of that one image. In the local model it ended in `ERROR`, as expected. What the real service does was not checked.

### Metadata, tags, storage classes, and versions

According to the documentation, between S3 and object storage DataSync copies user-defined metadata, object tags, and `Content-Type`, `Content-Disposition`, `Content-Encoding`, and `Content-Language`. It does not copy ACLs, prior versions, or `Last-Modified`. An object in the archive carries the time it was copied as its modification time.

Whether tags are copied is set by `ObjectTags`, left at its default of `PRESERVE`. A chapter 07 upload carries a `pending` tag until it is completed. If an execution catches that moment, the tag travels to the archive with the object. Whether DataSync then treats the removal of the tag as a "difference" and copies the object again could not be read from the documentation.

The storage class is set on the destination location. New objects are written in the class the location names. The class of objects already there stays as it is unless `TransferMode` is `ALL`. This chapter uses S3 Standard. With Standard-IA or Glacier Instant Retrieval, the documentation says, objects smaller than 128 KB are written to S3 Standard and not to the class you named. It also says that these two classes can charge extra for overwriting, deleting, and retrieving. Most attachments are small images, so changing the class saves less than you might expect. Objects in Glacier Flexible Retrieval and Deep Archive, when they are in the source, cannot be read by DataSync until they are restored.

On versioning the documentation says three things. Only the latest version of each object is copied from the source. If versioning is enabled on the destination, an object that changed in the source is written as a new version. Version IDs differ between the source and the destination.

### Deletes

The archive bucket has versioning enabled.

<<< @/examples/38-data-movement/infra/lib/archive-stack.ts{archive-bucket}

DataSync overwrites a changed object in place. If the application overwrites an attachment with a damaged image, the next execution delivers that damaged image to the archive too. As chapter 22 said, holding two copies and keeping a past state are different jobs. Keeping the archive's old versions for 30 days is for the second.

With the default `PRESERVE`, an attachment deleted in the source stays in the archive for good. That helps when the delete was an accident, but data a user deleted on purpose stays as well. An application that has promised that deleted means deleted switches to `REMOVE` with `-c deletes=remove`. Under `REMOVE`, in a bucket with versioning enabled, a delete that names no version ID only places a delete marker, and the contents stay as an old version for 30 days. The DataSync role is not given `s3:DeleteObjectVersion`, which a delete that names a version would need. That DataSync's delete does in fact become a delete marker was not checked on the real service.

### Filters and manifests

There are two ways to narrow what is copied.

A filter is a string of patterns joined with `|`. Patterns are relative to the location's path and are case sensitive. `/dir` and `/dir/` mean the same and match the folder and its contents. In S3, a `/` in a key is treated as a folder separator. The wildcard is `*`, and in an include filter it can only be the last character of a pattern: `/u/alice*` can be written and `*.png` cannot. Exclude filters have no such restriction.

A manifest is a CSV that lists, one by one, the files or objects to copy. With S3 as the source it can name a version ID too. It cannot be used together with filters. An execution that uses a manifest deletes nothing from the destination.

This chapter's task uses neither by default. `-c excludes='<filter>'` adds an exclude filter.

### The schedule

A task can hold its own schedule, as a cron or a rate expression. The interval cannot be shorter than one hour. Times are in UTC. This chapter uses `cron(0 18 * * ? *)`, 3 a.m. in Japan.

<<< @/examples/38-data-movement/infra/lib/archive-stack.ts{task}

The option keys have the same names in DataSync's API and in the CDK, so the object the planning model reads is passed to the task as it is. The first implementation converted the keys to CloudFormation's spelling (`TransferMode`) before passing them. The CDK drops keys it does not know without a word, so the `Options` of the resulting template were empty. The stack test found the mistake.

The documentation also says that DataSync may disable a schedule itself when the task keeps failing with the same error. A disabled schedule is quiet. The end of this page comes back to that.

## Roles and the bucket policy

<!-- section: 38.access -->

DataSync reaches a bucket by assuming the role named for each location. A source and a destination need different permissions. The actions the documentation lists are written as constants, unchanged.

<<< @/examples/38-data-movement/infra/lib/datasync-access.ts{actions}

The source role only reads. The destination role can write and delete. Neither has `s3:*` or a `*` resource. The stack tests pin the list of actions one by one, and a single added action fails them.

<<< @/examples/38-data-movement/infra/lib/datasync-access.ts{grants}

The `aws:ResourceAccount` condition on the destination side is from the documentation's example. Bucket names are unique in the world, but relying on the name alone leaves room to write into a bucket of that name in someone else's account. The condition confirms that the bucket belongs to this account.

Only DataSync can assume the roles, and the trust policy adds two conditions to that.

<<< @/examples/38-data-movement/infra/lib/datasync-access.ts{trust}

DataSync takes work from many accounts. Without the conditions, someone in another account has room to ask DataSync to use this role. The problem is called the confused deputy. `aws:SourceAccount` and `aws:SourceArn` confirm that the request came from a location of this account in this Region. A location's ARN is not known until it is created, so the ARN ends in `*`, as the documentation recommends.

A location is created after its role's policy exists.

<<< @/examples/38-data-movement/infra/lib/source-stack.ts{source-location}

<<< @/examples/38-data-movement/infra/lib/archive-stack.ts{destination-location}

### Into another account's bucket

You may want the archive in another account: when an accident or a break-in reaches the whole account, a copy in that same account is no use. DataSync's tutorial shows this shape.

- The DataSync role, both locations, and the task are all created in the source account
- The destination account holds the bucket, and its bucket policy allows the source account's role ten actions
- ACLs are disabled on the destination bucket, so that the bucket's account owns the objects written to it
- A location that points at another account's bucket cannot be created in the console. `aws datasync create-location-s3` is run with the bucket's Region

This chapter's stacks provide only the second item. `-c writerRole=<role ARN>` adds one statement to the archive's bucket policy.

<<< @/examples/38-data-movement/infra/lib/archive-stack.ts{cross-account}

It allows the one role that is named, not the whole account. A test pins the principal and the ten actions. Creating the locations and the task in the source account is not in this chapter. If the bucket is encrypted with SSE-KMS, the documentation says the role has to be in the key's policy too.

## Reading the plan locally

<!-- section: 38.planner -->

Before running a task you want to know what will be copied, what skipped, and what deleted. No way was found to see DataSync's plan without running it. So a function that makes the plan was written from what the documentation says.

First, what it is and is not. For `TransferMode`, `OverwriteMode`, `PreserveDeletedFiles`, include filters, and exclude filters, the function is a model of the documented behaviour as the author read it. It does not call DataSync and is not DataSync's code. It may disagree with the real service.

The input is a listing of each side.

<<< @/examples/38-data-movement/src/plan.ts{listing}

"Different" is judged by size and by a hash of the contents. What DataSync uses to judge that two S3 objects differ could not be read from the documentation. An S3 ETag looks usable, but according to S3's API reference the ETag of an object written with a multipart upload is not an MD5 of its contents. DataSync writes large objects in parts, so putting the ETags of a real listing into this function's `checksum` can make objects with the same contents come out as "different".

<<< @/examples/38-data-movement/src/plan.ts{plan}

`destinationNewer` is a mark of this function's own, not a DataSync setting. When the archive's object is newer and its contents differ, someone has written to the archive directly. With `OverwriteMode` `ALWAYS`, that write disappears at the next execution. The plan makes it visible beforehand.

`NEVER` protects that write. In exchange, an attachment replaced in the source no longer reaches the archive. Tests pin both. Deciding that nobody writes to the archive directly is the simpler course.

Filters are judged by this function.

<<< @/examples/38-data-movement/src/filters.ts{matches}

Three things in the model are not in the documentation and were decided by the author.

- A wildcard crosses `/`. The documentation's examples include `*/folder-to-exclude`, which matches a folder at any depth, and it was read that way
- An object that a filter puts out of scope is not deleted, even under `REMOVE`. The documentation of `aws s3 sync` says this of `--delete`. For DataSync it says nothing
- When `TransferMode` is `ALL` and `OverwriteMode` is `NEVER`, `NEVER` wins and objects that already exist are skipped

A `REMOVE` plan has a property worth remembering. If the source listing is empty, the plan deletes the whole archive. Pointing at the wrong source bucket and a source emptied by accident are, to DataSync, the same job: "delete what the source does not have". One test has this shape.

## A source that changes on the way

<!-- section: 38.execution -->

A plan is made from a listing at one moment. The execution then runs for minutes, sometimes hours, and the application keeps writing to the bucket all the while. To see that mismatch, a model was written that sets up two buckets in memory and advances an execution one stage at a time.

<<< @/examples/38-data-movement/src/memory-bucket.ts{memory-bucket}

The bucket is given just one property of S3. A write replaces the whole object. A reader sees the old contents or the new, never a mixture.

<<< @/examples/38-data-movement/src/execution.ts{run}

An execution lists both sides at the start and does not look at the listing again. It reads each object, though, when that object's turn comes. The tests rewrite the source between stages and pin what happens.

- **An attachment replaced after it was copied stays old in the archive.** The execution ends in `SUCCESS`. It verifies only what it copied, so it does not notice the replacement. The next execution carries that one object
- **An attachment replaced after the listing and before its turn arrives with the new contents.** The next execution does nothing
- **An attachment uploaded after the listing is not carried by that execution.** It waits for the next
- **An attachment deleted after the listing is not copied.** The model does not treat this as a failure. How the real service reports it was not checked
- **After an execution that stopped part-way, the archive holds part of the source.** Each object is whole. The next execution carries only the rest. For five objects, the two executions together made five writes

The last item is what makes a re-run safe. With `TransferMode` `CHANGED`, an execution works out again "what is missing now", so however many times it runs, it settles in the same place. With `ALL`, two executions over the same five objects make ten writes.

The model of verification keeps the two settings apart.

<<< @/examples/38-data-movement/src/execution.ts{verify}

With the verification that compares everything, one replacement and one upload during the execution are enough to make the result `ERROR`. That is Basic mode's default, so copying a live bucket every night with nothing specified would bring a failure notice every night. To repeat: this is the model's result. Whether the real DataSync judges the same way was not checked.

## Knowing that an execution has ended

<!-- section: 38.events -->

There are three ways to learn the result of an execution.

**CloudWatch Logs.** A Basic mode task writes its logs to the log group named by `CloudWatchLogGroupArn`. Permission to write is given not through a role but through a CloudWatch Logs resource policy.

<<< @/examples/38-data-movement/infra/lib/archive-stack.ts{copy-logs}

The documentation's example makes the resource every log group in the account. Here it is narrowed to this stack's one log group. `LogLevel` is `BASIC`, which writes only transfer errors. `TRANSFER` writes every object copied, and the log charges grow to match. An Enhanced mode task is different: it writes automatically to a log group named `/aws/datasync`, which DataSync creates with a service-linked role.

**Task reports.** A feature that writes, for each execution, what was copied, skipped, verified, and deleted as JSON into an S3 bucket you name. It can be a summary only or a list per object. This chapter's stacks do not configure it.

**EventBridge events.** DataSync sends an event to EventBridge each time a task execution changes state. The documentation says delivery is best effort.

The shape of the event is in neither DataSync's user guide nor EventBridge's event reference. What could be found was one sample in an AWS Knowledge Center article. From that sample you can read that `source` is `aws.datasync`, that `detail-type` is `DataSync Task Execution State Change`, that `resources` holds the one ARN of the task execution, and that `detail.State` holds the state. The schema covers that much and no more.

<<< @/examples/38-data-movement/src/execution-event.ts{schema}

The only spellings confirmed as values of `detail.State` are `SUCCESS` and `ERROR`. How the other states are spelled when they arrive is not known. So the schema accepts any string, and the decision picks out just the two.

<<< @/examples/38-data-movement/src/execution-event.ts{decide}

A person is told in two cases. One is when an execution of the archive task ends in `ERROR`. The other is when an event arrives that matched the rule and cannot be read. The event's shape was written from a single sample, so the real one may well differ. If the function then dropped it silently, a night on which the failure notice never came would look the same as a night on which nothing happened. Reporting that it could not be read shows the problem at the first execution.

Failures of other tasks in the same account are ignored. The rule narrows by the start of the ARN as well.

<<< @/examples/38-data-movement/infra/lib/archive-stack.ts{alert}

The function's body is short, with the decision and the notification kept apart.

<<< @/examples/38-data-movement/src/alert.ts{handle}

If sending the notification fails, the function fails. An EventBridge rule invokes the function asynchronously, and an invocation in which the function returned an error is run again by Lambda, twice more by default. A test pins that the exception leaves the function as it is when the notification fails.

### The notice that does not arrive

This arrangement has a hole. It reports that an execution "failed", not that one "has not succeeded". Event delivery is best effort, so an `ERROR` event may not arrive. If DataSync disables the schedule, no execution starts at all and not one event is sent. In both cases the archive quietly grows old.

How old the archive may be can be turned into a number from the schedule.

<<< @/examples/38-data-movement/src/lag.ts{lag}

Decide on once a day, up to two hours per execution, and leaving one failure to the next day's execution, and the bound is 50 hours. If the last `SUCCESS` is older than that, the archive is older than promised. The function is tested but not wired into the stack. Wiring it needs a part that writes the time of the last success somewhere and another schedule that reads it. Having an alarm from [chapter 19](/en/chapters/19-observability.md) watch for "no data arriving" is the natural way to build it.

On [the next page](/en/chapters/38-data-movement/local.md) you run the tests and the demo locally.
