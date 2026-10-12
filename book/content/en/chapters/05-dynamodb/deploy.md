---
title: "05 KV Store: Deploy"
---

# 05 KV Store: Deploy

This page puts the API that ran locally onto AWS. Compared with chapter 04, the architecture gains a DynamoDB table and the permissions and settings the function needs to use it.

## Getting ready for AWS

<!-- section: 05.infra -->

<<< @/examples/05-dynamodb/infra/lib/notes-stack.ts{table}

`billingMode` is on-demand. With on-demand you are charged for the number of reads and writes, and you don't decide capacity in advance. The other option is provisioned, where you decide the read and write capacity per second and pay for the time it is reserved. When the volume of requests is steady and predictable, provisioned can be cheaper, but it also costs money while you aren't using it. On-demand suits learning, and new apps whose request volume can't be predicted.

`maxReadRequestUnits` and `maxWriteRequestUnits` cap the reads and writes the table accepts each second. On-demand charges for what is used, so without a cap, a flood of calls goes straight onto the bill. DynamoDB turns away whatever exceeds the cap.

<<< @/examples/05-dynamodb/infra/lib/notes-stack.ts{limits}

The API Gateway in front has the same throttling as in chapter 04, 10 requests a second. The table's caps sit above the most this API can use in a single request. A list reads at most 20 notes at once. If every one of them is the largest note (a 10,000-character body), that is about 610 KB, or 77 units, and writing one such note is about 31 units. Whether a smaller cap would keep a large note from ever getting through hasn't been checked, so the caps stay above those figures.

`removalPolicy` is `DESTROY`. This table is for practice, so deleting the stack deletes the table and every note in it. A test checks this value explicitly, because it is the first setting to change once you store data that has to be protected.

<<< @/examples/05-dynamodb/infra/lib/notes-stack.ts{role}

`table.grantReadWriteData(role)` would do this in one line, but the permissions it grants also include `Scan`, which reads the whole table, and the operations that read and write in batches. This app uses none of them. An unused permission only widens what can be abused if the code has a defect, so the role lists just the five operations the app uses. The test checks that the operations are these five and that the resource is the ARN of this table only.

<<< @/examples/05-dynamodb/infra/lib/notes-stack.ts{function}

`TABLE_NAME` passes the table's name, which is determined at deploy time, to the function as an environment variable. The name isn't written in the code.

`externalModules: []` includes the AWS SDK in the bundle. If nothing is specified, the SDK is left out of the bundle and the version that ships in the Lambda runtime is used. That version has nothing to do with this repository's lockfile. With the SDK in the bundle, the version that runs is the one that was tested. The bundle is larger as a result.

The `banner` line deals with a side effect of bundling the SDK. The bundled SDK calls `require()` internally, and an ES module has no `require`, so without help the function fails as soon as it is loaded. The banner defines `require` at the top of the bundle. Unit tests can't catch this problem, because the test runner has its own `require`. That is why `vp run bundles:check` loads each synthesized bundle in plain Node.js.

## Deploying and checking

<!-- section: 05.deploy -->

```bash
vp run notes:infra:diff
vp run notes:infra:deploy
vp run notes:smoke
```

`notes:smoke` uses the typed client to create one note, read it back, update it, confirm that an update with a deliberately old `version` is rejected, and finally delete the note. Unlike chapter 04's `api:smoke`, the read-back has to succeed whichever execution environment answers.

You can look at the contents of the table in the DynamoDB console, under "Explore items".

The drift check is the same as in the earlier chapters.

```bash
vp run notes:infra:drift
```

`AWS::DynamoDB::Table` is a type that the pinned version of cdkd handles with a dedicated implementation. The result against real AWS hasn't been checked yet.
