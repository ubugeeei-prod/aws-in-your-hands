---
title: "19 Observability: Deploy"
---

# 19 Observability: Deploy

## Deploy and check

<!-- section: 19.deploy -->

From here it's AWS. The steps in this section have not yet been run against a real account.

```bash
vp run obs:infra:diff
vp run obs:infra:deploy -c alarmEmail=you@example.com
```

The email address goes into the template and into cdkd's state. Use a shared address, or leave it out and add a subscription later. When the confirmation mail arrives, click the link.

Send some requests.

```bash
vp run obs:smoke
```

It creates a note, updates it with a stale version to cause a 409, reads a note that doesn't exist to cause a 404, and deletes the note. It prints the `x-request-id` of every response.

```bash
vp run obs:query --name request --id <x-request-id>
vp run obs:query --name errors --minutes 60
vp run obs:alarms
```

`obs:query` reads every log event in the time range you give, and you are billed for the amount read. Keep the range narrow. `obs:alarms` shows the state of the two alarms. Right after a deploy they are in `INSUFFICIENT_DATA`, which is normal.

To add the layer, take the ARN from the table in the ADOT documentation and pass it.

```bash
vp run obs:infra:deploy -c otelLayerArn=arn:aws:lambda:ap-northeast-1:615299751070:layer:AWSOpenTelemetryDistroJs:16
```

One note about cdkd. Reading the source of the pinned version (0.296.28), alarms, SNS topics and subscriptions, and log groups have dedicated implementations. Dashboards and metric filters do not, and go through Cloud Control API. Both types are on Cloud Control API's list of supported resources, but whether cdkd can really create them is unconfirmed.

Drift is checked as in earlier chapters.

```bash
vp run obs:infra:drift
```

## The browser side, and watching from outside

<!-- section: 19.browser-and-probes -->

Everything so far was on the server side. Two things are still out of sight.

**What happens in the user's browser.** The API may answer in 50 ms while the page takes 5 seconds to show. JavaScript errors never reach the server. **CloudWatch RUM** puts a small script into the page and collects load times and errors from real users. You choose what share of sessions to collect. The data is deleted after 30 days.

**Whether it is broken when nobody is there.** As we saw, with no requests the alarms stay silent. **CloudWatch Synthetics** runs scripts called canaries on a schedule, as often as once a minute, and calls your API or page from outside. Even in the middle of the night with no users, you find out that it is broken.

This chapter implements neither. Here is why.

- RUM needs a browser application, and a way to authorize the browser to send data to AWS. This chapter's subject is an API alone
- A Synthetics canary brings a Lambda function, an S3 bucket for its artifacts, and a runtime version of its own. Runtime versions are replaced often; written without checking, the example would be out of date quickly
- Both keep costing money for as long as they exist. The next section does the arithmetic

A rule of thumb for the order to add them. If your service has hours with no users, Synthetics comes first: it lets you tell "no data" from "broken". When how the SPA feels becomes the problem, that's RUM. Neither is late if it comes after server-side alarms and logs are in place.

The pinned cdkd has no dedicated implementation for `AWS::RUM::AppMonitor` or `AWS::Synthetics::Canary`. Both go through Cloud Control API.
