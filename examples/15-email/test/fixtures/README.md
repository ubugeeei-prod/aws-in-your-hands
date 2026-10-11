# SES event fixtures

`bounce.json`, `complaint.json` and `delivery.json` follow the example records in
[Examples of event data that Amazon SES publishes to Amazon SNS](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-examples.html)
(read 2026-10-11), with the sender changed to `notes@example.com`, some headers
removed, and the `notification_id` message tag added.

They were not captured from a real AWS account. Each file is the JSON that SES
publishes: in production it arrives as the `Message` string of an SNS notification.
