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
| コンストラクト（construct） | construct | 02 | A TypeScript class in CDK that represents one or more AWS resources. |
| スタック | stack | 02 | A unit of resources that are created, updated, and deleted together. |
| synth（合成） | synth (synthesis) | 02 | Running CDK code to produce a cloud assembly, including CloudFormation templates. It changes nothing in AWS. |
| diff | diff | 02 | A preview of an intended change: the template built from source compared with what the deployment tool has recorded. |
| ドリフト | drift | 02 | A difference between what the deployment tool has recorded and the actual AWS configuration. |
| state | state | 02 | The deployment tool's record of what it created. For cdkd, JSON in S3. |
| オリジン | origin | 03 | Where a CDN fetches the original content from. In this book, an S3 bucket or an API. |
| origin access control (OAC) | origin access control (OAC) | 03 | A mechanism in which CloudFront signs its origin requests and the bucket admits only that distribution. |
| ディストリビューション | distribution | 03 | One CloudFront delivery configuration, with its own domain name. |
| エッジロケーション | edge location | 03 | A CloudFront site that serves cached responses close to the reader. |
| キャッシュの無効化（invalidation） | invalidation | 03 | An operation that makes edge caches discard objects before they expire. |
| SPA フォールバック | SPA fallback | 03 | Answering URLs that match no file with index.html so that the client-side router handles them. |
| 実行環境 | execution environment | 04 | The isolated environment in which Lambda runs a function. Each handles one request at a time and may be reused or discarded. |
| コールドスタート | cold start | 04 | An invocation that includes creating and initializing a new execution environment. |
| 実行ロール | execution role | 04 | The IAM role a function assumes when it runs in AWS. It is separate from the developer's own permissions. |
| HTTP API | HTTP API | 04 | One kind of API Gateway API. Its features and prices differ from REST APIs and WebSocket APIs. |
| 統合（integration） | integration | 04 | Where API Gateway sends a request that matched a route. In this book, a Lambda function. |
| runtime validation | runtime validation | 02 | Checking data against a schema when it arrives at run time. A type annotation does not do this. |
| 不変条件 | invariant | 04 | A property that must hold at all times; the thing tests and failure injection target. |
| 冪等性 | idempotency | 05 | The property that performing the same operation several times has the same result as performing it once. |
| パーティションキー | partition key | 05 | The key that decides where an item is stored. Items with the same value are stored together. |
| ソートキー | sort key | 05 | The key that orders and distinguishes items within one partition key value. |
| 条件式（condition expression） | condition expression | 05 | A condition sent with a write. If it does not hold, the write does not happen. |
| 楽観ロック | optimistic locking | 05 | Checking at write time that the stored version is still the one that was read, instead of locking in advance. |
| 結果整合の読み取り | eventually consistent read | 05 | A read that may not reflect a write completed a moment ago. The DynamoDB default. |
| 強整合の読み取り | strongly consistent read | 05 | A read that reflects every write that succeeded before it. |
| request unit | request unit | 05 | The billing unit in which on-demand DynamoDB counts reads and writes. |
| 認証 | authentication | 06 | Establishing who a call comes from. |
| 認可 | authorization | 06 | Deciding whether that caller may perform that operation. |
| ユーザープール | user pool | 06 | Amazon Cognito's directory of users. It verifies passwords and issues tokens. |
| アクセストークン | access token | 06 | The token used to call an API. |
| ID トークン | ID token | 06 | The token that tells the app itself that sign-in happened and who the user is. It is not sent to APIs. |
| PKCE | PKCE | 06 | A mechanism that keeps an intercepted authorization code from being exchanged for tokens. |
| パブリッククライアント | public client | 06 | An app that cannot keep a secret, such as a SPA running in a browser. |
| JWT オーソライザー | JWT authorizer | 06 | The API Gateway HTTP API feature that verifies a token before the function is invoked. |
| チャンネル | channel | 18 | The unit in IVS low-latency streaming that takes one broadcast and delivers it to viewers. It has an ingest endpoint and a playback URL. |
| ストリームキー | stream key | 18 | The secret string an encoder presents when it sends to a channel. Anyone who has it can broadcast to that channel. |
| ingest | ingest | 18 | A service receiving the video that an encoder sends. |
| レンディション（rendition） | rendition | 18 | One version of the same video at a particular resolution and bitrate. The player switches between them to fit the connection. |
| timed metadata | timed metadata | 18 | A small piece of data embedded at a point in the video. It reaches each viewer at the same moment of the video, whatever that viewer's delay. |
| VPC | VPC | 11 | Virtual Private Cloud: your own IP network inside one Region. You choose its address range and divide it into subnets. |
| CIDR | CIDR | 11 | A way to write an address range as a first address and the number of leading bits it shares, such as `10.20.0.0/16`. A /16 holds 65,536 addresses, a /20 holds 4,096. |
| サブネット | subnet | 11 | A slice of a VPC's address range that lives in one Availability Zone. Whether it is public or private follows from the route table associated with it. |
| Availability Zone（AZ） | Availability Zone (AZ) | 11 | A group of data centers inside a Region with its own power and networking. Zones in one Region are built not to fail together, but they do not protect against a failure of the whole Region. |
| ルートテーブル | route table | 11 | A list of rules saying where traffic for each destination goes, associated with subnets. Whether a subnet has a way to the internet is decided here and nowhere else. |
| インターネットゲートウェイ | internet gateway | 11 | The door between a VPC and the internet, attached to the VPC. It has no charge of its own. |
| NAT Gateway | NAT gateway | 11 | A relay that lets resources in private subnets open connections outward and nothing inward. It sits in a public subnet with one Elastic IP address, and is billed both for every hour it exists and for every GB it passes. |
| セキュリティグループ | security group | 11 | Allow-only traffic rules attached to resources such as instances. Stateful: replies to allowed traffic pass without a rule in the other direction. |
| ネットワーク ACL | network ACL | 11 | Traffic rules at a subnet's edge, with allow and deny rules evaluated in numeric order. Stateless: replies need their own allow rule. |
| ゲートウェイエンドポイント | gateway endpoint | 11 | A path to S3 and DynamoDB that does not cross the internet, installed as a route in route tables. It has no additional charge. |
| インターフェースエンドポイント | interface endpoint | 11 | A doorway to an AWS service placed inside a subnet as a network interface with a private IP address (AWS PrivateLink). Billed by the hour per service and per Availability Zone. |
| 基盤モデル | foundation model | 17 | A pretrained model that Bedrock offers behind an API, selected by its model ID. |
| トークン | token | 17 | The unit in which a model reads and writes text, and the unit it is billed in. It is not a character count, and each model counts differently. |
| inference profile | inference profile | 17 | An ID for a model together with the Regions a request may be sent to. It is passed in place of a model ID. |
| cross-Region inference | cross-Region inference | 17 | Inference that, through an inference profile, may be processed in a Region other than the one you called. |
| レスポンスストリーミング | response streaming | 17 | A Lambda function sending its response piece by piece as it is produced, instead of buffering all of it. |
| function URL | function URL | 17 | An HTTPS endpoint attached directly to a Lambda function, with no API Gateway in between. |
| server-sent events（SSE） | server-sent events (SSE) | 17 | A format in which a server keeps sending events inside one HTTP response. Its content type is text/event-stream. |
| SigV4 署名 | SigV4 signature | 17 | The request signature AWS APIs use to identify the caller, computed from credentials and sent in headers. |
| identity（SES） | identity (SES) | 15 | A sender that SES has verified as yours: a domain or a single email address. Verified per Region. |
| サンドボックス（SES） | sandbox (SES) | 15 | The restricted state every new account's SES starts in: mail goes only to verified recipients. Left by requesting production access. |
| bounce | bounce | 15 | Mail that comes back undelivered. Permanent (hard), such as an address that does not exist, or temporary (soft). |
| complaint | complaint | 15 | A recipient reporting a mail as spam. |
| 送信停止の一覧（suppression list） | suppression list | 15 | The list of addresses you will no longer mail, filled with those that bounced or complained. |
| configuration set | configuration set | 15 | A named group of SES settings chosen at send time, holding event destinations and suppression options. |
| SPF | SPF | 15 | A DNS TXT record naming the servers allowed to send for a domain. It is checked against the envelope sender (MAIL FROM) domain. |
| DKIM | DKIM | 15 | A digital signature on each mail, verified with a public key published in DNS. |
| DMARC | DMARC | 15 | A DNS policy that requires the visible From domain to be confirmed by SPF or DKIM, and says what to do with mail that fails. |
| CloudFront Functions | CloudFront Functions | 10 | Small JavaScript that runs at CloudFront edge locations on each request or response. It cannot reach the network or files and is used to rewrite URLs and headers. |
| viewer request | viewer request | 10 | The moment right after CloudFront receives a request from the reader, before it looks in the cache. |
| KeyValueStore | KeyValueStore | 10 | A store of key-value pairs that CloudFront Functions can read. Functions only read it; changes come from outside through an API. |
| Lambda@Edge | Lambda@Edge | 10 | A version of a Lambda function created in us-east-1 that CloudFront replicates around the world and invokes partway through a request. |
| ETag による条件付き更新 | ETag precondition | 10 | Sending the version (ETag) you read along with a write, so the write is refused if someone else changed the data in between. |
| マイグレーション | migration | 13 | A schema change kept as a numbered file, with the database itself recording which ones have been applied. |
| トランザクション | transaction | 13 | A group of SQL statements that takes effect entirely or not at all. |
| snapshot isolation | snapshot isolation | 13 | Isolation in which a transaction keeps reading the data as it was when the transaction started. PostgreSQL's REPEATABLE READ is this. |
| 楽観的同時実行制御（OCC） | optimistic concurrency control (OCC) | 13 | Checking for conflicts at commit instead of making transactions wait for locks; the transaction that loses fails. |
| serialization failure | serialization failure | 13 | The database's answer that a transaction could not commit because it conflicted with another. SQLSTATE 40001. Nothing was applied, so the transaction is run again from the start. |
| write skew | write skew | 13 | Two transactions decide from the same data and write different rows, breaking a condition that either alone would have kept. |
| データベースロール | database role | 13 | A user inside the database. GRANTs to it decide what it may do to which table. Not the same thing as an IAM role. |
| 認証トークン（Aurora DSQL） | authentication token (Aurora DSQL) | 13 | A time-limited string signed with IAM credentials, passed in place of a password when a connection is opened. |
| DPU | DPU | 13 | Distributed Processing Unit: the billing unit in which Aurora DSQL measures the compute, reads, and writes spent running SQL. |
| ACU | ACU | 13 | Aurora Capacity Unit: the capacity unit of Aurora Serverless v2. One ACU is about 2 GiB of memory with matching CPU and networking. |
| 署名付き URL | presigned URL | 07 | A URL that carries a signature and an expiry. Whoever holds it can perform one fixed operation, within the permissions of whoever signed it. |
| POST ポリシー | POST policy | 07 | A signed document listing the conditions (key, type, size range, expiry) that a browser's form upload to S3 must meet. |
| オブジェクトキー | object key | 07 | The name that identifies an object within a bucket. It may contain `/`, but there are no folders. |
| ベアラートークン | bearer token | 07 | A credential that works for whoever holds it. Nothing checks who that is. |
| ライフサイクルルール | lifecycle rule | 07 | A bucket setting under which S3 itself deletes (or moves) matching objects a number of days after they were created. |
| Block Public Access | Block Public Access | 07 | Four S3 settings that reject or ignore ACLs and bucket policies that would make a bucket or object public. |
| 孤立したオブジェクト | orphaned object | 07 | An object that is in the bucket while no record points at it. Nobody sees it, and it is still billed for storage. |
| マルチパートアップロード | multipart upload | 07 | S3's way of sending a large object in parts. Parts of an upload that is neither completed nor aborted stay stored. |
| server-side rendering (SSR) | server-side rendering (SSR) | 09 | Building the HTML on a server for each request. The browser shows that HTML first, and JavaScript takes over afterwards. |
| 共有キャッシュ | shared cache | 09 | A cache that stores one response and returns it to many users, such as a CDN. The cache inside a browser belongs to one person and is called a private cache. |
| キャッシュキー | cache key | 09 | What CloudFront treats as the same request: the path plus whichever query strings, headers, and cookies the cache policy selects. |
| キャッシュポリシー | cache policy | 09 | A CloudFront setting that holds what goes into the cache key and the minimum, default, and maximum TTL. |
| backend for frontend (BFF) | backend for frontend (BFF) | 09 | A server that exists for one front end. It holds tokens on the browser's behalf and calls the APIs behind it. |
| 構造化ログ | structured log | 19 | A log whose every line is one JSON object, so it can be filtered and counted by field name. |
| メトリクス | metric | 19 | A series of numbers over time, such as request counts, error counts or latency. In CloudWatch a name, a namespace and a set of dimensions make one metric. |
| アラーム | alarm | 19 | The CloudWatch feature that changes state, and triggers actions such as a notification, when a metric keeps meeting a condition. States are OK, ALARM and INSUFFICIENT_DATA. |
| メトリクスフィルター | metric filter | 19 | A CloudWatch Logs setting that counts incoming log lines matching a pattern and publishes the count as a metric. It does not apply to logs from before it was created. |
| embedded metric format（EMF） | embedded metric format (EMF) | 19 | A JSON shape that, written to a log, makes CloudWatch extract metrics from it. |
| トレース | trace | 19 | The record of the work one request passed through: a set of spans that share a trace ID. |
| スパン | span | 19 | One timed step in a trace, with a name, start and end times, a parent span and attributes. In X-Ray it becomes a segment or a subsegment. |
| OpenTelemetry | OpenTelemetry | 19 | Vendor-neutral specifications and libraries for instrumenting and exporting traces, metrics and logs. |
| サンプリング | sampling | 19 | Recording only a share of requests as traces instead of all of them. |
| trace context（traceparent） | trace context (traceparent) | 19 | The W3C specification for passing the trace ID, the caller's span ID and the sampling decision to the next process. In HTTP it is the traceparent header. |
| RUM（real user monitoring） | RUM (real user monitoring) | 19 | Measuring page load times and errors in real users' browsers and collecting them. |
| canary（Synthetics） | canary (Synthetics) | 19 | A script that calls an API or page from outside on a schedule and checks the response. It runs even when no user is around. |
| TTL | TTL | 14 | Time to live: an expiry attached to a piece of data. When expired data is actually removed depends on the store; in DynamoDB it can be days later. |
| レート制限 | rate limit | 14 | A cap on how many calls one caller may make in a period. It holds only if the counter is shared by everyone and counting and comparing are a single step. |
| 固定窓 | fixed window | 14 | A rate limit that cuts time into equal periods and counts per period. Around a boundary it lets up to twice the limit through in a short time. |
| 滑る窓 | sliding window | 14 | A rate limit that also counts the previous period, in proportion to how much of it the window still covers. It prevents the doubling at a boundary. |
| 原子的な加算 | atomic counter | 14 | An update that adds one as a single step inside the store instead of reading and then writing, so concurrent increments are not lost. |
| Valkey | Valkey | 14 | An in-memory key-value server, forked from open source Redis right before its license changed, and one of the engines ElastiCache runs. |
| ECPU | ECPU | 14 | ElastiCache Processing Unit: the billing unit for requests to ElastiCache Serverless. A simple read or write uses 1 ECPU per KB transferred. |
| read-through cache | read-through cache | 14 | Reading the cache first and, on a miss, reading the source of truth and storing a copy. The source is always right; the cache is a copy. |
| stale read | stale read | 14 | Reading an old copy after the source changed. It happens whenever there is a cache, so decide beforehand how old is acceptable. |
| キャッシュスタンピード | cache stampede | 14 | Many requests missing at the moment an entry expires, and all of them going to the source of truth at once. |
| single flight | single flight | 14 | Waiting for a load of the same key that is already in progress instead of starting another. It works within one process only. |
| CloudFormation | CloudFormation | 20 | The AWS service that takes a template, creates the resources, and records what it created as a stack. By default it rolls a failed update back. |
| CDK の bootstrap | CDK bootstrap | 20 | The one-time preparation per account and Region before deploying with the AWS CDK CLI. A stack named CDKToolkit creates an asset bucket, an ECR repository, and five IAM roles. Not the same as cdkd's bootstrap. |
| 変更セット | change set | 20 | A list of what a stack update would add, modify, replace, or delete, made before anything runs. Nothing changes until it is executed, and it does not guarantee success. |
| OIDC（OpenID Connect） | OIDC (OpenID Connect) | 20 | A standard for proving who you are to one service with a signed token issued by another. In this book, how a GitHub Actions job gets into AWS. |
| 信頼ポリシー | trust policy | 20 | The part of an IAM role that says who may use it. Separate from the permission policies that say what the role may do. |
| sub（subject）claim | sub (subject) claim | 20 | The string in an OIDC token that says what the token was issued for. In GitHub Actions it holds the repository and a branch, an environment, or the pull request marker. |
| Lambda のバージョン | Lambda version | 20 | A numbered copy of a function's code and configuration that cannot change once published. The unpublished latest state is called $LATEST. |
| Lambda のエイリアス | Lambda alias | 20 | A named pointer to a version. Callers invoke the alias, and moving it switches versions. It can also split traffic between two versions by weight. |
| ロールバック | rollback | 20 | Returning a change to the state before it. CloudFormation puts back the configuration of the resources in the template, not the data written in the meantime. |
| 削除保護（termination protection） | termination protection | 20 | A setting that refuses to delete a stack: DeleteStack fails until it is turned off. It does not stop an update from removing resources. |
| プレビュー環境 | preview environment | 20 | A temporary environment created per pull request; in this book, one stack per pull request, made to be deleted when the pull request closes. |
| ネストしたスタック（nested stack） | nested stack | 20 | A stack created as a resource (AWS::CloudFormation::Stack) of another stack. Drift detection on the parent does not look inside it. |
| コンテナイメージ | container image | 12 | An application packed together with every file it needs to run. The same image starts a container with the same contents wherever it runs. |
| Docker のデーモン | Docker daemon | 12 | The long-running program (dockerd) that actually builds images and runs containers. The `docker` command is only a client that sends it requests. |
| イメージのタグ | image tag | 12 | A name given to an image inside a repository, such as `v1` or a commit hash. With immutable tags, a tag can never be moved to a different image. |
| ECR のリポジトリ | ECR repository | 12 | A place for images in Amazon ECR. ECS pulls images from it. |
| タスク定義 | task definition | 12 | The blueprint that says which image runs, with how much CPU and memory, and with which roles and environment variables. Every change makes a new revision; an existing revision is never edited. |
| タスク（ECS） | task | 12 | One running instance started from a task definition. On Fargate each task has its own network interface and private IP address. |
| サービス（ECS） | service (ECS) | 12 | The instruction to keep N tasks of a task definition running, and the machinery that keeps it true: it replaces tasks that die and swaps them when the task definition changes. |
| Fargate | Fargate | 12 | A way to run containers without owning the servers under them, billed by the CPU and memory size of each task and the time it runs. |
| Application Load Balancer（ALB） | Application Load Balancer (ALB) | 12 | The entry point that receives HTTP requests and spreads them over the tasks behind it. It is billed for every hour it exists. |
| ターゲットグループ | target group | 12 | The list of destinations an ALB routes to. Task IP addresses are registered in it, and it holds the health check settings. |
| ヘルスチェック | health check | 12 | The request an ALB sends to each target at intervals. A target that keeps failing it stops receiving requests. |
| deregistration delay | deregistration delay | 12 | How long an ALB waits for in-flight requests to finish on a target that is being removed from the target group. 300 seconds by default. |
| ローリングアップデート | rolling update | 12 | Replacing tasks by starting new ones and stopping old ones once the new ones are healthy. Old and new versions run side by side while it lasts. |
| deployment circuit breaker | deployment circuit breaker | 12 | The mechanism that declares a deployment failed when new tasks keep failing to start or to pass health checks. Optionally it rolls back to the last deployment that completed. |
| タスクロール | task role | 12 | The IAM role that application code inside the container uses when it calls AWS. The counterpart of a Lambda function's execution role. |
| タスク実行ロール | task execution role | 12 | The IAM role the ECS agent uses, before the application starts, to pull the image and ship logs. Application code cannot use it. |
| グレースフルシャットダウン | graceful shutdown | 12 | A process that has been told to stop refuses new work, finishes the work in progress, and only then exits. |
| SIGTERM | SIGTERM | 12 | The signal that asks a process to terminate. The process may clean up first. If it does not finish in time, SIGKILL follows, which cannot be handled. |
| target tracking | target tracking | 12 | An auto scaling policy where you name a metric and a target value, such as 60 percent average CPU, and leave the number of tasks to the service. |
| キュー | queue | 08 | A place that holds messages describing work to be done until something takes them out. The sender and the worker no longer have to be running at the same moment. |
| at-least-once 配送 | at-least-once delivery | 08 | A guarantee that a message arrives at least one time. It may arrive more than once. It is not "exactly once". |
| 可視性タイムアウト | visibility timeout | 08 | In SQS, how long a received message is hidden from other receivers. If it is not deleted within that time, it can be received again. |
| デッドレターキュー（DLQ） | dead-letter queue (DLQ) | 08 | A second queue where messages are set aside after being received a set number of times without being finished. A place for a person to look. |
| redrive | redrive | 08 | Moving messages from a dead-letter queue back to the queue they came from, to be handled again. |
| イベントソースマッピング | event source mapping | 08 | The Lambda setting under which Lambda itself reads a queue or stream and hands batches to a function. Batch size and the concurrency limit are set here. |
| partial batch response | partial batch response | 08 | A function's reply that names only the messages of a batch that failed, so that the ones that succeeded are not retried. |
| 冪等性の鍵 | idempotency key | 08 | The value that tells whether two requests are the same piece of work. It comes from the work itself, not from a value that changes with each delivery, such as a message ID. |
| sequencer | sequencer | 08 | A hexadecimal string S3 puts on create and delete events. Between two events for the same key, the greater one happened later. |
| backpressure | backpressure | 08 | Slowing the flow when the worker cannot keep up, by letting the delay be felt upstream. A queue takes it on in the form of a growing backlog. |
| 突き合わせ | reconciliation | 08 | Comparing what two stores hold right now and fixing the differences, without waiting for an event. It works even when an event is late or lost. |
| インスタンス（EC2） | instance (EC2) | 23 | One virtual machine rented from EC2. Everything from the operating system up is yours to look after. Billed while running; its volumes are billed even when it is stopped. |
| AMI | AMI | 23 | Amazon Machine Image: the template for an instance's first disk. It decides the operating system and what is installed from the start. |
| インスタンスプロファイル | instance profile | 23 | The container that hands an IAM role to an EC2 instance. One profile holds one role. |
| IMDS | IMDS | 23 | Instance Metadata Service: an address reachable only from inside the instance (169.254.169.254) that returns facts about the instance and temporary credentials for its role. IMDSv2 requires fetching a token first. |
| ユーザーデータ | user data | 23 | Data handed to an instance at launch. A shell script given this way runs once, as root, on the first boot. |
| EBS ボリューム | EBS volume | 23 | A network-attached disk for an instance. It belongs to one Availability Zone and attaches only to instances in that zone. It can outlive the instance. |
| スナップショット（EBS） | snapshot (EBS) | 23 | A point-in-time copy of a volume. Stored incrementally, and restorable as a volume in any zone of the Region. |
| Session Manager | Session Manager | 23 | A Systems Manager feature that opens a shell over a connection the SSM Agent on the instance made outward. No inbound port and no SSH key. |
| Run Command | Run Command | 23 | A Systems Manager feature that sends commands to an instance, runs them, and returns the result. Not interactive. |
| ユニット（systemd） | unit (systemd) | 23 | A file that tells systemd what to run, as whom, how to start it, and what to do when it dies. Those that define a service end in `.service`. |
| ステータスチェック | status check | 23 | A check EC2 runs on an instance every minute. System status checks look at the AWS infrastructure underneath; instance status checks look at the instance itself. |
| 単一障害点 | single point of failure | 23 | A part whose failure stops the whole. One instance, and its one volume, are exactly that. |
| CPU クレジット | CPU credit | 23 | What T-family instances earn and spend to use CPU above their baseline. In standard mode an empty balance means throttling to the baseline; in unlimited mode the excess is billed. |
| ワークフロー | workflow | 16 | Work made of several steps run in a defined order under defined conditions, where something outside the steps remembers how far it has got. |
| ステートマシン | state machine | 16 | A workflow definition in Step Functions: states such as Task and Choice, and how they connect, written as JSON. |
| Amazon States Language | Amazon States Language | 16 | The JSON language that Step Functions state machines are written in. ASL for short. |
| 状態遷移 | state transition | 16 | One move of an execution from a state to the next. It is the billing unit of Standard workflows, and a retry counts as one. |
| チェックポイント | checkpoint | 16 | Saving "done up to here" partway through long work, or the record itself. A rerun continues from the last checkpoint. |
| durable function | durable function | 16 | A Lambda function whose step results Lambda stores; after an interruption it runs again from the top and skips the finished steps. One invocation is limited to 15 minutes, the whole execution to one year. |
| リプレイ | replay | 16 | Running the code again from the beginning while using the stored results of finished steps. It works only if the code calls the same steps in the same order for the same input. |
| 補償処理 | compensation | 16 | Undoing work that got partway by running other steps that cancel the effects of the finished ones. Unlike a database rollback, you write it yourself, and it can fail too. |
| マニフェスト | manifest | 16 | A small file listing the files that make up an output. Written last, it is the sign that everything is there. |
| 条件付き書き込み | conditional write | 16 | A write with a condition such as "only if absent" or "only if still this version", where the store checks the condition and writes as a single step. |
| Standard ワークフロー | Standard workflow | 16 | One of the two Step Functions workflow types: up to a year, state persisted between states, billed per state transition. The other is Express, up to five minutes. |
| AWS Batch | AWS Batch | 16 | A service that queues container jobs and provisions the compute (Fargate or EC2) to run them. |
| 最小権限 | least privilege | 21 | Allowing only the actions a job needs, on only the resources it needs. Permissions that might be useful later are left out. |
| シークレット | secret | 21 | A value that must not leak, such as a signing key, an API key, or a password. In Secrets Manager, one resource holding the encrypted value, its versions, and who may read it. |
| ステージングラベル | staging label | 21 | A name tag Secrets Manager puts on a version of a secret. It manages three: AWSCURRENT (the value now), AWSPREVIOUS (the one before), and AWSPENDING (mid-rotation). |
| ローテーション | rotation | 21 | Replacing a secret's value with a new one. Not everyone holds the new value the moment it changes, so the old one stays accepted for a while. |
| KMS の鍵 | KMS key | 21 | An encryption key held by AWS KMS. The key cannot be taken out; you call an API to encrypt or decrypt. A customer managed key you create has a monthly fee; an AWS managed key a service creates does not. |
| web ACL | web ACL | 21 | The unit of AWS WAF configuration: an ordered list of rules. Associated with CloudFront, an ALB, and so on, it inspects requests before they arrive. It carries a monthly fee just for existing. |
| マネージドルールグループ | managed rule group | 21 | A set of WAF rules maintained by AWS or a third party, who also updates them. Inside a web ACL it counts as one rule. |
| 管理イベント | management event | 21 | The record of an API call that creates, changes, deletes, or reads the configuration of a resource. CloudTrail keeps 90 days of them by default. Data events, such as reading an S3 object, are not included. |
| SCP（service control policy） | SCP (service control policy) | 21 | In AWS Organizations, a policy that sets the upper bound on what IAM users and roles in member accounts can be allowed. It grants nothing, and does not apply to the management account. |
| 管理アカウント | management account | 21 | The account that created the organization. It pays the consolidated bill and attaches SCPs. SCPs do not restrict it, so it is not used for everyday work. |
| PITR（point-in-time recovery） | PITR (point-in-time recovery) | 22 | Restoring to the state at some past moment. In DynamoDB, a new table holding the contents as of a chosen second is built from continuous backups; the source table is not rewritten. |
| RPO（recovery point objective） | RPO (recovery point objective) | 22 | The target for how far back you may lose data in an incident, expressed as time. What was actually lost is the gap between the restore point and the incident. |
| RTO（recovery time objective） | RTO (recovery time objective) | 22 | The target for how long it may take from an incident until the service is usable again. Measured to the moment users read correct data, not to the moment a restore API returns. |
| 削除マーカー | delete marker | 22 | The marker S3 places when an object in a versioning-enabled bucket is deleted without naming a version. The bytes stay, and the marker becomes the newest version. Deleting the marker brings the object back. |
| cell（celld） | cell (celld) | 24 | A Durable Object in celld: a small server with a name and a private SQLite database. |
| ノード（celld） | node (celld) | 24 | One celld process on one machine. Any node can serve any cell. |
| fleet | fleet | 24 | The celld nodes that share one bucket. There is no join step; they find each other through leases in the bucket. |
| 持ち主の記録（ownership record） | ownership record | 24 | One small object per cell in the bucket, naming the current owner (a node session) and a fencing epoch. It changes only through conditional writes. |
| fencing epoch | fencing epoch | 24 | A number that grows every time ownership changes, used to keep a former owner's writes away from the current owner's state. |
| リース（ノード） | lease (node) | 24 | A record with an expiry that says a node is alive. A node that cannot renew it in time stops itself. |
| フォロワー | follower | 24 | Another node that receives each write from the owner and stores it on its own disk. One or two of them in celld. |
| drain | drain | 24 | Handing a node's work to others before it stops. In celld, SIGTERM is the signal for it. |
| スーパーバイザー | supervisor | 24 | Whatever starts a process and starts it again when it exits. In this chapter, systemd. |
| セルフホスト | self-hosting | 24 | Running software on your own machines instead of using a managed service, and taking on its upgrades and failures yourself. |
| operational readiness review（ORR） | operational readiness review (ORR) | 33 | A review, against a fixed list of questions, of whether a service can be operated before it is opened to users. AWS built it from the lessons of its own incidents, and the Well-Architected Framework recommends it. |
| 対応手順（runbook） | runbook | 33 | A written procedure for reaching a specific outcome. For an alarm, it says what to open first and what to try. |
| game day | game day | 33 | A rehearsal in which a failure is caused on purpose, so that the people who would handle the real one find out whether the procedures, the access and the alarms work. |
| Aspect（CDK） | aspect (CDK) | 33 | A CDK mechanism that visits every construct in a stack, one at a time, to inspect or change its settings. A resource added later is visited too. |
| パーティション（Athena） | partition (Athena) | 26 | A table's data split into one folder per value of a key. A query that filters on the key reads only the matching folders. |
| partition projection | partition projection | 26 | An Athena feature that computes a table's partitions from rules in its properties instead of looking them up in the catalog. |
| 列指向フォーマット | columnar format | 26 | A file format such as Parquet or ORC that stores data column by column instead of row by row, so a query can read only the columns it needs. |
| SerDe | SerDe | 26 | Short for serializer/deserializer: the component, named in a table's definition, that decides how a file's bytes are read as rows. |
| ワークグループ（Athena） | workgroup (Athena) | 26 | A unit that groups Athena queries. It can hold the result location and a cap on the bytes one query may scan. |
| Firehose ストリーム | Firehose stream | 26 | The entry point of Amazon Data Firehose: it buffers the records it receives and writes them to a destination (S3 in this chapter) in batches. |
| クォータ | service quota | 32 | The most of a resource or an operation a service allows per account or Region. Some can be raised on request; others are fixed. |
| スロットリング | throttling | 32 | Refusing requests beyond what a service accepts, without doing the work. Over HTTP it usually arrives as a 429. |
| トークンバケット | token bucket | 32 | A way of counting in which tokens build up at a fixed rate and each request spends one. The most the bucket holds is the burst. |
| 指数バックオフ | exponential backoff | 32 | Waiting before each retry, with the ceiling of the wait doubling every time. |
| ジッター | jitter | 32 | Randomness added to a wait, so that clients that failed together do not come back together. |
| 再試行の予算 | retry budget | 32 | How many retries one client may send in all. Successes refill it a little; sustained failure empties it, and retries stop. |
| リトライストーム | retry storm | 32 | Retries of failed calls add load, and the added load causes more failures. |
| 予約済み同時実行数 | reserved concurrency | 32 | Concurrency set aside for one function. It is that function's ceiling, and a share no other function can use. |
| コスト配分タグ | cost allocation tag | 32 | A tag key that has been activated for billing. Until it is, the tag does not appear in cost data. |
| 負荷試験 | load test | 32 | Sending a planned amount of traffic to learn which limit is reached first and how the system answers then. |
| 埋め込み（embedding） | embedding | 27 | A text turned into a list of numbers of a fixed length (a vector). A model produces it so that texts with similar meaning get vectors that point in similar directions. |
| ベクトルインデックス | vector index | 27 | A store that keeps vectors and returns the ones nearest to a vector you give it. In S3 Vectors it lives inside a vector bucket. |
| RAG（retrieval-augmented generation） | RAG (retrieval-augmented generation) | 27 | Searching for text related to a question first, then handing that text to a model to write the answer from. |
| パッセージ | passage | 27 | A piece of a note cut out as the unit of search and citation. This book cuts every 800 characters with 100 characters of overlap. |
| グローバルテーブル（global table） | Global table | 28 | A DynamoDB table kept in several Regions, where a write to any replica is delivered to the others. Every replica accepts reads and writes. |
| MREC（multi-Region eventual consistency） | MREC (multi-Region eventual consistency) | 28 | The default consistency mode of a global table: a write is final in the Region that took it and reaches the other Regions afterwards. |
| MRSC（multi-Region strong consistency） | MRSC (multi-Region strong consistency) | 28 | A consistency mode of a global table in which a write returns only after at least one other Region has it. It needs three Regions. |
| last writer wins | Last writer wins | 28 | Resolving two conflicting writes to one item by keeping the one with the later timestamp and discarding the other. The discarded write is recorded nowhere. |
| ウィットネス（witness） | Witness | 28 | The third Region of an MRSC global table, used so that two replicas can agree. It cannot be read or written. |
| クロスリージョンレプリケーション（CRR） | Cross-Region Replication (CRR) | 28 | An S3 configuration that asynchronously copies new objects written to a bucket into a bucket in another Region. |
| フェイルオーバールーティング | Failover routing | 28 | A Route 53 routing policy that answers with the primary record while it is healthy and with the secondary when it is not. |
| レイテンシールーティング | Latency routing | 28 | A Route 53 routing policy that answers with the record of the Region that has the lowest latency for the user who asked. |
| active-passive | Active-passive | 28 | A setup in which one Region answers requests and another waits to take over. When both always answer, it is active-active. |
| 重み付きエイリアス（weighted alias） | weighted alias | 31 | A Lambda alias that points at two versions and splits requests between them by percentage. The split is a per-request probability. |
| canary デプロイ | canary deployment | 31 | Sending a small share of requests to the new version first and the rest only if nothing goes wrong. Unrelated to the Synthetics canary of chapter 19. |
| blue/green デプロイ | blue/green deployment | 31 | Standing up the new environment (green) beside the old one (blue), which keeps running, and switching traffic over. Going back is switching to blue again. |
| bake time | bake time | 31 | The time after a shift has finished during which the alarms are still watched and the old version can still be brought back at once. |
| フィーチャーフラグ | feature flag | 31 | A configuration value that switches the behaviour of code that is already deployed, without deploying. |
| version skew | version skew | 31 | A mismatch in the formats or behaviour assumed by client and server, or by two versions running at the same time. |
| Lambda Managed Instances | Lambda Managed Instances | 35 | The Lambda feature that runs functions on EC2 instances in a VPC of your own account. Lambda launches, patches, routes to, and scales the instances, and you pay for instance-hours. |
| キャパシティプロバイダー（Lambda） | capacity provider (Lambda) | 35 | In Lambda Managed Instances, the resource that says where and on what the functions run: subnets, security groups, an operator role, instance types, and a vCPU ceiling. Functions on the same capacity provider are treated as trusting one another. |
| オペレーターロール | operator role | 35 | The IAM role Lambda assumes to launch and manage the instances of a capacity provider. It is not the execution role a function runs as. |
| マルチコンカレンシー | multi-concurrency | 35 | One execution environment handling several requests at the same time. Standard Lambda handles one at a time per execution environment. |
| Init フェーズ | Init phase | 29 | The phase that runs once, right after an execution environment is created: extensions start, the runtime starts, and the code outside the handler runs. |
| Invoke フェーズ | Invoke phase | 29 | The phase in which the handler processes one request. The function timeout applies to all of it. |
| REPORT 行 | REPORT line | 29 | The record Lambda writes once per invocation: duration, billed duration, the memory setting and the most memory used, and the initialization time on a cold start. |
| GB 秒 | GB-second | 29 | The unit Lambda charges duration in: the memory setting in GB multiplied by the billed time in seconds. |
| provisioned concurrency | provisioned concurrency | 29 | A number of execution environments kept initialized in advance. Set on a version or an alias, and billed by time whether used or not. |
| tree shaking | tree shaking | 29 | Dropping code nothing uses while bundling. It works only on code written as ES modules. |
| レイヤー | layer | 29 | An extra .zip attached to a function. Its contents are extracted into /opt in the execution environment. |
| extension | extension | 29 | A separate program that runs in the function's execution environment, used by monitoring tools among others. It shares CPU and memory with the function. |
| isolate | isolate | 29 | A unit of execution V8 creates inside one process, sharing no memory with the others. Cloudflare Workers runs code in such units. |
| イベントバス | event bus | 25 | A relay that takes in statements of what happened and hands each to whoever asked to hear of it. The sender does not know who receives. |
| イベントパターン | event pattern | 25 | The JSON in which an EventBridge rule says which events it takes. It has the shape of the event, and lists the accepted values field by field. |
| ファンアウト | fan-out | 25 | Delivering one message to each of several receivers. |
| リプレイ（イベントの） | replay (of events) | 25 | Delivering stored past events to consumers again. From the receiving side, the same event arrives once more. |
| コントロールプレーン | control plane | 34 | The managing side of a Kubernetes cluster: the API server, etcd with the cluster's state, and the controllers. On EKS, AWS runs it and bills it by the hour, per cluster. |
| Pod | pod | 34 | The smallest thing Kubernetes runs: one or more containers and the network they share. What a task is on ECS. |
| ノード | node | 34 | A machine that pods run on. On EKS it is an EC2 instance, and the pods on it share its CPU and memory. |
| EKS Auto Mode | EKS Auto Mode | 34 | A way to run EKS in which EKS itself starts and replaces nodes and runs load balancing, pod networking, and block storage. The nodes are EC2 instances in your account, but you cannot log in to them or choose their AMI. |
| ノードプール | node pool | 34 | A Kubernetes object that says which nodes Auto Mode (Karpenter) may start and how many: architecture, instance types, total vCPUs. |
| EKS Pod Identity | EKS Pod Identity | 34 | A way to tie an IAM role to a service account in a namespace of a cluster. The association lives in the EKS API, and the role's trust policy only has to name pods.eks.amazonaws.com. |
| アクセスエントリー | access entry | 34 | An EKS setting that ties an IAM role or user to what it may do through the Kubernetes API. It is managed through the EKS API, not in a ConfigMap inside the cluster. |
| PodDisruptionBudget | PodDisruptionBudget | 34 | A Kubernetes object that limits how many pods a voluntary disruption, such as draining a node, may take away at once. It cannot stop a node from failing. |
| Ingress | Ingress | 34 | A Kubernetes object that says which Service HTTP from outside the cluster goes to. On EKS a controller reads it and creates an Application Load Balancer. |
| 延長サポート | extended support | 34 | The 12 months after a Kubernetes minor version leaves EKS standard support (14 months from release). The cluster's hourly price rises for that time. |
| アクセスパターン | access pattern | 30 | One way the application reads or writes its data, stated with its condition and its order: "an owner's 20 most recently updated notes". In DynamoDB the keys are chosen to fit these. |
| single-table design | single-table design | 30 | Keeping several kinds of data in one DynamoDB table and telling them apart by the shape of their keys, so that things read together sit under one partition key and one Query returns them. |
| アイテムコレクション | item collection | 30 | The items that share a partition key. They are ordered by sort key, and a Query reads a range of them. |
| global secondary index（GSI） | global secondary index (GSI) | 30 | A copy of a table's items organized by another key. DynamoDB updates it asynchronously after each write to the table, so it can only be read with eventual consistency, and each of those index writes is billed. |
| sparse index | sparse index | 30 | An index that holds only some of the table's items: an item without the attributes the index is keyed on is not in it. |
| プロジェクション | projection | 30 | Which attributes of an item are copied into an index: the keys only, a chosen list, or all. An attribute that is not projected cannot be read from the index. |
| 非正規化 | denormalization | 30 | Keeping the same value in more than one item. Reads need no join, and in exchange the application must rewrite every copy when the value changes. |
| トランザクション（DynamoDB） | transaction (DynamoDB) | 30 | With TransactWriteItems, up to 100 item writes and conditions that all succeed or all fail. It is a single request: there is no reading in the middle and deciding what to do next. It costs twice an ordinary write. |
| ストリーム（DynamoDB Streams） | stream (DynamoDB Streams) | 30 | A log of a table's item changes, kept for 24 hours, one record per change. When Lambda reads it and invokes a function, the same record can arrive more than once. |
| ホットパーティション | hot partition | 30 | A partition that takes so much of the traffic that it reaches the limit of a single partition. Requests to it are throttled even while the table as a whole has capacity to spare. |
| バックフィル | backfill | 30 | Writing a shape decided later (a new attribute, a new key) onto data that is already stored. It runs beside the live application's writes, so it is built to give the same result however often it runs and to resume where it stopped. |
| ページトークン | page token | 30 | The value an API gives a client for reading the next page of a list. When it comes back it is untrusted input: its shape is checked, and whose data is read comes from the authenticated caller, never from the token. |
| ロケーション（DataSync） | location (DataSync) | 38 | A storage place registered with DataSync as somewhere to copy from or to. For S3 it is a bucket together with the role DataSync uses to reach it. Creating one runs nothing. |
| タスク（DataSync） | task (DataSync) | 38 | A source location, a destination location, the options for how to copy, and a schedule, as one resource. Not related to an ECS task. |
| タスク実行（task execution） | task execution | 38 | One run of a DataSync task. It goes through preparing, transferring, and verifying, and ends in SUCCESS or ERROR. |
| エージェント（DataSync） | agent (DataSync) | 38 | A virtual machine placed in your own network that reads and writes NFS or SMB storage on DataSync's behalf. A copy between two S3 buckets needs none. |
| 混乱した代理（confused deputy） | confused deputy | 38 | A service with permissions being talked into acting on a resource its caller could not touch. Prevented with `aws:SourceAccount` and `aws:SourceArn` conditions in the trust policy. |
| CloudShell | CloudShell | 37 | A shell opened inside the console. It starts out holding the credentials of the signed-in identity and runs in an environment on the AWS side (1 vCPU, 2 GiB, a 1 GB home directory). It has no additional charge. |
| VPC 環境（CloudShell） | VPC environment (CloudShell) | 37 | A CloudShell environment created with a VPC, a subnet and security groups. It communicates from inside the chosen subnet. Its home directory does not persist, and upload and download from the page are unavailable. |
| Cloud9 | Cloud9 | 37 | An integrated development environment in the browser, running on an EC2 instance or your own server. Closed to new customers since July 25, 2024. |
| Health イベント | Health event | 44 | A notification that AWS Health sends on behalf of other AWS services: a service issue, a scheduled change, or a notice to the account. |
| public イベント | public event | 44 | A Health event that is not specific to an account. It is reported whether or not the account uses that service or Region. |
| アカウント固有のイベント | account-specific event | 44 | A Health event about resources in your own account. It names the affected resources. |
| planned lifecycle event | planned lifecycle event | 44 | A Health event that announces, ahead of time, a change that needs the customer to act, such as the end of support of a runtime or version. Its start time is the date of the change. |
| organizational view | organizational view | 44 | A feature that gathers the Health events of every account in an AWS Organizations organization into the management account or a delegated administrator account. |
| CDC（change data capture） | CDC (change data capture) | 39 | Reading the changes made to a database, in order, from its own record of them (the WAL in PostgreSQL). AWS DMS applies what it reads to the target in the same order. |
| full load | full load | 39 | The phase in which AWS DMS copies every row a source table holds to the target. It goes table by table, in no guaranteed order. |
| レプリケーションスロット | replication slot | 39 | PostgreSQL's record of how far one reader has read the WAL. The server keeps WAL until that reader has consumed it, so a slot whose reader is gone fills the disk. |
| 切り替え（cutover） | cutover | 39 | Moving an application's connection from the old database to the new one: stop writes, wait for the remaining changes to arrive, verify, then switch. |
| DCU（DMS capacity unit） | DCU (DMS capacity unit) | 39 | The capacity unit of AWS DMS Serverless. One DCU is 2 GB of memory, and a running replication is billed by the hour for the DCUs it uses. |
| source server | source server | 40 | One server protected by Elastic Disaster Recovery. It is registered when the agent is installed and billed by the hour until it is disconnected. |
| AWS Replication Agent | AWS Replication Agent | 40 | The program on a source server that keeps sending disk writes, block by block, to a replication server. |
| staging area | staging area | 40 | The subnet in the recovery Region that holds the replication servers and the replicated disks. Until a recovery, no launched copy of the server exists there. |
| replication server | replication server | 40 | The EC2 instance in the staging area that receives data from agents and writes it to staging volumes. The service launches and replaces it. |
| recovery instance | recovery instance | 40 | An EC2 instance launched from the snapshot of a chosen point in time. One launched for a test is a drill instance. |
| 復旧訓練（recovery drill） | recovery drill | 40 | Launching instances by the same steps as a recovery, without touching production, to check that it works. They are terminated afterwards. |
| failover | failover | 40 | Redirecting clients from the primary system to the recovered one. It happens outside Elastic Disaster Recovery, and you do it. |
| failback | failback | 40 | Replicating what changed on the recovery side back to the original site, and redirecting clients there again. |
| split brain | split brain | 40 | Two sites each believing they are production and accepting writes. One side's writes will have to be thrown away. |
| crash consistent | crash consistent | 40 | The state a disk would be in had the power been cut at that instant. Data that was in memory and not yet written is not in it. |
| Firewall Manager のポリシー | Firewall Manager policy | 42 | A setting created once in the Firewall Manager administrator account: the protection (WAF rule groups, an audit security group, and so on) and the scope it applies to (accounts, OUs, resource types, tags). It applies to resources in scope, including ones created later. Not an IAM policy. |
| OU（organizational unit） | OU (organizational unit) | 42 | A container for accounts in AWS Organizations, which can be nested. Naming an OU in a Firewall Manager policy or an SCP names every account in it and in its child OUs. |
| 委任された管理者（delegated administrator） | delegated administrator | 42 | A member account that the organization's management account has entrusted with administering one service. A Firewall Manager administrator account is registered as an Organizations delegated administrator. |
| 自動修復（automatic remediation） | automatic remediation | 42 | A setting of a Firewall Manager policy. Disabled, the policy only reports resources that do not comply. Enabled, Firewall Manager makes the change in the member account: associating a web ACL, removing a rule. |
| Fargate Spot | Fargate Spot | 41 | Fargate at a discount, on capacity AWS has to spare. When AWS takes the capacity back, the task gets SIGTERM two minutes before it is stopped. |
| capacity provider strategy | capacity provider strategy | 41 | Which capacity providers tasks go to and in what proportion. `base` is the number placed there first; `weight` is the ratio for the rest. |
| プラットフォームバージョン | platform version | 41 | The version of the runtime environment (kernel and container runtime) Fargate runs a task on. For Linux the one available is 1.4.0, which is also what `LATEST` means. |
| タスクのリタイア（task retirement） | task retirement | 41 | Fargate stopping, after a notice, the tasks that run on an outdated platform version revision. A service's tasks are replaced; a standalone task is only stopped. |
| スケールイン | scale-in | 41 | Reducing the number of tasks; adding them is scale-out. The question is what happens to the requests a removed task is holding. |
| ECS Exec | ECS Exec | 41 | Running a command inside a running container. It goes through Systems Manager Session Manager, runs as root, and can only be turned on for newly started tasks. |
| エフェメラルストレージ | ephemeral storage | 41 | Disk that exists only while the task runs. Fargate gives 20 GiB and allows up to 200 GiB. The image is unpacked onto it too. |
| Infrastructure Composer | Infrastructure Composer | 45 | An AWS tool that shows a CloudFormation or SAM template as a diagram of cards and lines and lets you edit it from the diagram. Formerly Application Composer. Its standalone console ends on December 7, 2026; the one inside the AWS Toolkit for Visual Studio Code remains. |
| template studio | template studio | 45 | The template editor in the CloudFormation console. It shows a diagram of resources and references beside the template text. The text is authoritative; the diagram cannot be edited. |
| tool use | tool use | 36 | A model asking for one of the application's functions by name and input. The application runs it, not the model. |
| tool result | tool result | 36 | What the application returns for a tool use, sent to the model in the next request's user message. |
| 構造化出力 | structured output | 36 | Constraining a model's output to JSON that fits a given JSON Schema. The application still validates what the schema cannot say. |
| ガードレール | guardrail | 36 | A unit of configuration in Bedrock Guardrails. It checks input and output text with the filters you chose and replaces it with a set message on a match. |
| text unit | text unit | 36 | The billing unit of Guardrails: up to 1,000 characters is one unit. |
| prompt caching | prompt caching | 36 | Reusing, on the model's side, the part of a prompt that starts the same way every time. Tokens read from the cache are billed below the input rate. |
| cache checkpoint | cache checkpoint | 36 | A mark in a prompt that says everything up to here may be cached. In the Converse API it is a cachePoint block. |
| batch inference | batch inference | 36 | Inference where many requests are handed over as a file in S3 and the results arrive in S3 later, cheaper because it is not immediate. |
| burndown rate | burndown rate | 36 | How many tokens of the tokens-per-minute quota one output token uses up. It differs by model. |
| Provisioned Throughput | Provisioned Throughput | 36 | Buying a model's capacity by the hour. It is billed until you delete it. |
| プロンプトインジェクション | prompt injection | 36 | An attack that writes instructions into data a model reads, to have them followed in place of the developer's. |
| モデルのライフサイクル | model lifecycle | 36 | The state of a model on Bedrock: Active, then Legacy, then End-of-Life, after which calls to it fail. |
| DDoS | DDoS | 46 | Distributed denial of service: traffic from many sources meant to leave real users unable to use a service. Some attacks fill the network, some exhaust protocol state, and some send floods of well-formed requests. |
| denial of wallet | denial of wallet | 46 | An attack on pay-per-request services that inflates the bill instead of stopping the service. The service keeps working, so the bill is often the first sign. |
| Shield Advanced | Shield Advanced | 46 | The paid subscription of AWS Shield. For the resources you name it adds lower detection thresholds, access to a response team, and credits for part of an attack's cost. It has a monthly fee and a one-year commitment. The free part everyone has is Shield Standard. |
| マネージドプレフィックスリスト | managed prefix list | 46 | A list of IP address ranges that AWS maintains. A security group rule can name it by ID in place of a CIDR. One of them holds the ranges of the servers CloudFront uses to reach origins. |
| saga | saga | 47 | A change that spans several services, made by committing one step at a time instead of in one transaction. When a later step fails, the steps already done are cancelled by compensations. The states in between are visible from outside. |
| タスクトークン（task token） | task token | 47 | A string Step Functions attaches to a task that waits for an answer from outside. Whoever answers calls SendTaskSuccess or SendTaskFailure with it. |
| JSONata | JSONata | 47 | An expression language for selecting and reshaping JSON. Inside a Step Functions state, a string wrapped in `{% %}` is evaluated as JSONata. |
| Express ワークフロー | Express workflow | 47 | One of the two kinds of Step Functions workflow: five minutes at most, no state persisted between steps, billed by executions, duration and memory, and an execution may run twice. |
| ハートビート（heartbeat） | heartbeat | 47 | The signal by which a long task says it is still working. If none arrives within HeartbeatSeconds, Step Functions fails the task. |
| 実行パラメーター（Athena） | execution parameter (Athena) | 49 | A value that takes the place of a `?` in a statement when it runs, in order. It is handed to Athena beside the statement, not inside it. |
| CTAS | CTAS | 49 | Short for CREATE TABLE AS SELECT: a statement that writes a query's result to S3 as files and creates the table that points at them. |
| Iceberg テーブル | Iceberg table | 49 | A table kept in the Apache Iceberg format. Its metadata records which files belong to the table, which makes row-level changes and reads of a past state possible. |
| クエリ結果の再利用 | query result reuse | 49 | An Athena feature that returns the stored result of the same query run recently in the same workgroup instead of running it again. It is turned on per query, with the age you accept. |
| コマンド | command | 48 | In the AWS SDK for JavaScript v3, the object that stands for one API operation and its input. It runs when passed to a client's send. |
| ミドルウェアスタック | middleware stack | 48 | The ordered functions an SDK client runs for one call, in five steps: initialize, serialize, build, finalizeRequest, deserialize. Retries and signing live in finalizeRequest. |
| 認証情報プロバイダーチェーン | credential provider chain | 48 | The sources an SDK tries in a fixed order when no credentials are given in code. It stops at the first one that returns credentials. |
| ページネーター | paginator | 48 | An SDK function that wraps passing the continuation token or key to the next request as an async iterator. |
| ウェイター | waiter | 48 | An SDK function that polls a resource's state at intervals until it reaches the wanted one. The caller sets how long it may wait. |
| マーシャリング | marshalling | 48 | Converting between JavaScript values and DynamoDB's typed attribute values (S, N, M and so on). The document client in lib-dynamodb does it on every send and receive. |
| サービス例外 | service exception | 48 | The SDK class for an error an AWS service returned. It extends the service's base class and carries $fault, $metadata and name. |
| リクエストハンドラー | request handler | 48 | The part of an SDK client that actually sends the HTTP request. In Node.js it uses node:http and node:https; connection reuse and timeouts are set here. |
| ファイルシステム（EFS） | file system (EFS) | 53 | A shared disk created in EFS and mounted over NFS. It has no fixed size; you pay for what is stored and for what is read and written. Several things in the same Region can mount it at once. |
| NFS | NFS | 53 | Network File System: a protocol for mounting a file system on another machine as a local directory. EFS speaks versions 4.0 and 4.1. |
| マウントターゲット | mount target | 53 | The NFS endpoint an EFS file system exposes in a subnet of the VPC. One per Availability Zone; security groups attach here. |
| アクセスポイント（EFS） | access point (EFS) | 53 | A per-application entry into a file system. Clients that come in through it see one directory as the root and act as one fixed POSIX user. |
| close-to-open の整合性 | close-to-open consistency | 53 | The consistency NFS promises: once one client closes a file, another client that opens it sees what was written. It promises nothing about files that are still open. |
| アドバイザリロック | advisory lock | 53 | A lock that binds only the programs that check for it. Reads and writes by a process that did not take it go through. Every lock on EFS is of this kind. |
| rename による置き換え | rename into place | 53 | Writing the new content to a file under another name, then renaming it over the real name. A reader sees the old content or the new, nothing in between. |
| Elastic スループット | Elastic throughput | 53 | One of EFS's throughput modes: nothing is provisioned, and you pay per byte read and written. |
| Data Catalog（Glue） | Data Catalog (Glue) | 43 | Where table definitions live: which S3 folder holds files of which columns in which format. It holds no data and checks none. |
| crawler | crawler | 43 | The AWS Glue feature that reads data in S3 or elsewhere, infers its format and columns, and writes tables and partitions to the Data Catalog. |
| job（Glue） | job (Glue) | 43 | A script AWS Glue runs. A Spark job runs on workers of at least 2 DPUs in total and is billed for the seconds it runs. |
| job bookmark | job bookmark | 43 | State AWS Glue keeps about which input a job has read, saved by job.commit(). It tracks sources only, never what was written. |
| DQDL | DQDL | 43 | Data Quality Definition Language: the language AWS Glue Data Quality rules are written in. |
| ETL | ETL | 43 | Extract, transform, load: reading data, reshaping it, and writing it somewhere else. |
| AgentCore Runtime | AgentCore Runtime | 50 | The part of Amazon Bedrock AgentCore that hosts an agent's code. It gives each session a microVM of its own and calls the code as an HTTP server with `/invocations` and `/ping`. |
| ランタイムセッション | runtime session | 50 | The unit AgentCore Runtime gives one microVM to, told apart by an ID of 33 characters or more that the caller chooses. AgentCore does not check whose ID it is. |
| AgentCore Memory | AgentCore Memory | 50 | The AgentCore service that keeps an agent's memory. Short-term memory is a list of events per actor and session; long-term memory is records extracted from them asynchronously. |
| ワークスペース（Grafana） | workspace (Grafana) | 55 | One logically isolated Grafana server provided by Amazon Managed Grafana. It holds dashboards, data sources and user assignments. |
| データソース（Grafana） | data source (Grafana) | 55 | The configuration of a place Grafana sends queries to. The CloudWatch data source calls the CloudWatch API with the permissions of the workspace role. |
| サービスアカウント（Grafana） | service account (Grafana) | 55 | A user for programs, not people, to call Grafana's HTTP API. It works through tokens that expire, and is billed as one user. |
| WebRTC | WebRTC | 51 | The standard way for browsers to exchange audio and video with each other or with a server at low latency. |
| ミーティング | meeting | 51 | In the Chime SDK, the ephemeral resource for one call. It is created through the API, and Chime ends it after five minutes with nobody connected or after 24 hours. |
| アテンディー | attendee | 51 | One participant's seat in a meeting. The server creates it through the API, and each one comes with a join token. |
| join token | join token | 51 | The secret string a client presents to the media service to connect as an attendee. Whoever holds it is that attendee. It stops working when the attendee is deleted or the meeting ends. |
| メディアリージョン | media Region | 51 | In a Chime SDK meeting, the Region that relays the audio and video. It is chosen separately from the control Region whose API is called. |
| データストリーム | data stream | 54 | A record of what arrived, in the order it arrived, kept for a set time. Reading removes nothing, and each reader keeps a position of its own. |
| shard | shard | 54 | One of the sequences a Kinesis stream is made of. Write and read limits, ordering, and the price are all per shard. |
| partition key（Kinesis） | partition key (Kinesis) | 54 | A string given with each record. Its MD5 hash picks the shard, so records with one partition key line up in one shard. Not DynamoDB's partition key. |
| sequence number | sequence number | 54 | The number Kinesis gives a record it has stored. It increases within a shard. A decimal string with more digits than a number holds, and not consecutive. |
| iterator age | iterator age | 54 | How long ago the last record a consumer was handed arrived in the stream: how far behind the consumer is. Past the retention period, records are gone unread. |
| poison record | poison record | 54 | A record that fails however often it is processed. In a consumer that reads in order, it holds back everything behind it. |
| enhanced fan-out | enhanced fan-out | 54 | Registering a consumer with a stream so that it gets read throughput of its own (2 MB/s) on every shard. Billed for the time registered and the data read. |
| resharding | resharding | 54 | Splitting a shard in two or merging two into one. The original shard is closed, and its records stay readable until retention runs out. |
| ダイジェスト | digest | 52 | The SHA-256 of an image's manifest. It follows from the content, so the same digest is the same image and can never come to mean another. |
| タグの immutability | tag immutability | 52 | A repository setting that refuses a push which would point an existing tag at another image. |
| ライフサイクルポリシー（ECR） | lifecycle policy (ECR) | 52 | A set of rules that delete a repository's images, chosen by tag, by count, or by days since they were pushed. |
| pull through cache | pull-through cache | 52 | Pulling an image of an outside registry through your own ECR registry, which keeps a copy. |
| enhanced scanning | enhanced scanning | 52 | Having Amazon Inspector scan ECR images: language packages as well as the operating system, and again whenever new vulnerabilities are published. |
| ハッシュチェーン | hash chain | 58 | A sequence of records in which each one carries a hash computed over its own content and the hash of the record before it. Changing one record makes every hash after it wrong. |
| ダイジェスト | digest | 58 | A note of a ledger's last sequence number and hash at one moment. In a hash chain the last hash stands for every record before it. It is kept apart from the ledger, somewhere it cannot be deleted. |
| Object Lock | Object Lock | 58 | An S3 feature that keeps an object version from being deleted or overwritten for a set period. Governance mode can be lifted with a special permission; compliance mode cannot be lifted even by the root user. |
| マルチモーダル | multimodal | 56 | Able to take other kinds of input, such as images, video or speech, in the same request as text. Which kinds differs by model. |
| モデルカード | model card | 56 | The page the Bedrock user guide has for each model: what it takes and returns, which APIs it speaks, its model ID and inference profile IDs, the Regions it can be called from, and its earliest end of life. |
| claim（処理の先取り） | claim | 56 | A record with an expiry that says 'I am doing this work now'. It is made with a conditional write, so only one of two simultaneous requests can make it. Once it has expired, another request may take it over. |
| 代替テキスト | alternative text | 56 | A description of an image in words, for a reader who cannot see it. In HTML it goes in the alt attribute of an img element. |
| speech-to-speech | speech-to-speech | 56 | A model that takes speech and answers in speech. One model transcribes, generates and speaks in turn, over a bidirectional stream. |
| クラスターボリューム | cluster volume | 60 | The single virtual volume that holds an Aurora cluster's data. It is replicated across three Availability Zones and exists independently of how many instances there are. |
| writer | writer | 60 | The one instance of an Aurora cluster that accepts writes. Also called the primary instance. |
| reader | reader | 60 | A read-only instance that reads the same cluster volume as the writer. Also called an Aurora Replica. It is also what a failover promotes to writer. |
| クラスターエンドポイント | cluster endpoint | 60 | The DNS name that points at the current writer. After a failover the same name points at the new one. |
| auto-pause | auto-pause | 60 | An Aurora Serverless v2 instance with a minimum of 0 ACUs stopping after a time with no connections and resuming on the next one. |
| Data API | Data API | 60 | An API that sends SQL to Aurora over HTTPS. It holds no connection, and authenticates with IAM and a secret in Secrets Manager. |
| クローン | clone | 60 | A new Aurora cluster that starts by sharing its source's data pages. A page is copied only when either side changes it. |
| I/O-Optimized | I/O-Optimized | 60 | One of Aurora's two storage price configurations. It does not charge for I/O requests, and charges more for capacity and storage. The other is Standard. |
| セルフホストランナー | self-hosted runner | 62 | The program that executes CI jobs, run on your own compute instead of the CI service's. It runs whatever a workflow says, with whatever the place it runs in can reach. |
| just-in-time runner | just-in-time runner | 62 | A runner whose registration is created first, through GitHub's API, and handed to it at startup. GitHub removes it after it has run at most one job. |
| runner manager | runner manager | 62 | GitLab Runner's long-running process. It asks GitLab for jobs and runs them through an executor. |
| SSML | SSML | 57 | Speech Synthesis Markup Language: an XML format that adds instructions such as pauses and pronunciations, as tags, to text that is to be spoken. |
| 課金対象の文字 | billed characters | 57 | The characters Polly charges for. SSML tags are not among them. |
| レキシコン | lexicon | 57 | A pronunciation dictionary: how particular words are to be read. Polly stores lexicons per Region and a synthesis request names the ones to apply. |
| Multi-AZ | Multi-AZ | 59 | A deployment in which RDS keeps a standby copy in another Availability Zone and switches to it on failure. |
| リードレプリカ | read replica | 59 | A read-only DB instance that receives the primary's changes asynchronously, and can therefore be behind it. |
| レプリカラグ | replica lag | 59 | The delay between a commit on the primary and its being applied on a read replica. |
| LSN | LSN (log sequence number) | 59 | A position in PostgreSQL's write-ahead log, used to compare how far the primary has written with how far a replica has replayed. |
| read-your-writes | read-your-writes | 59 | The guarantee that whoever wrote something sees that write in their own later reads. |
| RDS Proxy | RDS Proxy | 59 | A connection pool placed between applications and RDS that folds many client connections into few database connections. |
| パラメーターグループ | DB parameter group | 59 | A named set of database engine settings that is associated with DB instances. |
| IAM データベース認証 | IAM database authentication | 59 | Signing in to a database with a 15-minute token signed by IAM credentials, in place of a password. |
| RDS Extended Support | RDS Extended Support | 59 | A paid arrangement, charged per vCPU-hour, for staying on a major version after its standard support has ended. |
| コーディングエージェント | coding agent | 63 | A program in which a model runs commands of its own choosing and reads and writes files to make a requested change to a repository. Claude Code is one. |
| 出口の許可リスト | egress allowlist | 63 | A rule that limits outbound connections to the destinations it lists. Anything not listed is out of reach, whatever the reason. |
| installation access token | installation access token | 63 | The token a GitHub App issues to act on the repositories it is installed on. It expires an hour after it is made, and can be narrowed to repositories and permissions when it is issued. |
| 非対話モード（claude -p） | non-interactive mode (claude -p) | 63 | Running Claude Code once, without a terminal interface: it takes the prompt as an argument, writes the result to standard output, and returns an exit status. |
| FIFO キュー | FIFO queue | 61 | One of the two kinds of SQS queue. It hands over the messages of a message group in the order they were sent, and treats sends with the same deduplication ID as one message for five minutes. |
| メッセージグループ | message group | 61 | The unit within which a FIFO queue keeps order. Messages with the same message group ID are handed over one after another, and different groups proceed in parallel. |
| 重複排除 ID | deduplication ID | 61 | The name given to a message sent to a FIFO queue (MessageDeduplicationId). For five minutes after it is accepted, a send with the same name queues nothing. |
| ロングポーリング | long polling | 61 | A ReceiveMessage that waits up to 20 seconds for a message before it answers. Fewer empty answers, and so fewer billed requests. |
| workerd | workerd | 64 | Cloudflare's open-source JavaScript and Wasm runtime, based on the same code as Workers. One process creates isolates and runs the workers its configuration file defines. Its README states that it is not a hardened sandbox on its own. |
| compatibility date | compatibility date | 64 | In Workers and workerd, the setting that says up to which date a worker accepts changes to the runtime. A newer runtime does not change how a worker with an older date behaves. |
| binding | binding | 64 | In Workers and workerd, a worker's way to an outside resource or a setting. Only the bindings its configuration declares appear in the worker's `env`. |
| Firecracker | Firecracker | 67 | An open-source virtual machine monitor that runs microVMs on KVM. AWS built it for Lambda and Fargate and publishes it under Apache 2.0. One process is one microVM. |
| microVM | microVM | 67 | A small virtual machine with a minimal set of devices. It has its own kernel, so its isolation boundary is hardware virtualization. |
| 仮想マシンモニター（VMM） | virtual machine monitor (VMM) | 67 | The program that presents devices to a virtual machine and handles what the guest does when it leaves guest mode. Firecracker and QEMU are VMMs. |
| KVM | KVM | 67 | The virtualization feature of the Linux kernel. It uses the CPU's virtualization extensions and lets a VMM create virtual machines through /dev/kvm. |
| jailer | jailer | 67 | A program shipped with Firecracker. It sets up a chroot, cgroups and namespaces, drops privileges, and then execs Firecracker. |
| nested virtualization | nested virtualization | 67 | Running a virtual machine inside a virtual machine. On EC2 it is a CPU option of some Intel instance types. |
| Nitro System | Nitro System | 68 | What today's EC2 instances stand on: network and storage I/O moved to dedicated cards (Nitro Cards), and a hypervisor on the host CPU that only divides CPU and memory. Unrelated to the Nitro server engine of Nuxt. |
| Nitro Hypervisor | Nitro Hypervisor | 68 | The hypervisor of the Nitro System. AWS describes it as allocating CPU and memory and handing Nitro Card devices to instances, with no network stack and no shell. |
| Graviton | Graviton | 68 | The Arm (arm64) processors AWS designs. In an instance type name, the letter g. |
| エンクレーブ | enclave | 68 | An isolated virtual machine carved out of an instance's vCPUs and memory. It has no network, no persistent storage and no interactive access, and reaches its parent instance over vsock only. |
| 親インスタンス | parent instance | 68 | The EC2 instance that gives an enclave its vCPUs and memory, and starts and stops it. |
| エンクレーブイメージファイル | enclave image file | 68 | The one file (.eif) with the operating system and application an enclave boots. Built from a Docker image with nitro-cli build-enclave. |
| PCR | PCR | 68 | Platform configuration register: a SHA-384 hash computed from the enclave's image or from facts about its parent. PCR0 measures the whole image file. |
| アテステーションドキュメント | attestation document | 68 | A document signed by the Nitro Hypervisor, carrying an enclave's PCRs and a public key the enclave supplied. The enclave shows it to prove which image it was started from. |
| vsock | vsock | 68 | A socket between a virtual machine and its host, addressed by a CID and a port. The only path between an enclave and its parent instance. |
| Raft | Raft | 66 | A consensus protocol that makes several copies agree on one order of writes. One copy is the leader and takes the writes; a write counts only once a majority of the copies have recorded it. |
| 過半数（quorum） | Quorum (majority) | 66 | More than half of the copies: two of three. Only while a majority is alive can a leader be elected and a write be made final. |
| tablet | Tablet | 66 | One piece of a table in YugabyteDB. A row belongs to one tablet by its primary key, and each tablet has its own set of copies (a Raft group). |
| replication factor | Replication factor | 66 | The number of copies of each tablet. With three, a majority remains after one node is lost. |
| 時刻のずれ（clock skew） | Clock skew | 66 | The difference between the clocks of two nodes. YugabyteDB orders transactions with timestamps, so a node whose clock is off by more than the limit (500 ms by default) stops itself. |
