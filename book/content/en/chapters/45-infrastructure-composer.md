---
title: "45 Infrastructure Composer: Reading a Template as a Diagram, and Drawing One"
sourceRevision: 1
---

# 45 Infrastructure Composer: Reading a Template as a Diagram, and Drawing One

A template is a graph: resources are its points, and the references between resources are its lines. Infrastructure Composer is the AWS tool that shows that graph as a diagram and lets you rewrite the template from the diagram's side. This chapter establishes that, for a reader who writes stacks in TypeScript CDK, the diagram is for reading and the place to write stays the code.

First, where the tool stands today. **The standalone Infrastructure Composer console ends on December 7, 2026.** It is due to stop accepting new customers on October 29, 2026. Two things remain. One is Infrastructure Composer inside the AWS Toolkit for Visual Studio Code, with the same canvas as before. The other is template studio in the CloudFormation console, a different editor that took over the place where Infrastructure Composer used to be embedded. For that reason this chapter has no walkthrough of the standalone console.

It builds on the synth and `cdk.out` of [chapter 02](/en/chapters/02-toolchain.md) and the CloudFormation deployment of [chapter 20](/en/chapters/20-shipping.md). The code is in `examples/45-infrastructure-composer/`. There is no CDK stack. What the chapter builds is a small module that reads a synthesized template as a graph, and it creates nothing in AWS.

The chapter's content was checked against the official documentation on October 13, 2026. Neither Infrastructure Composer nor template studio was actually opened. Every statement about a screen is either something the documentation says or something marked as not tried. The look of the screens is not described.

## Infrastructure Composer Today

<!-- section: 45.status -->

The tool was released in December 2022 under the name Application Composer and became generally available in March 2023. It began as a tool for assembling serverless architectures, gained support for every CloudFormation resource in September 2023, and was renamed Infrastructure Composer on October 4, 2024. The documentation's URLs and a menu name in the Toolkit guide still say Application Composer or App Composer.

It could be used in three places: its own console, CloudFormation console mode embedded in the CloudFormation console, and the AWS Toolkit for Visual Studio Code.

On September 29, 2026, this notice was added to the top of the developer guide.

```text
End of support notice: On December 7, 2026, the standalone AWS Infrastructure
Composer console will no longer be available. We have replaced Infrastructure
Composer with an improved visual IaC editor on the AWS console pages where it
was previously embedded. The full Infrastructure Composer experience remains
available via the AWS Toolkit for Visual Studio Code.
```

The page the notice links to says the following, as far as it concerns a reader of this book.

- The standalone console (`console.aws.amazon.com/composer`) cannot be opened after December 7, 2026. New customers are to be refused from October 29, 2026, a date the page calls a target
- Infrastructure Composer inside the AWS Toolkit for Visual Studio Code stays. The page says no changes are planned
- What was embedded in the CloudFormation console is replaced by a different editor built into that console. The exports to Infrastructure Composer in the Lambda and Step Functions consoles are removed
- Templates saved locally or in S3, and existing stacks, are not affected. Infrastructure Composer has no API, SDK, or CLI for customers to call

The CloudFormation User Guide calls the replacement editor in the CloudFormation console template studio. The page that used to describe Infrastructure Composer there now describes template studio.

So a reader starting with AWS now can use Infrastructure Composer in VS Code and template studio in the console. The two are alike, but they differ in whether you can edit from the diagram. The next section looks at that difference.

## What the Diagram Shows

<!-- section: 45.canvas -->

A diagram in Infrastructure Composer is made of cards and lines. A card is a resource, and a line is a connection between resources.

There are two kinds of card. A standard IaC resource card stands for one CloudFormation resource and exists for every resource type. An enhanced component card combines several resources that are commonly used together into one card, and comes with a form for configuring them.

What a line means also depends on the kind of card.

- You connect enhanced component cards by drawing a line from a port on one card to a port on another. The line is solid. When you draw it, Infrastructure Composer adds IAM policies, environment variables, and event configuration to the template as needed. The policies use SAM policy templates
- Standard IaC resource cards have no ports. You write the connection in the template, and Infrastructure Composer detects it and shows it as a dotted line

A solid line therefore says "this was drawn, and the template gained permissions and settings," and a dotted line says "this reference was in the template and has been drawn." When you open a template that CDK synthesized, the lines should be the ones read from the template. Which resources appear as enhanced component cards could not be confirmed from the documentation.

Groups come in the same two ways. Enhanced component cards are grouped by hand. On the standard side, the references decide. In the documentation's example, a Lambda function references a role, and the role's card is placed inside the function's card.

The diagram in template studio is simpler. The user guide says it draws a line wherever one resource refers to another through `Ref`, `Fn::GetAtt`, `Fn::Sub`, or `DependsOn`. It also says that a resource nothing references appears on its own, which makes a forgotten connection easy to spot. And you cannot edit from the diagram. The guide states that the template text is authoritative and that the diagram is only a representation of it.

The same guide has a caution about reading the diagram. When three functions use the same role, the diagram shows the role inside each function, but the template declares one role. Count resources in the template, not in the diagram.

## What It Reads and What It Writes

<!-- section: 45.files -->

Both tools read and write CloudFormation and SAM templates. Neither reads CDK code.

Infrastructure Composer in VS Code works on the template file you have open. According to the Toolkit guide, changes on the canvas are stored, and you can move between the canvas and editing the file directly. There are three ways to open it: the button at the top right of an editor holding a template, the menu on a right-clicked file, and the Command Palette. There is also a button for deploying, but it runs `sam sync` from the SAM CLI, which is not this book's route.

The standalone console had a feature called local sync that kept a folder on your machine in step. It uses the browser's File System Access API, so it needs Chrome or Edge. It ends with the standalone console, so this chapter says no more about it.

Template studio saves to S3. Edits are not saved automatically, and when you choose to save, it writes to the bucket CloudFormation manages for uploaded templates or to a bucket you name. The guide also says the following.

- It converts between YAML and JSON. Converting YAML to JSON removes the comments, and they do not come back
- Validation calls `ValidateTemplate`. It sends the template as the request body, so a draft over 51,200 bytes cannot be validated
- The diagram can be saved as a PNG
- It opens from Template studio in the navigation, from the page that creates a stack, from an update of an existing stack, and from other pages that display a template

What a tool does to a template it did not create is probably what a reader most wants to know. For template studio, the guide reads as saying that nothing changes unless you edit or convert. For Infrastructure Composer, the documentation says only that an imported template becomes an editable visualization. Whether merely opening and saving changes the formatting, or adds information for the diagram to the template, could not be confirmed from the pages read. Nor does the guide say whether VS Code opens a JSON template. The templates in `cdk.out` are JSON.

## What It Is Good For When You Write CDK

<!-- section: 45.cdk -->

This book's stacks are synthesized from TypeScript code. The template is a generated file that appears in `cdk.out`, and it is kept out of git.

```figure
caption: The diagram is for reading the synthesized template. A template saved from the diagram becomes a second source of truth beside the code.
node code: CDK code | TypeScript
node template: Template | cdk.out
node stack: Stack
node diagram: Diagram
node saved: Saved template
edge code -> template: synth
edge template -> stack: deploy
edge template -> diagram: open and read
edge diagram --> saved: edit from the diagram
edge saved -x stack: deploy
mark diagram
```

In this flow the diagram helps in two places.

One is looking at the synthesized template as a diagram before a review. A CDK construct creates several resources from one line. The code of chapter 04's stack creates four constructs, a log group, a role, a function, and an API, and otherwise only adds routes three times. The synthesized template still has 17 resources. Following which resource refers to which by reading the JSON from the top is tiring. In a diagram, a resource that is not connected, or a reference you did not expect, catches the eye.

The other is a sketch before writing. With no code yet, you place cards on the canvas to think about the architecture, then read the resulting template as a guide for writing the CDK. In this use you throw the resulting template away.

The reason a template written from the diagram has to be thrown away is this chapter's invariant. **One stack has one source of truth.** Draw one line in the diagram and save, and the template gains an IAM policy, while the CDK code knows nothing of it. The next synth produces a template without that policy, and a deploy removes the policy. If you deploy the saved template instead, the code no longer matches what exists. Nothing can decide afterwards which of the two was right.

The drift of chapters 02 and 20 was a disagreement between the template and what exists. What happens here comes before that: there are two templates. At the end of the next page, code compares two templates as graphs and finds where they disagree.

Readers of this book have one more constraint. Template studio can open the template of an existing stack, but only of a stack that CloudFormation holds. A stack that cdkd created is not in CloudFormation, so it is not in the list. In this book that leaves only the stack chapter 20 deployed with the AWS CDK CLI. For the other chapters you would open the file in `cdk.out` yourself. The guide does not describe how to load a file from your machine into template studio. Pasting it into the editor opened for a new template should work, but this was not tried.

So this chapter makes the same reading possible locally: a small module that reads a template from `cdk.out`, follows the same four forms of reference as template studio, and prints the graph as text. It is not Infrastructure Composer and does not replace it. It has no canvas and no cards. It is a list of points and lines that you can run with `vp run` before a review.

## When Not to Use It

<!-- section: 45.when-not -->

If you write your stacks in CDK and can read a template yourself, you lose nothing without a diagram tool. Each chapter's `infra:diff` task shows where a change lands in the template. A diagram tells you the overall shape, not the difference.

These uses are better avoided.

- Deploying a template edited from the diagram to a stack managed with CDK. It breaks the invariant of the previous section
- Keeping the diagram as a design document. A diagram can be redrawn from the template, and a saved image is out of date after the next change
- Building a new workflow on local sync in the standalone console. It stops working on December 7, 2026
- Counting resources in the diagram. As the template studio guide says, the same role can appear several times

It is different when the template is written by hand. If a SAM or CloudFormation YAML file is the source of truth, Infrastructure Composer in VS Code edits that source directly, and the invariant holds. This book does not write that way, but when you inherit such a repository, opening it as a diagram first is worth doing.
