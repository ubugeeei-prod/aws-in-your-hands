---
title: "05 KV Store: Deploy"
---

# 05 KV Store: Deploy

## Getting ready for AWS

<!-- section: 05.infra -->

<<< @/examples/05-dynamodb/infra/lib/notes-stack.ts{table}

`billingMode` is on-demand. You are charged for the number of reads and writes and don't have to decide capacity in advance. The other option is provisioned, where you decide the read and write capacity per second and pay for the time it is provisioned. If traffic is steady and predictable, provisioned can be cheaper, but it also costs money during the time you don't use it. On-demand suits learning, and new apps whose traffic can't be predicted.

`maxReadRequestUnits` and `maxWriteRequestUnits` cap what the table accepts in reads and writes each second. On-demand means you pay for what is used, so with nothing written here, whatever gets thrown at the table goes straight onto the bill. Past the cap, DynamoDB turns requests away.

<<< @/examples/05-dynamodb/infra/lib/notes-stack.ts{limits}

The API Gateway in front has the same throttling as chapter 04: 10 requests a second. The table's numbers sit just above the most this API can use in a single call. A list reads at most 1 MB at once, which is 128 units, and writing the largest note (a 10,000-character body) is about 31 units. Whether a smaller cap would keep a large note from ever getting through hasn't been checked, so the cap stays above it.

`removalPolicy` is `DESTROY`. Delete the stack and the table goes with it, along with every note in it. That's because this is for practice. A test goes out of its way to check this setting, since it's the first place to change once you start storing data that has to be protected.

<<< @/examples/05-dynamodb/infra/lib/notes-stack.ts{role}

Writing `table.grantReadWriteData(role)` would do this in one line. But those permissions also include `Scan`, which reads the whole table, and the operations that read and write in batches. This app uses none of them. A permission that isn't used only widens what can be abused if the code has a defect, so the five operations are listed one by one. The test checks that the operations are these five and that the resource is the ARN of this table only.

<<< @/examples/05-dynamodb/infra/lib/notes-stack.ts{function}

`TABLE_NAME` passes the table's name, which is determined at deploy time, to the function as an environment variable. The name isn't written in the code.

`externalModules: []` tells the bundler to include the AWS SDK in the bundle. If nothing is specified, the SDK is left out of the bundle and the version that ships in the Lambda runtime is used. That version has nothing to do with this repository's lockfile. With the SDK included, the version that runs is the one that was tested. The price is a larger bundle.

The `banner` line deals with a side effect of that. The bundled SDK calls `require()` internally, and an ES module has no `require`, so without help the function fails the moment it is loaded. The banner defines `require` at the top of the bundle. Unit tests cannot catch this, because the test runner supplies its own `require`. That is why `vp run bundles:check` loads each synthesized bundle in plain Node.js.

## Deploy it and check

<!-- section: 05.deploy -->

```bash
vp run notes:infra:diff
vp run notes:infra:deploy
vp run notes:smoke
```

`notes:smoke` uses the typed client to create one note, read it back, update it, check that an update with a deliberately old version is rejected, and finally delete it. Unlike the chapter 04 smoke task, the read-back has to succeed no matter which execution environment answers.

You can look at the contents of the table in the DynamoDB console, under "Explore items".

The drift check is the same as in the earlier chapters.

```bash
vp run notes:infra:drift
```

`AWS::DynamoDB::Table` is a type that the pinned version of cdkd handles with a dedicated implementation. The result against real AWS hasn't been checked yet.
