---
title: "19 Observability: Deploy"
---

# 19 Observability: Deploy

## Deploying and checking

<!-- section: 19.deploy -->

From here you deploy to AWS and check the alarms, the queries and the traces against the real services. The steps in this section have not yet been run against real AWS.

```bash
vp run obs:infra:diff
vp run obs:infra:deploy -c alarmEmail=you@example.com
```

The email address goes into the template and into cdkd's state. Use a shared address, or leave it out here and add a subscription later. When the confirmation email arrives, click the link.

Next, send some requests.

```bash
vp run obs:smoke
```

`obs:smoke` creates a note, updates it with an old version to cause a 409, reads a note that does not exist to cause a 404, and then deletes the note. It prints the `x-request-id` of each response, and you pass that value to the next query.

```bash
vp run obs:query --name request --id <x-request-id>
vp run obs:query --name errors --minutes 60
vp run obs:alarms
```

`obs:query` reads every log event in the time range you give it and you are charged for the amount it reads, so keep the range narrow. `obs:alarms` shows the state of the two alarms. Right after a deploy it shows `INSUFFICIENT_DATA`, which is normal.

To add the layer, take the ARN from the table in the ADOT documentation and pass it.

```bash
vp run obs:infra:deploy -c otelLayerArn=arn:aws:lambda:ap-northeast-1:615299751070:layer:AWSOpenTelemetryDistroJs:16
```

For cdkd, the source of the pinned version (0.296.28) shows how it handles each resource type. Alarms, SNS topics and subscriptions, and log groups have dedicated implementations. Dashboards and metric filters have none and go through Cloud Control API. Both types are on Cloud Control API's list of supported resources, but whether cdkd can create them in practice is unconfirmed.

The drift check is the same as in earlier chapters.

```bash
vp run obs:infra:drift
```

## The browser side, and monitoring from outside

<!-- section: 19.browser-and-probes -->

Everything built so far looks at the server side. That leaves two things you still cannot see.

One is what happens in the user's browser. The API may answer in 50 milliseconds while the page takes 5 seconds to display. JavaScript errors do not reach the server either. CloudWatch RUM puts a small script in the page and collects display times and errors from real users. You choose what share of sessions to collect. The data is deleted after 30 days.

The other is whether the service is broken while nobody is using it. As the [first page](/en/chapters/19-observability.md) showed, the alarms do not fire when there are no requests. CloudWatch Synthetics runs scripts called canaries at a fixed interval (every minute at the shortest) and calls your API or page from outside. You then find out when the service breaks late at night with no users.

This chapter implements neither, for three reasons.

- RUM needs a browser application and the authorization settings that let a browser send data to AWS. The subject of this chapter is an API only
- A Synthetics canary comes with a Lambda function, an S3 bucket for its artifacts, and its own runtime version. Runtime versions are replaced often, so an example written without checking would be out of date quickly
- Both keep costing money for as long as they exist. The [cost section](/en/chapters/19-observability/wrap.md) works out the amounts

Here is a rough guide to the order in which to add them. If your service has hours with no users, add Synthetics first, because it lets you tell an alarm's "no data" apart from "broken". Add RUM when the perceived slowness of the SPA becomes a problem. Both can wait until the server-side alarms and logs are in place.

The pinned version of cdkd has no dedicated implementation for `AWS::RUM::AppMonitor` or `AWS::Synthetics::Canary`, so both go through Cloud Control API.
