---
title: "38 Data Movement: DataSync, Data Pipeline Today, and Choosing How to Move Data"
sourceRevision: 1
---

# 38 Data Movement: DataSync, Data Pipeline Today, and Choosing How to Move Data

[Chapter 07](/en/chapters/07-uploads.md) put the notes' attachments in an S3 bucket. [Chapter 22](/en/chapters/22-recovery.md) dealt with getting the contents of that bucket back after deleting them. This chapter moves the whole contents of the bucket to a second bucket in another Region. AWS DataSync does the moving, once a day, copying only what has changed.

The author was asked for a chapter on AWS Data Pipeline and DataSync. One thing has to be said first: AWS Data Pipeline is not offered to new customers. Every page of its documentation carries the line "AWS Data Pipeline is no longer available to new customers", and the AWS blog post that explains the migration says new customer access was closed on July 25, 2024 (checked on 2026-10-13). Someone starting with AWS now cannot use Data Pipeline. So this chapter does not teach how to use it. It explains briefly what the service was for, so that you can read one when you meet it in an existing account, and then says what the same job is built with today.

The second half of the chapter takes up a wider question. When you want data that is in A to be in B, AWS has several ways to do it, and the names do not tell you how they differ. The chapter sorts them by whether you move the data once, on a schedule, or continuously, and says which to choose.

The author has not run this chapter's task on AWS even once. What was checked locally is the stacks' templates and a model of the plan that the author built from DataSync's documentation. The model is not DataSync, and the text says each time which parts are the model.

The prerequisite is chapter 07. [Chapter 16](/en/chapters/16-long-jobs.md) and chapter 22 make the story easier to follow if you have read them. The code is in `examples/38-data-movement/`.

## The whole picture

<!-- section: 38.overview -->

```figure
caption: A DataSync task in Osaka reads the bucket in Tokyo once a day and writes to the archive in Osaka
node uploads: S3 bucket Uploads | Tokyo, chapter 07's attachments
node task: DataSync task | Basic mode, daily at 03:00 JST
node archive: S3 bucket Archive | versioning
node logs: Log group CopyLogs
node rule: EventBridge rule | SUCCESS and ERROR
node alert: Lambda function Alert
node topic: SNS topic Alerts
edge uploads -> task: source location
edge task -> archive: destination location
edge task --> logs: transfer errors
edge task --> rule: execution state changes
edge rule -> alert
edge alert -> topic: only on ERROR
group tokyo: AihDataMovement (ap-northeast-1) = uploads
group osaka: AihDataMovementArchive (ap-northeast-3) = task, archive, logs, rule, alert, topic
mark task
```

```figure
caption: One execution lists both sides, copies what is missing or different, checks what it copied, and ends
type: sequence
actor task: Task execution
actor uploads: Uploads | Tokyo
actor archive: Archive | Osaka
actor bus: EventBridge
step task -> uploads: PREPARING: list
step task -> archive: PREPARING: list
note task: find differences
step task -> uploads: TRANSFERRING: read
step task -> archive: TRANSFERRING: write
step task -> archive: VERIFYING: the copies
step task --> bus: SUCCESS or ERROR
```

The first figure shows what the stacks contain, and the second the order in which one execution proceeds.

There are two stacks. `AihDataMovement`, in Tokyo, creates a bucket shaped like chapter 07's, a role with which DataSync reads that bucket, and a DataSync location. A location is a registration that says "this bucket is reached with this role", and creating one runs nothing. `AihDataMovementArchive`, in Osaka, creates the archive bucket and its location.

The task that does the copying is in the Osaka stack. DataSync's tutorial says that for a copy across Regions the task is created in the same Region as the destination location. The task needs the ARN of the Tokyo location, so the deploy has two steps: deploy the Tokyo stack first, then pass the ARN it prints to the Osaka stack as `-c sourceLocation=<ARN>`. Without it, Osaka gets a bucket and a location and nothing else.

There is no API and no screen. What counts as the application in this chapter is the task's configuration and a small function that hears that an execution has ended.

No agent is used. An agent is a virtual machine you place in your own network, which reads and writes NFS or SMB file servers on DataSync's behalf. The table in the documentation says a copy from S3 to S3 runs without an agent in the same account, across accounts, and across Regions.

While no execution is running, DataSync charges nothing. Its pricing page says there are no upfront costs and no minimum charges. A task with its schedule enabled does run every day, though, and on a day with nothing to copy you still pay for the requests that list both buckets. The amounts are worked out on [the last page](/en/chapters/38-data-movement/wrap.md).

## AWS Data Pipeline today

<!-- section: 38.data-pipeline -->

This is what could be confirmed about AWS Data Pipeline from AWS's own pages.

- It is not offered to new customers. Existing customers can keep using it as before
- The service is in maintenance mode, with no new features and no new Regions planned
- No end-of-support date was found, in the user guide or in the migration blog post. Whether no date has been set or the author simply did not find it is not known
- AWS names three migration targets: AWS Glue, AWS Step Functions, and Amazon MWAA (Managed Workflows for Apache Airflow)

### What the service was for

Data Pipeline began in 2012 and existed to run data processing at set times in a set order. The documentation's example collects a web server's logs into S3 every day and, once a week, runs an Amazon EMR cluster over them to produce reports. The weekly job waits until the last day's logs have arrived. Declaring that one piece of work waits for another to succeed was the heart of it.

Open a pipeline in an existing account and you find a JSON definition. These are the parts it lists.

- **Data nodes.** Where the data that an activity reads or writes lives. There are `S3DataNode`, `DynamoDBDataNode`, `SqlDataNode`, and `RedshiftDataNode`
- **Activities.** The work to do. `CopyActivity` copies data, `ShellCommandActivity` runs a shell command, `EmrActivity` runs an EMR cluster, and `SqlActivity` runs SQL
- **Schedules.** When an activity runs
- **Resources.** The machines that do the work of an activity: an `Ec2Resource` or an `EmrCluster`. The pipeline starts EC2 instances itself, and a program called Task Runner picks up the work on them and carries it out
- **Preconditions.** Conditions that must hold before an activity starts. `S3KeyExists` checks whether a key is present in S3

To read one, start from the schedule and follow which activity takes which data node as its input, and the order of the work appears. The EC2 instances and EMR clusters named as resources are started inside your account.

### Building the same job today

AWS's migration guide has a table that turns Data Pipeline's words into those of the migration targets. The Step Functions column overlaps with tools this book has already used.

- A pipeline corresponds to the state machine of [chapter 16](/en/chapters/16-long-jobs.md)
- The JSON definition corresponds to an Amazon States Language definition, which chapter 16 wrote with the CDK
- An activity corresponds to a step of the state machine
- Trying again after a failure corresponds to a step's `Retry` and `Catch`
- The schedule corresponds to EventBridge Scheduler from [chapter 08](/en/chapters/08-async.md)

The difference is where the computing happens. Data Pipeline started EC2 instances and ran commands on them. Chapter 16's state machine calls a Lambda function at each step. You choose where the work runs as the target of a step, not in the pipeline's definition.

The migration guide recommends Step Functions for work that calls several AWS services in order without servers of your own. It recommends Glue for work that runs on Apache Spark and for pipelines made from a console template, such as exporting a DynamoDB table to S3. It recommends MWAA when you want to move to Apache Airflow, written in Python. This book builds neither Glue nor MWAA. Data flows for analysis are the subject of [chapter 26](/en/chapters/26-analytics.md).

In Data Pipeline's words, this chapter's job is "once a day, run a `CopyActivity` from an `S3DataNode` to an `S3DataNode`, and tell someone if it fails". Today it needs no state machine either. The DataSync task holds its own schedule and an EventBridge event announces its end, so no part is left whose job is to manage order. When you want another piece of work to follow the copy, that is the moment to add chapter 16's state machine and call the copy as one of its steps. The migration guide says Step Functions can call the operations of more than 250 services through its AWS SDK integration. This chapter does not build a step that starts a DataSync execution.

## Choosing how to move data

<!-- section: 38.choosing -->

"I want the data in A to be in B" leaves two things to decide: what is being moved (objects and files, rows of a database, or events that keep arriving) and when it moves (once, on a schedule, or continuously).

| When it moves | Objects and files | Databases | Events and logs |
| --- | --- | --- | --- |
| Once | DataSync, S3 Batch Operations, `aws s3 sync` | DMS | |
| On a schedule | A DataSync schedule | | |
| Continuously | S3 Replication | DMS ongoing replication | Firehose |

The table holds only what the author opened the documentation for today. Here is the condition for choosing each.

**DataSync** copies files and objects between storage systems and checks the contents with checksums during the transfer. The other side need not be S3: NFS and SMB file servers, EFS, FSx, and other clouds' object storage can all be a source or a destination. DataSync fits when you move what is already in a bucket, when you move the differences on a schedule, and when the data is somewhere other than S3. Its schedule cannot run more often than once an hour, so it does not suit continuous movement.

**S3 Replication** copies new and updated objects written to a bucket to another bucket, automatically and asynchronously. Objects that were there before it was set up are not replicated; for those, S3 Batch Replication replicates on request. If you want data to move from S3 to S3 as it is written, Replication is simpler than DataSync and lags less. [Chapter 28](/en/chapters/28-multi-region.md) covers Replication, so this chapter goes no further into it.

There is a reason this chapter uses DataSync and not Replication. According to S3's documentation, Replication needs versioning enabled on both buckets. Chapter 07's bucket does not have versioning enabled. DataSync can read a source bucket without changing any of its settings. When what you want moved is "everything that is there now", into an archive that may be a day behind, DataSync is enough.

**S3 Batch Operations** is a job that takes a list of objects (a manifest) and performs one operation on all of them. Besides copying, the operations include replacing tags and invoking a Lambda function. It is less a way to move data than a tool for applying one treatment, once, to a great many objects. The list can come from an S3 Inventory report.

**`aws s3 sync`** is an AWS CLI command that copies new and updated files between a local directory and S3, or between S3 and S3. The terminal running the command drives the copy, so if you want it to run regularly, arranging that is up to you. For a small number of objects, moved once, it is the quickest way. With `--delete` it removes from the destination the files that the source does not have.

**AWS Transfer Family** is a service in which AWS provides an SFTP, FTPS, FTP, or AS2 endpoint and puts the files that arrive in S3 or EFS. The other party decides whether you need it. It is the answer when a business partner says they can only send by SFTP, not a way to move your own data yourself.

**AWS Database Migration Service (DMS)** moves databases. It can migrate relational databases, data warehouses, and NoSQL databases once, or keep replicating their changes. Copying a database's files with DataSync does not give you a consistent copy of a running database. For a database, use DMS or the database's own backup and restore.

**Amazon Data Firehose** receives records as they arrive and writes them in batches to a destination such as S3. When what you move is not objects already in place but events and logs yet to be produced, Firehose fits. [Chapter 26](/en/chapters/26-analytics.md) covers it.

As for the Snow family, which moves data on physical devices, the first lines of the Snowball Edge documentation say it is no longer available to new customers. That page points to DataSync for online transfers and to AWS Data Transfer Terminal for physical ones. Only the top of that one page was checked; the other Snow devices and Data Transfer Terminal were not looked into.

Moving data to and from Cloudflare R2 is on [the last page](/en/chapters/38-data-movement/wrap.md).

[The next page](/en/chapters/38-data-movement/build.md) goes through DataSync's parts and settings in turn, and uses a local model to check what the task copies and what it deletes.
