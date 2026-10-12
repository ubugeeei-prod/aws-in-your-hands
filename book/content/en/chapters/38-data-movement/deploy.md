---
title: "38 Data Movement: Deploy"
---

# 38 Data Movement: Deploy

On this page you deploy the two stacks in order, run the task once by hand, and check that an object reaches the archive. The author has not run these steps on AWS. What is written as an expected result was read from the documentation.

## Putting it on AWS

<!-- section: 38.deploy -->

Context decides the shape of the stacks.

<<< @/examples/38-data-movement/infra/bin/app.ts{context}

With nothing added you get two buckets, two roles, and two locations. Nothing among them runs. `-c sourceLocation=<ARN>` adds to the Osaka stack the scheduled task, a log group, a rule, a function, and a topic.

<<< @/examples/38-data-movement/infra/bin/app.ts{stacks}

### Whether cdkd can create these resources

The pinned version of cdkd (0.296.28) has an implementation of its own for each resource type it knows and hands the types it has none for to Cloud Control API. The `dist` of the installed package was read to see which types this chapter's stacks use.

Types with an implementation of their own: `AWS::S3::Bucket`, `AWS::S3::BucketPolicy`, `AWS::IAM::Role`, `AWS::IAM::Policy`, `AWS::Lambda::Function`, `AWS::Lambda::Permission`, `AWS::Logs::LogGroup`, `AWS::Events::Rule`, `AWS::SNS::Topic`, and `AWS::SNS::TopicPolicy`.

Three types have none: `AWS::DataSync::LocationS3`, `AWS::DataSync::Task`, and `AWS::Logs::ResourcePolicy`. All three are in Cloud Control API's list of supported types with create, read, update, delete, and list. None of them is in cdkd's list of types that Cloud Control API cannot handle. That is as far as reading could confirm. Whether cdkd can really create these three is not known, because nothing was deployed. If it cannot, the thing to do is note the error and try deploying the same template with the AWS CDK CLI.

The stack tests pin the list of types in use. When a type is added, the test is what reminds you that this check has to be done again.

### The steps

```bash
vp run move:infra:diff
vp run move:infra:deploy
AIH_AWS_REGION=ap-northeast-3 vp run infra:bootstrap
vp run move:archive:infra:deploy -c sourceLocation=arn:aws:datasync:ap-northeast-1:123456789012:location/loc-xxxxxxxxxxxxxxxxx
```

The second line prints `SourceLocationArn`, and that value goes into the fourth. The third prepares cdkd's storage in the Osaka Region, the same preparation [chapter 10](/en/chapters/10-edge.md) made for `us-east-1`. Whether an account that has never used the Osaka Region needs anything more was not checked.

From the moment the fourth line finishes, the task runs every day at 18:00 UTC. To stop the schedule, delete the stack, or deploy again without `sourceLocation` to take the task out.

To receive the notifications, subscribe to the topic. The stack creates no subscription, so that no email address has to be written in the source.

```bash
aws sns subscribe --region ap-northeast-3 --topic-arn <AlertTopicArn> --protocol email --notification-endpoint you@example.com
```

### Running it and checking

Do not wait for the schedule: run it once by hand.

```bash
aws s3 cp ./photo.png s3://<UploadsBucketName>/u/demo/n1/a1
aws datasync start-task-execution --region ap-northeast-3 --task-arn <TaskArn>
aws datasync describe-task-execution --region ap-northeast-3 --task-execution-arn <TaskExecutionArn>
aws s3 ls s3://<ArchiveBucketName>/u/demo/ --recursive
aws logs tail <CopyLogGroupName> --region ap-northeast-3 --since 1h
```

The second line returns the ARN of the task execution. Run the third a few times and `Status` should go through `PREPARING`, `TRANSFERRING`, and `VERIFYING` and stop at `SUCCESS`. The same response carries the counts `FilesTransferred`, `BytesTransferred`, `FilesSkipped`, and `FilesVerified`. With a single image in the bucket, `FilesTransferred` shows that one image plus whatever counts as its prefixes. The documentation says S3 prefixes are counted as directories, so the number may not be 1.

If the fourth line shows the same key in the archive, the copy has arrived. The log group in the fifth line should be nearly empty when there were no errors.

Three more things are worth checking. The local model has no answer for any of them.

- **The same execution again.** Repeat the second and third lines and see `FilesTransferred` come to 0. This also shows how long an execution that copies nothing takes
- **A replacement.** Put a different file at the same key, run, and see with `aws s3api list-object-versions` that the archive has a new version
- **The failure notice.** The author has not prepared a safe way to make an execution fail. For the function alone, pass the Lambda console's test an event of the shape described on [the Design and Build page](/en/chapters/38-data-movement/build.md) with `State` set to `ERROR`, and see whether the notification arrives

### Drift

```bash
vp run move:infra:drift
```

The drift check looks at the Tokyo stack. No task is provided to check the Osaka stack for drift. DataSync may disable the task's schedule itself, and whether that change is reported as drift was not checked. The schedule's state can be read directly from `Schedule` in `aws datasync describe-task --region ap-northeast-3 --task-arn <TaskArn>`. When `Status` is `DISABLED` and `DisabledBy` is `SERVICE`, DataSync stopped it, and the reason is in `DisabledReason`.

[The next page](/en/chapters/38-data-movement/wrap.md) covers the cost, where things go wrong, and cleanup.
