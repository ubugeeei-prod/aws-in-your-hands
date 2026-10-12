---
title: "31 Progressive Delivery: Run It Locally"
---

# 31 Progressive Delivery: Run It Locally

## Running it locally

<!-- section: 31.local -->

Of what the [pages so far](/en/chapters/31-progressive-delivery/more.md) built, the flags and the application run on your machine without AWS. Copy `examples/31-progressive-delivery/.env.example` to `.env` and start the server.

<<< @/examples/31-progressive-delivery/.env.example

```bash
vp run dev:rollout
```

There is no AppConfig extension on a laptop, so the flags are read from the file `FLAGS_FILE` names. It is the same `flags/flags.json` that is stored in AppConfig.

<<< @/examples/31-progressive-delivery/src/flags/reader.ts{file}

The file is read again on every request, so an edit made while the server is running shows from the next request. Call it from another terminal.

```bash
curl -i http://localhost:8787/health
curl -i http://localhost:8787/stats
```

```text
HTTP/1.1 200 OK
x-app-version: local
x-flags-origin: live
```

The first response carries these two headers. There is no Lambda version locally, so `x-app-version` is `local`. The second is a 404. With `noteStats` off, a route named `/stats` is treated as not existing.

Edit `values` in `flags/flags.json` so that `readOnly` is `true` and `noteStats` is `{ "enabled": true, "rolloutPercent": 100 }`. Now `/stats` returns the number of notes, as in `{"notes":0}`, and `POST /notes` returns 503. The server does not need a restart.

Next, break the file. Save it with just `{` in it and send `POST /notes` again. The response is still 503, and `x-flags-origin` has changed to `last-known`. The server's log shows this line.

```text
{"level":"warn","message":"flags","origin":"last-known","error":"The flag file is not JSON."}
```

The broken configuration is not used, and the server goes on with the last values it could read. This is the path of "When AppConfig cannot be reached" on the previous page, taken with a file. Put the file back when you are done. `vp run flags:check` tells you whether it is back.

With `rolloutPercent` at 10, whether `/stats` exists depends on `x-client-id`.

```bash
curl -i -H 'x-client-id: alice' http://localhost:8787/stats
```

The same ID gets the same result however often it calls, and across IDs about one in ten gets a 200.

### Counting answers per version

`rollout:probe` calls `/health` over and over and counts how many answers each version gave. It is meant for watching a shift on AWS, and with `--url` it works against the local server too.

<<< @/examples/31-progressive-delivery/src/probe.ts{tally}

```bash
vp run rollout:probe --url http://localhost:8787 --count 40
```

Set `FAULT_PERCENT` to 30 in `.env` and restart, and about three requests in ten answer 500. This is the output of one local run. The number of 500s differs from run to run.

```text
api: http://localhost:8787
version local: 40 of 40 (100.0%), 7 with 5xx
flags: live 40
```

### Tests

```bash
vp test run examples/31-progressive-delivery
```

There are 12 test files. The shift plan, the decision from the alarms, and the run replace the alias, the alarms, and the clock with fakes and make failures happen in a fixed order. The flag tests cover the checks on the definition file, the percentage rollout, and the fallback when the source cannot be reached. The application tests keep chapter 04's application inside and check the behaviour flag by flag. The stack tests pin the permissions, where the alias sits, the alarms, and the list of resource types.

To look at a plan alone, pass its name.

```bash
vp run rollout:plan --plan Linear10PercentEvery1Minute --bake 120
```

### What does not reproduce locally

What runs locally is the decisions and the application's behaviour. The following can only be checked by deploying to AWS.

- How a weighted alias really splits requests. The split in the tests is a seeded random number
- The AppConfig extension. The local source is a file, with no cache, no check every 45 seconds, and no prefetch at startup
- AppConfig handing a configuration out to execution environments, and its automatic rollback on an alarm
- How long an alarm takes to reach `ALARM`. The clock in the tests only changes the alarm's state at a chosen time
- Whether cdkd can actually create this stack's resources
