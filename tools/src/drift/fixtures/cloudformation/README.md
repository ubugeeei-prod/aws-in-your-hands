# CloudFormation drift fixtures

One file per run of CloudFormation drift detection, as the four API calls would
answer it:

- `detect`: the response of `DetectStackDrift`, or `detectError` when the call throws
- `statuses`: successive responses of `DescribeStackDriftDetectionStatus`; the last one repeats
- `driftPages`: pages of `DescribeStackResourceDrifts`
- `resourcePages`: pages of `ListStackResources`

Written from the response shapes in the CloudFormation API reference and the types of
`@aws-sdk/client-cloudformation` 3.1149.0. None was captured from a real AWS account, so
values such as `DetectionStatusReason`, `DriftStatusReason`, and the error message for a
missing stack are plausible examples, not recorded output. Capturing real responses is part
of the chapter 20 cloud validation, which has not been run yet (see `data/validation.json`).
