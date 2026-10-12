---
title: "28 Multi-Region: Global Tables, S3 Replication, and Route 53"
sourceRevision: 1
---

# 28 Multi-Region: Global Tables, S3 Replication, and Route 53

[Chapter 22](/en/chapters/22-recovery.md) brought back data that had been deleted. This chapter keeps the app answering when a Region stops responding.

Every chapter so far has put everything in the Tokyo Region (`ap-northeast-1`). DynamoDB is built to keep working when a whole Availability Zone stops. Even so, the setup so far has nothing for a failure that takes out the entire Region. In this chapter you put the same app in the Osaka Region (`ap-northeast-3`) as well, replicate the table and the images between the two Regions, and let Route 53 switch where requests go.

Adding a second Region is itself a few lines of configuration. The hard part is knowing which promises of the earlier chapters stop holding once it is there. [Chapter 05](/en/chapters/05-dynamodb.md) promised that when two people edit the same note at once, one of them gets a `409`. With the default settings of a global table, that promise is broken when the two write to different Regions. The centre of this chapter is reproducing that breakage in tests and deciding how much of it to accept.

The author has not deployed this chapter's stacks to AWS, and has never caused a Region failure or a failover. What was checked locally is a model that keeps two Regions in memory, and the stacks' templates. The model copies the rules written in the DynamoDB, S3, and Route 53 documentation. It does not stand in for the real services.

You need chapters 05, [07](/en/chapters/07-uploads.md), and 22. The code is in `examples/28-multi-region/`.

## The big picture

<!-- section: 28.overview -->

```figure
caption: The same API runs in Tokyo and Osaka, Route 53 decides where requests go, and the table is replicated between the Regions
node client: Client
node dns: Route 53 | health checks, 2 records
node tokyo: API (Tokyo) | API Gateway, Lambda
node osaka: API (Osaka) | API Gateway, Lambda
node ttable: Replica (Tokyo) | aih-multi-region-notes
node otable: Replica (Osaka) | aih-multi-region-notes
edge client -> dns: resolves the name
edge dns -> tokyo: normally
edge dns --> osaka: when Tokyo is unhealthy
edge tokyo -> ttable: own Region only
edge osaka -> otable: own Region only
edge ttable --> otable: replicated asynchronously
group apn1: ap-northeast-1 = tokyo, ttable
group apn3: ap-northeast-3 = osaka, otable
mark ttable
```

```figure
caption: The table and the bucket are both replicated, each at its own speed and by its own rules
direction: right
node ttable: Table (Tokyo)
node tbucket: Bucket (Tokyo)
node otable: Table (Osaka)
node obucket: Bucket (Osaka)
edge ttable --> otable: both ways, usually within 1 s
edge tbucket --> obucket: Tokyo to Osaka by default
group apn1: ap-northeast-1 = ttable, tbucket
group apn3: ap-northeast-3 = otable, obucket
```

The first figure shows the path a request takes. The second shows the data that flows between the Regions.

There are two stacks, built from one class. The Tokyo stack (`AihMultiRegion`) holds the global table and Tokyo's bucket, function, and API. The Osaka stack (`AihMultiRegionStandby`) holds Osaka's bucket, function, and API. A replica of the table exists in Osaka too, but it is defined only in the Tokyo stack. The [Deploy page](/en/chapters/28-multi-region/deploy.md) says why.

The app is chapter 05's notes API, unchanged. The function's code is the same in both Regions, and each one reads and writes only the replica in its own Region. DynamoDB has no endpoint that spans Regions. Which Region's replica a function talks to is decided by the Region the function runs in.

The Route 53 part is created only when you name a domain. It needs a hosted zone and a domain, and health checks carry a monthly charge. Without it, you reach the two APIs directly, each at its own URL.

The Regions are named in one place.

<<< @/examples/28-multi-region/src/regions.ts{regions}

Osaka was chosen because it is in the same country as Tokyo, so the data does not leave the country. The two are close, so the replication lag can be expected to be small. In exchange, a disaster that covers a wide area may affect both at once. How far apart to put them depends on what you are preparing for.

## Active-passive and active-active

<!-- section: 28.modes -->

There are two broad ways to use two Regions.

- **Active-passive.** Normally only Tokyo answers requests, and Osaka waits. When Tokyo becomes unhealthy, you switch to Osaka
- **Active-active.** Both always answer. Each user connects to the nearer one

In Route 53's terms, a setup that uses failover routing is active-passive, and one that combines any other routing policy with health checks is active-active. This chapter's stacks use failover routing by default and change to latency routing with `-c routing=latency`.

What makes this confusing is that a DynamoDB global table is always active-active as a table. Every replica accepts reads and writes at any time. The rule "only Tokyo writes for now" does not exist inside DynamoDB. The app makes it, by deciding where requests are sent. The documentation says the same: to treat a table as active-passive, manage where writes go outside DynamoDB.

This chapter chooses **active-passive, with an automatic switch, and with Osaka accepting writes even while it waits**. The reasons follow.

Chapter 05's version check works only when both writes reach the same replica. As long as writes go to Tokyo alone, the check works as it always did. Active-active is faster, because users write to the nearer Region, but the moment edits to one note are split between two Regions, one of them silently disappears. For a notes app, that is a hard kind of breakage to accept.

The switch is automatic because the recovery time this chapter aims for is five minutes. That is too short for a person to notice, decide, and act. In exchange, for a short time around the switch, clients that remember the old destination write to Tokyo while new clients write to Osaka. During that time the setup breaks the way active-active does. This chapter estimates how long that time is, writes what happens as a test, and accepts it.

For those who do not want to accept it, there is a setting that keeps Osaka read-only while it waits (`-c standbyWrites=refuse`). Conflicting writes stop happening, but a person has to deploy again at the time of the switch, and the five-minute target can no longer be met.

One more way is to change the consistency mode. A global table has a mode in which a write returns success only after it has reached another Region (MRSC), and with it, edits split between two Regions still get a conflict on one side. It needs three Regions, writes become slower, and transactions and TTL stop being available. The pinned cdkd also does not handle the setting for this mode, so this chapter's stacks do not use it. The [next page](/en/chapters/28-multi-region/build.md) compares the behaviour in a model.

## What stays in one Region

<!-- section: 28.single-region -->

Replicating the table and the bucket does not make the whole app run in two Regions. Here is what the earlier chapters built that exists only in Tokyo.

- **Sign-in.** The Cognito user pool of [chapter 06](/en/chapters/06-auth.md) is created in one Region and stores user data only in that Region. Without reaching the user pool in Tokyo, nobody can sign in afresh. This chapter's API is chapter 05's, so it does not go through sign-in. Whether chapter 06's JWT authorizer, placed in Osaka, keeps validating the access tokens users already hold while Tokyo cannot be reached was not checked
- **Secrets.** The secrets of [chapter 21](/en/chapters/21-security.md) are in Secrets Manager in Tokyo. Secrets Manager can replicate a secret to other Regions, but chapter 21 does not use that, so they do not exist in Osaka
- **The deploy machinery.** The pipeline of [chapter 20](/en/chapters/20-shipping.md) and the bucket where cdkd keeps its state both assume Tokyo. If you need to change the Osaka stack while Tokyo is unavailable, the usual steps may not work
- **Queues and email.** The queue and worker of [chapter 08](/en/chapters/08-async.md) and the sending setup of [chapter 15](/en/chapters/15-email.md) were created in Tokyo by stacks in Tokyo. Osaka has no counterpart
- **Alarms and dashboards.** The alarms and dashboards of [chapter 19](/en/chapters/19-observability.md) were built to watch Tokyo's metrics. The logs and metrics of the function in Osaka appear in Osaka, so as things stand nobody is watching them

In other words, what works after this chapter's setup has switched to Osaka is reading and writing notes, for users who are already signed in. What gets in the way in a real failover is usually not the database but the items on this list. If you keep a second Region in production, decide for each item whether to replicate it, build it in Osaka as well, or accept that it stops.

The switch itself needs the same care. The Route 53 documentation recommends leaving a switch during a failure to mechanisms that work in the data plane alone, such as health checks. Rewriting a record through the console or the API is a control plane operation, and it may not be available in the middle of a failure. That is one more reason this chapter's default setup leaves the switch to health checks.

## When not to keep a second Region

If you have read this far and feel it is not worth it, you are probably right. A second Region adds less to the bill than to what you have to think about: conflicting writes, replication lag, resources that exist on one side only, and twice the deploying and monitoring.

A single-Region DynamoDB table has an availability SLA of 99.99%, and a global table has 99.999%. Ask first whether you need that difference. If the goal is not to lose data, chapter 22's backups are enough. If a few hours of downtime during a Region failure is acceptable, you can keep backups in another Region and rebuild there when the failure comes. This chapter's setup is for when the downtime you can accept is measured in minutes.
