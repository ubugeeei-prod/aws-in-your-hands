---
title: "45 Infrastructure Composer: Design and Build"
---

# 45 Infrastructure Composer: Design and Build

This page builds a module that reads a synthesized template as a graph. It turns resources into points and references into lines, then reports the count per type, the resources nothing refers to, and the longest chain of references. At the end it compares two templates that both claim to describe the same stack.

This is not Infrastructure Composer. The forms of reference it follows are the four the template studio guide names, but whether it produces the same result as the template studio diagram was not checked.

## Reading a Template as a Graph

<!-- section: 45.graph -->

The module reads only three parts of a template: `Resources`, `Parameters`, and `Outputs`. A resource needs a `Type`, and `DependsOn` is a string or an array of strings. Everything else passes through without a shape imposed on it.

<<< @/examples/45-infrastructure-composer/src/template.ts{schema}

It reads JSON only, because the templates in `cdk.out` are JSON. It does not read YAML.

The graph has the following types. A line points the way "`from` writes the name of `to`", and in that case CloudFormation creates `to` first and deletes `from` first.

<<< @/examples/45-infrastructure-composer/src/graph.ts{types}

Four forms become lines.

- `{ "Ref": "Name" }`
- `{ "Fn::GetAtt": ["Name", "Attribute"] }`. A `Ref` on the attribute side is followed as well
- `{ "Fn::Sub": "…${Name}…" }`, and `{ "Fn::Sub": ["…", { … }] }` with a map of variables
- A resource's `DependsOn`

`Ref` and `Fn::GetAtt` are found as objects with exactly one key, at any depth inside a resource.

<<< @/examples/45-infrastructure-composer/src/graph.ts{walk}

`Fn::Sub` has three rules. `${Bucket.Arn}` reads an attribute of `Bucket`, so the name ends before the dot. `${!Literal}` is not a name but the literal text `${Literal}`. And a name written in the map is a variable of that `Fn::Sub` alone, so it does not point at a resource of the same name.

<<< @/examples/45-infrastructure-composer/src/graph.ts{sub}

A name that is a resource becomes a line. A parameter, or a pseudo parameter such as `AWS::Region`, becomes neither a line nor an error. A name that is none of these is kept in `unresolved`, because a reference to something the template does not contain should be shown, not silently dropped.

<<< @/examples/45-infrastructure-composer/src/graph.ts{graph}

What is not followed is decided too.

- `Fn::ImportValue`. It points at another stack's output, so the other end is not in this template
- A resource's `Condition`, and the first argument of `Fn::If`. They name a condition, not a resource
- A resource's name that happens to occur in a description or an ARN string
- The unexpanded form of a transform such as `Fn::ForEach`. If `Resources` has an entry without a `Type`, the template is refused when it is read. SAM's `AWS::Serverless::Function` is read as one point, and the resources it expands to are not seen

A template synthesized by CDK contains one `AWS::CDK::Metadata` resource. Nothing refers to it, so left alone it would show up every time as a disconnected resource. The CLI leaves that type out and says so in one line.

## The Summary

<!-- section: 45.summary -->

Before a review, what you want is less the graph itself than its summary.

<<< @/examples/45-infrastructure-composer/src/summary.ts{summary}

`unreferenced` holds the resources whose name no other resource writes. It is not a list of mistakes. Resources that only ever refer to others, such as an API route or a Lambda permission, are always in it. You look for one you do not recognize among them.

`isolated` holds the resources that are not referenced and refer to nothing themselves. In a stack with a single bucket that is expected, but when it appears in a stack with many resources, suspect a forgotten connection or a forgotten deletion.

`longestChain` is the longest path you can walk along references. Where the chain is long, the order of creation and of deletion is fixed, and one failure reaches furthest.

When the references form a cycle, there is no longest path. In that case the summary gives no path and gives one cycle instead.

<<< @/examples/45-infrastructure-composer/src/summary.ts{chain}

How CloudFormation treats a template with a cycle was not stated on the pages read for this chapter. It should be refused, since no creation order exists, but this was not confirmed. None of this book's `cdk.out` templates had a cycle.

## As Text and as a Figure

<!-- section: 45.render -->

The basic output is text. For this chapter's fixture (`fixtures/notes-api.template.json`) it looks like this. The fixture is a template written by hand for this chapter. It was never deployed and never validated by CloudFormation.

```text
notes-api: 9 resources, 11 connections

types
  1  AWS::ApiGatewayV2::Api
  1  AWS::ApiGatewayV2::Integration
  1  AWS::ApiGatewayV2::Route
  1  AWS::DynamoDB::Table
  1  AWS::IAM::Policy
  1  AWS::IAM::Role
  1  AWS::Lambda::Function
  1  AWS::Lambda::Permission
  1  AWS::SQS::Queue

connections (from names to)
  FnPolicy -> FnRole  [Ref]
  FnPolicy -> NotesTable  [GetAtt]
  NotesFn -> FnRole  [GetAtt]
  NotesFn -> NotesTable  [Ref]
  NotesFn -> FnPolicy  [DependsOn]
  ApiIntegration -> Api  [Ref]
  ApiIntegration -> NotesFn  [GetAtt]
  ApiRoute -> Api  [Ref]
  ApiRoute -> ApiIntegration  [Sub]
  InvokePermission -> NotesFn  [Ref]
  InvokePermission -> Api  [Sub]

no resource names these
  ApiRoute  AWS::ApiGatewayV2::Route
  InvokePermission  AWS::Lambda::Permission
  LeftoverQueue  AWS::SQS::Queue

no connection at all
  LeftoverQueue  AWS::SQS::Queue

longest chain (5)
  ApiRoute -> ApiIntegration -> NotesFn -> FnPolicy -> FnRole

outputs
  ApiEndpoint -> Api

names that are not in the template
  (none)
```

`LeftoverQueue` is a forgotten deletion put there on purpose. Three resources are referenced by nothing, but only this one is connected to nothing, and the summary shows it apart.

For a graph of up to nine resources, the same graph can also be printed in this book's figure notation. With `--figure`, the CLI prints the lines that go into a ```` ```figure ```` block. A reference that passes a value is a solid arrow, and a connection made by `DependsOn` alone is a dashed one.

<<< @/examples/45-infrastructure-composer/src/render.ts{figure}

The fixture as a figure looks like this. The box and arrow lines are pasted from the CLI's output, and a test checks that the figure on this page and the CLI's output are the same.

```figure
caption: The references in the fixture template. The resource an arrow starts from writes the name of the resource it points at. Only LeftoverQueue is connected to nothing.
node ApiRoute: ApiRoute | AWS::ApiGatewayV2::Route
node InvokePermission: InvokePermission | AWS::Lambda::Permission
node LeftoverQueue: LeftoverQueue | AWS::SQS::Queue
node ApiIntegration: ApiIntegration | AWS::ApiGatewayV2::Integration
node NotesFn: NotesFn | AWS::Lambda::Function
node Api: Api | AWS::ApiGatewayV2::Api
node FnPolicy: FnPolicy | AWS::IAM::Policy
node NotesTable: NotesTable | AWS::DynamoDB::Table
node FnRole: FnRole | AWS::IAM::Role
edge FnPolicy -> FnRole: Ref
edge FnPolicy -> NotesTable: GetAtt
edge NotesFn -> FnRole: GetAtt
edge NotesFn -> NotesTable: Ref
edge NotesFn --> FnPolicy: DependsOn
edge ApiIntegration -> Api: Ref
edge ApiIntegration -> NotesFn: GetAtt
edge ApiRoute -> Api: Ref
edge ApiRoute -> ApiIntegration: Sub
edge InvokePermission -> NotesFn: Ref
edge InvokePermission -> Api: Sub
```

A graph of more than nine resources is not drawn. `docs/FIGURES.md` allows one figure nine boxes, and most of this book's stacks are larger than that. Making a large graph into a readable diagram takes a way of grouping it, and that is the work the groups of Infrastructure Composer and the diagram of template studio do. This module does not go that far.

## Reading Your Own Stacks

<!-- section: 45.run -->

There are three tasks. All of them only read files, and touch neither AWS nor the network.

```bash
vp run composer:graph          # no argument: this chapter's fixture
vp run composer:graph:hello    # chapter 02's AihHello (synthesizes first)
vp run composer:graph:ship     # chapter 20's AihShipApi (synthesizes first)
```

For another chapter's stack, pass the example's directory and the stack's name. When `cdk.out` holds a single template the name can be left out. When it holds two or more and no name is given, the task does not guess: it lists the names and stops.

```bash
vp run notes:infra:synth
vp run composer:graph ../05-dynamodb
vp run composer:graph ../20-shipping AihShipCi
```

<<< @/examples/45-infrastructure-composer/src/cdk-out.ts{choose}

Chapter 02's `AihHello` is the smallest example.

```text
AihHello: 2 resources, 1 connection
left out: CDKMetadata (AWS::CDK::Metadata)

types
  1  AWS::S3::Bucket
  1  AWS::S3::BucketPolicy

connections (from names to)
  NotesPolicyE872504C -> Notes5BB3582F  [Ref, GetAtt]

no resource names these
  NotesPolicyE872504C  AWS::S3::BucketPolicy

no connection at all
  (none)

longest chain (2)
  NotesPolicyE872504C -> Notes5BB3582F

outputs
  NotesBucketName -> Notes5BB3582F

names that are not in the template
  (none)
```

Chapter 02's code has no line that creates a bucket policy. CDK created it from the bucket's `enforceSSL`, and this output shows that it refers to the bucket in two forms.

Chapter 20's `AihShipApi` has 18 resources and 29 connections, and its output is long. Two things stood out on reading it.

```text
AihShipApi: 18 resources, 29 connections
left out: CDKMetadata (AWS::CDK::Metadata)

types
  5  AWS::ApiGatewayV2::Route
  5  AWS::Lambda::Permission
  1  AWS::ApiGatewayV2::Api
  1  AWS::ApiGatewayV2::Integration
  1  AWS::ApiGatewayV2::Stage
  1  AWS::IAM::Role
  1  AWS::Lambda::Alias
  1  AWS::Lambda::Function
  1  AWS::Lambda::Version
  1  AWS::Logs::LogGroup
```

The first is that there is only one Integration. Its logical ID is `ApiGEThealthNotesA0A0F53E`, which by its name looks as if it belonged to `GET /health`, yet in the list of connections all five routes refer to it. Judging from the logical ID, the Integration was created at the first route added and the other routes reuse it. Reading the template from the top, this is easy to miss.

The second is the longest chain. It runs through seven resources: from a route through the Integration, the alias, the version, the function, and the role to the log group. The role refers to the log group because the role's policy allows writing logs only to that log group's ARN. The result of least privilege is visible as a line.

These outputs come from templates synthesized locally on October 13, 2026. The string at the end of a logical ID is chosen by CDK and changes when the CDK version or the code changes.

## Comparing Two Templates

<!-- section: 45.diff -->

The [overview](/en/chapters/45-infrastructure-composer.md) page stated this chapter's invariant as "one stack has one source of truth." A template saved from a diagram tool and left lying around breaks it. To notice that it is broken, compare the two templates as graphs.

<<< @/examples/45-infrastructure-composer/src/diff.ts{diff}

The tests treat the fixture as the synthesized template, apply one edit at a time of the kind a diagram tool would make, and check that the difference is seen. There are five: adding a card, deleting a card, replacing a reference with a string, removing a `DependsOn`, and changing the type under the same logical ID.

Only the shape is compared. Property values are not. Changing the billing mode from `PAY_PER_REQUEST` to `PROVISIONED` leaves the graph the same, so no difference is reported. The tests include this case too, and check that it is not seen. To see differences in values, compare the templates themselves with `diff`, or use each chapter's `infra:diff` task.

On the CLI, pass the template to compare against with `--against`. When there is a difference the exit code is 1.

```bash
vp run composer:graph ../20-shipping AihShipApi --against ~/Downloads/template.json
```

A template saved from a diagram tool has never actually been put through this comparison, because how a template saved by Infrastructure Composer differs from what was opened has not been checked. The steps to check it are in the verification notes on the [Costs, Pitfalls, and Cleanup](/en/chapters/45-infrastructure-composer/wrap.md) page.
