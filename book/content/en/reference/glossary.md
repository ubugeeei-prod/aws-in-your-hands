---
title: "Glossary"
generated: true
---

<!-- Generated file. Do not edit. Source: data/glossary.json (tools/src/book/generate.ts) -->

# Glossary

The term pairs that keep both languages using one word for one concept. API names, CLI syntax, file names, and resource IDs are never translated.

| Japanese | English | First used | Meaning |
| --- | --- | --- | --- |
| アカウント | account | 01 | The container for AWS resources and their bill, identified by a 12-digit ID. |
| root ユーザー | root user | 01 | The identity that signs in with the account's email address and cannot be restricted. Not for everyday work. |
| 一時認証情報 | temporary credentials | 01 | An access key, secret key, and session token issued with an expiry. |
| リージョン | Region | 01 | A geographic unit in which AWS offers services. Tokyo is ap-northeast-1. |
| 予算（AWS Budgets） | budget (AWS Budgets) | 01 | A mechanism that notifies when spending passes, or is forecast to pass, a threshold. It is not a spending cap. |
| devShell | devShell | 02 | A shell environment, defined by a Nix flake, that contains tools at pinned versions. |
| タスク | task | 02 | In this book, something defined under run.tasks in vite.config.ts and executed with vp run <name>. |
| construct | construct | 02 | A TypeScript class in CDK that represents one or more AWS resources. |
| stack | stack | 02 | A unit of resources that are created, updated, and deleted together. |
| synth（合成） | synth (synthesis) | 02 | Running CDK code to produce a cloud assembly, including CloudFormation templates. It changes nothing in AWS. |
| diff | diff | 02 | A preview of an intended change: the template built from source compared with what the deployment tool has recorded. |
| drift | drift | 02 | A difference between what the deployment tool has recorded and the actual AWS configuration. |
| state | state | 02 | The deployment tool's record of what it created. For cdkd, JSON in S3. |
| origin | origin | 03 | Where a CDN fetches the original content from. In this book, an S3 bucket or an API. |
| origin access control (OAC) | origin access control (OAC) | 03 | A mechanism in which CloudFront signs its origin requests and the bucket admits only that distribution. |
| distribution | distribution | 03 | One CloudFront delivery configuration, with its own domain name. |
| edge location | edge location | 03 | A CloudFront site that serves cached responses close to the reader. |
| invalidation | invalidation | 03 | An operation that makes edge caches discard objects before they expire. |
| SPA fallback | SPA fallback | 03 | Answering URLs that match no file with index.html so that the client-side router handles them. |
| 実行環境 | execution environment | 04 | The isolated environment in which Lambda runs a function. Each handles one request at a time and may be reused or discarded. |
| cold start | cold start | 04 | An invocation that includes creating and initializing a new execution environment. |
| 実行 role | execution role | 04 | The IAM role a function assumes when it runs in AWS. It is separate from the developer's own permissions. |
| HTTP API | HTTP API | 04 | One kind of API Gateway API. Its features and prices differ from REST APIs and WebSocket APIs. |
| integration | integration | 04 | Where API Gateway sends a request that matched a route. In this book, a Lambda function. |
| runtime validation | runtime validation | 02 | Checking data against a schema when it arrives at run time. A type annotation does not do this. |
| invariant | invariant | 04 | A property that must hold at all times; the thing tests and failure injection target. |
| 冪等性 | idempotency | 08 | The property that performing the same operation several times has the same result as performing it once. |
| partition key | partition key | 05 | The key that decides where an item is stored. Items with the same value are stored together. |
| sort key | sort key | 05 | The key that orders and distinguishes items within one partition key value. |
| 条件式（condition expression） | condition expression | 05 | A condition sent with a write. If it does not hold, the write does not happen. |
| 楽観ロック | optimistic locking | 05 | Checking at write time that the stored version is still the one that was read, instead of locking in advance. |
| 結果整合の読み取り | eventually consistent read | 05 | A read that may not reflect a write completed a moment ago. The DynamoDB default. |
| 強整合の読み取り | strongly consistent read | 05 | A read that reflects every write that succeeded before it. |
| request unit | request unit | 05 | The billing unit in which on-demand DynamoDB counts reads and writes. |
| 認証 | authentication | 06 | Establishing who a call comes from. |
| 認可 | authorization | 06 | Deciding whether that caller may perform that operation. |
| user pool | user pool | 06 | Amazon Cognito's directory of users. It verifies passwords and issues tokens. |
| access token | access token | 06 | The token used to call an API. |
| ID token | ID token | 06 | The token that tells the app itself that sign-in happened and who the user is. It is not sent to APIs. |
| PKCE | PKCE | 06 | A mechanism that keeps an intercepted authorization code from being exchanged for tokens. |
| public client | public client | 06 | An app that cannot keep a secret, such as a SPA running in a browser. |
| JWT authorizer | JWT authorizer | 06 | The API Gateway HTTP API feature that verifies a token before the function is invoked. |
| channel | channel | 18 | The unit in IVS low-latency streaming that takes one broadcast and delivers it to viewers. It has an ingest endpoint and a playback URL. |
| stream key | stream key | 18 | The secret string an encoder presents when it sends to a channel. Anyone who has it can broadcast to that channel. |
| ingest | ingest | 18 | A service receiving the video that an encoder sends. |
| rendition | rendition | 18 | One version of the same video at a particular resolution and bitrate. The player switches between them to fit the connection. |
| timed metadata | timed metadata | 18 | A small piece of data embedded at a point in the video. It reaches each viewer at the same moment of the video, whatever that viewer's delay. |
| VPC | VPC | 11 | Virtual Private Cloud: your own IP network inside one Region. You choose its address range and divide it into subnets. |
| CIDR | CIDR | 11 | A way to write an address range as a first address and the number of leading bits it shares, such as `10.20.0.0/16`. A /16 holds 65,536 addresses, a /20 holds 4,096. |
| subnet | subnet | 11 | A slice of a VPC's address range that lives in one Availability Zone. Whether it is public or private follows from the route table associated with it. |
| Availability Zone（AZ） | Availability Zone (AZ) | 11 | A group of data centers inside a Region with its own power and networking. Zones in one Region are built not to fail together, but they do not protect against a failure of the whole Region. |
| route table | route table | 11 | A list of rules saying where traffic for each destination goes, associated with subnets. Whether a subnet has a way to the internet is decided here and nowhere else. |
| internet gateway | internet gateway | 11 | The door between a VPC and the internet, attached to the VPC. It has no charge of its own. |
| NAT Gateway | NAT gateway | 11 | A relay that lets resources in private subnets open connections outward and nothing inward. It sits in a public subnet with one Elastic IP address, and is billed both for every hour it exists and for every GB it passes. |
| security group | security group | 11 | Allow-only traffic rules attached to resources such as instances. Stateful: replies to allowed traffic pass without a rule in the other direction. |
| network ACL | network ACL | 11 | Traffic rules at a subnet's edge, with allow and deny rules evaluated in numeric order. Stateless: replies need their own allow rule. |
| gateway endpoint | gateway endpoint | 11 | A path to S3 and DynamoDB that does not cross the internet, installed as a route in route tables. It has no additional charge. |
| interface endpoint | interface endpoint | 11 | A doorway to an AWS service placed inside a subnet as a network interface with a private IP address (AWS PrivateLink). Billed by the hour per service and per Availability Zone. |
| 基盤モデル | foundation model | 17 | A pretrained model that Bedrock offers behind an API, selected by its model ID. |
| token | token | 17 | The unit in which a model reads and writes text, and the unit it is billed in. It is not a character count, and each model counts differently. |
| inference profile | inference profile | 17 | An ID for a model together with the Regions a request may be sent to. It is passed in place of a model ID. |
| cross-Region inference | cross-Region inference | 17 | Inference that, through an inference profile, may be processed in a Region other than the one you called. |
| response streaming | response streaming | 17 | A Lambda function sending its response piece by piece as it is produced, instead of buffering all of it. |
| function URL | function URL | 17 | An HTTPS endpoint attached directly to a Lambda function, with no API Gateway in between. |
| server-sent events（SSE） | server-sent events (SSE) | 17 | A format in which a server keeps sending events inside one HTTP response. Its content type is text/event-stream. |
| SigV4 署名 | SigV4 signature | 17 | The request signature AWS APIs use to identify the caller, computed from credentials and sent in headers. |
| identity（SES） | identity (SES) | 15 | A sender that SES has verified as yours: a domain or a single email address. Verified per Region. |
| sandbox（SES） | sandbox (SES) | 15 | The restricted state every new account's SES starts in: mail goes only to verified recipients. Left by requesting production access. |
| bounce | bounce | 15 | Mail that comes back undelivered. Permanent (hard), such as an address that does not exist, or temporary (soft). |
| complaint | complaint | 15 | A recipient reporting a mail as spam. |
| suppression list | suppression list | 15 | The list of addresses you will no longer mail, filled with those that bounced or complained. |
| configuration set | configuration set | 15 | A named group of SES settings chosen at send time, holding event destinations and suppression options. |
| SPF | SPF | 15 | A DNS TXT record naming the servers allowed to send for a domain. It is checked against the envelope sender (MAIL FROM) domain. |
| DKIM | DKIM | 15 | A digital signature on each mail, verified with a public key published in DNS. |
| DMARC | DMARC | 15 | A DNS policy that requires the visible From domain to be confirmed by SPF or DKIM, and says what to do with mail that fails. |
| CloudFront Functions | CloudFront Functions | 10 | Small JavaScript that runs at CloudFront edge locations on each request or response. It cannot reach the network or files and is used to rewrite URLs and headers. |
| viewer request | viewer request | 10 | The moment right after CloudFront receives a request from the reader, before it looks in the cache. |
| KeyValueStore | KeyValueStore | 10 | A store of key-value pairs that CloudFront Functions can read. Functions only read it; changes come from outside through an API. |
| Lambda@Edge | Lambda@Edge | 10 | A version of a Lambda function created in us-east-1 that CloudFront replicates around the world and invokes partway through a request. |
| ETag による条件付き更新 | ETag precondition | 10 | Sending the version (ETag) you read along with a write, so the write is refused if someone else changed the data in between. |
| migration | migration | 13 | A schema change kept as a numbered file, with the database itself recording which ones have been applied. |
| transaction | transaction | 13 | A group of SQL statements that takes effect entirely or not at all. |
| snapshot isolation | snapshot isolation | 13 | Isolation in which a transaction keeps reading the data as it was when the transaction started. PostgreSQL's REPEATABLE READ is this. |
| 楽観的同時実行制御（OCC） | optimistic concurrency control (OCC) | 13 | Checking for conflicts at commit instead of making transactions wait for locks; the transaction that loses fails. |
| serialization failure | serialization failure | 13 | The database's answer that a transaction could not commit because it conflicted with another. SQLSTATE 40001. Nothing was applied, so the transaction is run again from the start. |
| write skew | write skew | 13 | Two transactions decide from the same data and write different rows, breaking a condition that either alone would have kept. |
| database role | database role | 13 | A user inside the database. GRANTs to it decide what it may do to which table. Not the same thing as an IAM role. |
| 認証 token（Aurora DSQL） | authentication token (Aurora DSQL) | 13 | A time-limited string signed with IAM credentials, passed in place of a password when a connection is opened. |
| DPU | DPU | 13 | Distributed Processing Unit: the billing unit in which Aurora DSQL measures the compute, reads, and writes spent running SQL. |
| ACU | ACU | 13 | Aurora Capacity Unit: the capacity unit of Aurora Serverless v2. One ACU is about 2 GiB of memory with matching CPU and networking. |
| presigned URL | presigned URL | 07 | A URL that carries a signature and an expiry. Whoever holds it can perform one fixed operation, within the permissions of whoever signed it. |
| POST policy | POST policy | 07 | A signed document listing the conditions (key, type, size range, expiry) that a browser's form upload to S3 must meet. |
| object key | object key | 07 | The name that identifies an object within a bucket. It may contain `/`, but there are no folders. |
| bearer token | bearer token | 07 | A credential that works for whoever holds it. Nothing checks who that is. |
| lifecycle rule | lifecycle rule | 07 | A bucket setting under which S3 itself deletes (or moves) matching objects a number of days after they were created. |
| Block Public Access | Block Public Access | 07 | Four S3 settings that reject or ignore ACLs and bucket policies that would make a bucket or object public. |
| 孤立した object | orphaned object | 07 | An object that is in the bucket while no record points at it. Nobody sees it, and it is still billed for storage. |
| multipart upload | multipart upload | 07 | S3's way of sending a large object in parts. Parts of an upload that is neither completed nor aborted stay stored. |
| server-side rendering (SSR) | server-side rendering (SSR) | 09 | Building the HTML on a server for each request. The browser shows that HTML first, and JavaScript takes over afterwards. |
| 共有 cache | shared cache | 09 | A cache that stores one response and returns it to many users, such as a CDN. The cache inside a browser belongs to one person and is called a private cache. |
| cache key | cache key | 09 | What CloudFront treats as the same request: the path plus whichever query strings, headers, and cookies the cache policy selects. |
| cache policy | cache policy | 09 | A CloudFront setting that holds what goes into the cache key and the minimum, default, and maximum TTL. |
| backend for frontend (BFF) | backend for frontend (BFF) | 09 | A server that exists for one front end. It holds tokens on the browser's behalf and calls the APIs behind it. |
| 構造化ログ | structured log | 19 | A log whose every line is one JSON object, so it can be filtered and counted by field name. |
| メトリクス | metric | 19 | A series of numbers over time, such as request counts, error counts or latency. In CloudWatch a name, a namespace and a set of dimensions make one metric. |
| アラーム | alarm | 19 | The CloudWatch feature that changes state, and triggers actions such as a notification, when a metric keeps meeting a condition. States are OK, ALARM and INSUFFICIENT_DATA. |
| metric filter | metric filter | 19 | A CloudWatch Logs setting that counts incoming log lines matching a pattern and publishes the count as a metric. It does not apply to logs from before it was created. |
| embedded metric format（EMF） | embedded metric format (EMF) | 19 | A JSON shape that, written to a log, makes CloudWatch extract metrics from it. |
| trace | trace | 19 | The record of the work one request passed through: a set of spans that share a trace ID. |
| span | span | 19 | One timed step in a trace, with a name, start and end times, a parent span and attributes. In X-Ray it becomes a segment or a subsegment. |
| OpenTelemetry | OpenTelemetry | 19 | Vendor-neutral specifications and libraries for instrumenting and exporting traces, metrics and logs. |
| sampling | sampling | 19 | Recording only a share of requests as traces instead of all of them. |
| trace context（traceparent） | trace context (traceparent) | 19 | The W3C specification for passing the trace ID, the caller's span ID and the sampling decision to the next process. In HTTP it is the traceparent header. |
| RUM（real user monitoring） | RUM (real user monitoring) | 19 | Measuring page load times and errors in real users' browsers and collecting them. |
| canary（Synthetics） | canary (Synthetics) | 19 | A script that calls an API or page from outside on a schedule and checks the response. It runs even when no user is around. |
| TTL | TTL | 14 | Time to live: an expiry attached to a piece of data. When expired data is actually removed depends on the store; in DynamoDB it can be days later. |
| rate limit | rate limit | 14 | A cap on how many calls one caller may make in a period. It holds only if the counter is shared by everyone and counting and comparing are a single step. |
| 固定窓 | fixed window | 14 | A rate limit that cuts time into equal periods and counts per period. Around a boundary it lets up to twice the limit through in a short time. |
| 滑る窓 | sliding window | 14 | A rate limit that also counts the previous period, in proportion to how much of it the window still covers. It prevents the doubling at a boundary. |
| 原子的な加算 | atomic counter | 14 | An update that adds one as a single step inside the store instead of reading and then writing, so concurrent increments are not lost. |
| Valkey | Valkey | 14 | An in-memory key-value server, forked from open source Redis right before its license changed, and one of the engines ElastiCache runs. |
| ECPU | ECPU | 14 | ElastiCache Processing Unit: the billing unit for requests to ElastiCache Serverless. A simple read or write uses 1 ECPU per KB transferred. |
| read-through cache | read-through cache | 14 | Reading the cache first and, on a miss, reading the source of truth and storing a copy. The source is always right; the cache is a copy. |
| stale read | stale read | 14 | Reading an old copy after the source changed. It happens whenever there is a cache, so decide beforehand how old is acceptable. |
| cache stampede | cache stampede | 14 | Many requests missing at the moment an entry expires, and all of them going to the source of truth at once. |
| single flight | single flight | 14 | Waiting for a load of the same key that is already in progress instead of starting another. It works within one process only. |
| CloudFormation | CloudFormation | 20 | The AWS service that takes a template, creates the resources, and records what it created as a stack. By default it rolls a failed update back. |
| CDK の bootstrap | CDK bootstrap | 20 | The one-time preparation per account and Region before deploying with the AWS CDK CLI. A stack named CDKToolkit creates an asset bucket, an ECR repository, and five IAM roles. Not the same as cdkd's bootstrap. |
| change set | change set | 20 | A list of what a stack update would add, modify, replace, or delete, made before anything runs. Nothing changes until it is executed, and it does not guarantee success. |
| OIDC（OpenID Connect） | OIDC (OpenID Connect) | 20 | A standard for proving who you are to one service with a signed token issued by another. In this book, how a GitHub Actions job gets into AWS. |
| trust policy | trust policy | 20 | The part of an IAM role that says who may use it. Separate from the permission policies that say what the role may do. |
| sub（subject）claim | sub (subject) claim | 20 | The string in an OIDC token that says what the token was issued for. In GitHub Actions it holds the repository and a branch, an environment, or the pull request marker. |
| Lambda の version | Lambda version | 20 | A numbered copy of a function's code and configuration that cannot change once published. The unpublished latest state is called $LATEST. |
| Lambda の alias | Lambda alias | 20 | A named pointer to a version. Callers invoke the alias, and moving it switches versions. It can also split traffic between two versions by weight. |
| rollback | rollback | 20 | Returning a change to the state before it. CloudFormation puts back the configuration of the resources in the template, not the data written in the meantime. |
| termination protection | termination protection | 20 | A setting that refuses to delete a stack: DeleteStack fails until it is turned off. It does not stop an update from removing resources. |
| preview 環境 | preview environment | 20 | A temporary environment created per pull request; in this book, one stack per pull request, made to be deleted when the pull request closes. |
| nested stack | nested stack | 20 | A stack created as a resource (AWS::CloudFormation::Stack) of another stack. Drift detection on the parent does not look inside it. |
| コンテナ image | container image | 12 | An application packed together with every file it needs to run. The same image starts a container with the same contents wherever it runs. |
| Docker daemon | Docker daemon | 12 | The long-running program (dockerd) that actually builds images and runs containers. The `docker` command is only a client that sends it requests. |
| image の tag | image tag | 12 | A name given to an image inside a repository, such as `v1` or a commit hash. With immutable tags, a tag can never be moved to a different image. |
| ECR の repository | ECR repository | 12 | A place for images in Amazon ECR. ECS pulls images from it. |
| task definition | task definition | 12 | The blueprint that says which image runs, with how much CPU and memory, and with which roles and environment variables. Every change makes a new revision; an existing revision is never edited. |
| task | task | 12 | One running instance started from a task definition. On Fargate each task has its own network interface and private IP address. |
| service（ECS） | service (ECS) | 12 | The instruction to keep N tasks of a task definition running, and the machinery that keeps it true: it replaces tasks that die and swaps them when the task definition changes. |
| Fargate | Fargate | 12 | A way to run containers without owning the servers under them, billed by the CPU and memory size of each task and the time it runs. |
| Application Load Balancer（ALB） | Application Load Balancer (ALB) | 12 | The entry point that receives HTTP requests and spreads them over the tasks behind it. It is billed for every hour it exists. |
| target group | target group | 12 | The list of destinations an ALB routes to. Task IP addresses are registered in it, and it holds the health check settings. |
| health check | health check | 12 | The request an ALB sends to each target at intervals. A target that keeps failing it stops receiving requests. |
| deregistration delay | deregistration delay | 12 | How long an ALB waits for in-flight requests to finish on a target that is being removed from the target group. 300 seconds by default. |
| rolling update | rolling update | 12 | Replacing tasks by starting new ones and stopping old ones once the new ones are healthy. Old and new versions run side by side while it lasts. |
| deployment circuit breaker | deployment circuit breaker | 12 | The mechanism that declares a deployment failed when new tasks keep failing to start or to pass health checks. Optionally it rolls back to the last deployment that completed. |
| task role | task role | 12 | The IAM role that application code inside the container uses when it calls AWS. The counterpart of a Lambda function's execution role. |
| task execution role | task execution role | 12 | The IAM role the ECS agent uses, before the application starts, to pull the image and ship logs. Application code cannot use it. |
| graceful shutdown | graceful shutdown | 12 | A process that has been told to stop refuses new work, finishes the work in progress, and only then exits. |
| SIGTERM | SIGTERM | 12 | The signal that asks a process to terminate. The process may clean up first. If it does not finish in time, SIGKILL follows, which cannot be handled. |
| target tracking | target tracking | 12 | An auto scaling policy where you name a metric and a target value, such as 60 percent average CPU, and leave the number of tasks to the service. |
| queue | queue | 08 | A place that holds messages describing work to be done until something takes them out. The sender and the worker no longer have to be running at the same moment. |
| at-least-once 配送 | at-least-once delivery | 08 | A guarantee that a message arrives at least one time. It may arrive more than once. It is not "exactly once". |
| visibility timeout | visibility timeout | 08 | In SQS, how long a received message is hidden from other receivers. If it is not deleted within that time, it can be received again. |
| dead-letter queue（DLQ） | dead-letter queue (DLQ) | 08 | A second queue where messages are set aside after being received a set number of times without being finished. A place for a person to look. |
| redrive | redrive | 08 | Moving messages from a dead-letter queue back to the queue they came from, to be handled again. |
| event source mapping | event source mapping | 08 | The Lambda setting under which Lambda itself reads a queue or stream and hands batches to a function. Batch size and the concurrency limit are set here. |
| partial batch response | partial batch response | 08 | A function's reply that names only the messages of a batch that failed, so that the ones that succeeded are not retried. |
| 冪等性の鍵 | idempotency key | 08 | The value that tells whether two requests are the same piece of work. It comes from the work itself, not from a value that changes with each delivery, such as a message ID. |
| sequencer | sequencer | 08 | A hexadecimal string S3 puts on create and delete events. Between two events for the same key, the greater one happened later. |
| backpressure | backpressure | 08 | Slowing the flow when the worker cannot keep up, by letting the delay be felt upstream. A queue takes it on in the form of a growing backlog. |
| 突き合わせ | reconciliation | 08 | Comparing what two stores hold right now and fixing the differences, without waiting for an event. It works even when an event is late or lost. |
| instance（EC2） | instance (EC2) | 23 | One virtual machine rented from EC2. Everything from the operating system up is yours to look after. Billed while running; its volumes are billed even when it is stopped. |
| AMI | AMI | 23 | Amazon Machine Image: the template for an instance's first disk. It decides the operating system and what is installed from the start. |
| instance profile | instance profile | 23 | The container that hands an IAM role to an EC2 instance. One profile holds one role. |
| IMDS | IMDS | 23 | Instance Metadata Service: an address reachable only from inside the instance (169.254.169.254) that returns facts about the instance and temporary credentials for its role. IMDSv2 requires fetching a token first. |
| user data | user data | 23 | Data handed to an instance at launch. A shell script given this way runs once, as root, on the first boot. |
| EBS volume | EBS volume | 23 | A network-attached disk for an instance. It belongs to one Availability Zone and attaches only to instances in that zone. It can outlive the instance. |
| snapshot（EBS） | snapshot (EBS) | 23 | A point-in-time copy of a volume. Stored incrementally, and restorable as a volume in any zone of the Region. |
| Session Manager | Session Manager | 23 | A Systems Manager feature that opens a shell over a connection the SSM Agent on the instance made outward. No inbound port and no SSH key. |
| Run Command | Run Command | 23 | A Systems Manager feature that sends commands to an instance, runs them, and returns the result. Not interactive. |
| unit（systemd） | unit (systemd) | 23 | A file that tells systemd what to run, as whom, how to start it, and what to do when it dies. Those that define a service end in `.service`. |
| status check | status check | 23 | A check EC2 runs on an instance every minute. System status checks look at the AWS infrastructure underneath; instance status checks look at the instance itself. |
| 単一障害点 | single point of failure | 23 | A part whose failure stops the whole. One instance, and its one volume, are exactly that. |
| CPU credit | CPU credit | 23 | What T-family instances earn and spend to use CPU above their baseline. In standard mode an empty balance means throttling to the baseline; in unlimited mode the excess is billed. |
| workflow | workflow | 16 | Work made of several steps run in a defined order under defined conditions, where something outside the steps remembers how far it has got. |
| state machine | state machine | 16 | A workflow definition in Step Functions: states such as Task and Choice, and how they connect, written as JSON. |
| Amazon States Language | Amazon States Language | 16 | The JSON language that Step Functions state machines are written in. ASL for short. |
| state transition | state transition | 16 | One move of an execution from a state to the next. It is the billing unit of Standard workflows, and a retry counts as one. |
| checkpoint | checkpoint | 16 | Saving "done up to here" partway through long work, or the record itself. A rerun continues from the last checkpoint. |
| durable function | durable function | 16 | A Lambda function whose step results Lambda stores; after an interruption it runs again from the top and skips the finished steps. One invocation is limited to 15 minutes, the whole execution to one year. |
| replay | replay | 16 | Running the code again from the beginning while using the stored results of finished steps. It works only if the code calls the same steps in the same order for the same input. |
| 補償処理 | compensation | 16 | Undoing work that got partway by running other steps that cancel the effects of the finished ones. Unlike a database rollback, you write it yourself, and it can fail too. |
| manifest | manifest | 16 | A small file listing the files that make up an output. Written last, it is the sign that everything is there. |
| 条件付き書き込み | conditional write | 16 | A write with a condition such as "only if absent" or "only if still this version", where the store checks the condition and writes as a single step. |
| Standard workflow | Standard workflow | 16 | One of the two Step Functions workflow types: up to a year, state persisted between states, billed per state transition. The other is Express, up to five minutes. |
| AWS Batch | AWS Batch | 16 | A service that queues container jobs and provisions the compute (Fargate or EC2) to run them. |
| 最小権限 | least privilege | 21 | Allowing only the actions a job needs, on only the resources it needs. Permissions that might be useful later are left out. |
| secret | secret | 21 | A value that must not leak, such as a signing key, an API key, or a password. In Secrets Manager, one resource holding the encrypted value, its versions, and who may read it. |
| staging label | staging label | 21 | A name tag Secrets Manager puts on a version of a secret. It manages three: AWSCURRENT (the value now), AWSPREVIOUS (the one before), and AWSPENDING (mid-rotation). |
| rotation | rotation | 21 | Replacing a secret's value with a new one. Not everyone holds the new value the moment it changes, so the old one stays accepted for a while. |
| KMS key | KMS key | 21 | An encryption key held by AWS KMS. The key cannot be taken out; you call an API to encrypt or decrypt. A customer managed key you create has a monthly fee; an AWS managed key a service creates does not. |
| web ACL | web ACL | 21 | The unit of AWS WAF configuration: an ordered list of rules. Associated with CloudFront, an ALB, and so on, it inspects requests before they arrive. It carries a monthly fee just for existing. |
| managed rule group | managed rule group | 21 | A set of WAF rules maintained by AWS or a third party, who also updates them. Inside a web ACL it counts as one rule. |
| management event | management event | 21 | The record of an API call that creates, changes, deletes, or reads the configuration of a resource. CloudTrail keeps 90 days of them by default. Data events, such as reading an S3 object, are not included. |
| SCP（service control policy） | SCP (service control policy) | 21 | In AWS Organizations, a policy that sets the upper bound on what IAM users and roles in member accounts can be allowed. It grants nothing, and does not apply to the management account. |
| management account | management account | 21 | The account that created the organization. It pays the consolidated bill and attaches SCPs. SCPs do not restrict it, so it is not used for everyday work. |
| PITR（point-in-time recovery） | PITR (point-in-time recovery) | 22 | Restoring to the state at some past moment. In DynamoDB, a new table holding the contents as of a chosen second is built from continuous backups; the source table is not rewritten. |
| RPO（recovery point objective） | RPO (recovery point objective) | 22 | The target for how far back you may lose data in an incident, expressed as time. What was actually lost is the gap between the restore point and the incident. |
| RTO（recovery time objective） | RTO (recovery time objective) | 22 | The target for how long it may take from an incident until the service is usable again. Measured to the moment users read correct data, not to the moment a restore API returns. |
| delete marker | delete marker | 22 | The marker S3 places when an object in a versioning-enabled bucket is deleted without naming a version. The bytes stay, and the marker becomes the newest version. Deleting the marker brings the object back. |
