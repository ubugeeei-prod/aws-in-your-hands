---
title: "45 Infrastructure Composer: Costs, Pitfalls, and Cleanup"
---

# 45 Infrastructure Composer: Costs, Pitfalls, and Cleanup

This is the last page of the chapter. It covers the cost, where people get stuck, the cleanup, and the verification notes.

## Cost

<!-- section: 45.cost -->

Infrastructure Composer has no additional charge. Its FAQ says that using Infrastructure Composer is not billed and that the resources created with it are billed as usual (checked 2026-10-13). Looking at a diagram inside the AWS Toolkit for Visual Studio Code creates no resource. Whether drawing the diagram needs AWS credentials is not stated in the guide.

Template studio costs something when you save. It saves to an S3 bucket, and the guide says the stored templates are billed at standard S3 rates. The default bucket is created at that moment if it does not exist. Templates are small files, and chapter 20's two templates measured 10,955 and 12,782 bytes locally, but reading does not require saving. No amount was calculated.

This chapter's code only reads local files. It creates nothing in AWS and has no pricing scenario.

## Where People Get Stuck

| Symptom | What to check |
| --- | --- |
| `no *.template.json here` | That chapter's synth has not been run yet. `cdk.out` is outside git |
| `name one of: ...` | `cdk.out` holds two or more stacks. Pass the stack's name as the second argument |
| `cannot read ... as a template` | `Resources` has an entry without a `Type`: a template that uses `Fn::ForEach`, or JSON that is not a template |
| A name under `names that are not in the template` | The reference points at neither a resource nor a parameter: a typo, or a reference left behind to a deleted resource |
| Resources that should be connected are apart | An ARN was written out as a string. It is not a reference, so the creation order is not guaranteed either |
| The count in a diagram differs from the template | Template studio may show a shared resource once per user of it. Count in the template |
| A setting vanished on the deploy after saving from a diagram tool | The CDK code is the source of truth, and the saved template is not applied. Write the change in the code |

## Cleanup

<!-- section: 45.cleanup -->

This chapter creates nothing in AWS. No task writes a file of its own locally either. `composer:graph:hello` and `composer:graph:ship` run the synth of chapters 02 and 20 first, so each `cdk.out` is regenerated. Both are outside git.

If you tried a diagram tool and saved a template locally or in S3, delete it, so that no second template of a stack managed with CDK stays in the repository. The bucket template studio saves to is the one CloudFormation uses for uploaded templates, so there is no need to delete the bucket itself.

::: details Verification notes for this chapter

**Checked locally.** Unit tests (the four forms that are followed and the forms that are not; attributes, literals, and map variables in `Fn::Sub`; parameters and pseudo parameters; reporting names the template lacks; omitted types; refusing an entry without a `Type` and `Fn::ForEach`; counts per type, unreferenced resources, unconnected resources, the longest chain, cycle detection; the five edits the comparison of two templates sees and the one it does not; the text and figure output; choosing a template in `cdk.out`). The type check. `composer:graph`, `composer:graph:hello`, and `composer:graph:ship`. The output quoted in the chapter is from local runs on October 13, 2026, on Node.js 24.21.0.

On the same day, all 50 `cdk.out` templates in the repository were read. None failed to load, and none had a name missing from its template or a cycle. Other chapters were still being written, so the count will change.

**Not checked yet.** Nothing was run against AWS. Neither Infrastructure Composer nor template studio was opened, so the following are unconfirmed: that this module's graph has the same lines as the template studio diagram; that Infrastructure Composer in VS Code opens the JSON templates in `cdk.out`; which resources of a CDK-synthesized template become enhanced component cards; how a template that was only opened and saved differs from the original; and how to load a local file into template studio.

Not confirmed from a primary source: where Infrastructure Composer writes groups and card positions in a template (the page on groups does not say); whether drawing a diagram in VS Code needs AWS credentials; and how CloudFormation treats a template with a cycle (the troubleshooting page has no statement). October 29, 2026, the date for closing to new customers, is one the page itself calls a target. The template studio page never uses the name Infrastructure Composer, so taking template studio to be the "replacement editor" of the notice is a judgment from the fact that the former Infrastructure Composer page's URL now returns the template studio page.

**Steps to check.** Install the AWS Toolkit in VS Code, run `vp run hello:infra:synth`, open `examples/02-toolchain/cdk.out/AihHello.template.json`, and press the Infrastructure Composer button at the top right of the editor. If a diagram appears, compare it with the output of `vp run composer:graph:hello`: there should be one line, from `NotesPolicy` to `Notes`. Then copy the file under another name, save it from the diagram without changing anything, and compare it with the original using `vp run composer:graph ../02-toolchain AihHello --against <copy>` and `diff`.

**Not used.** A CDK stack (there is no resource to create). The standalone Infrastructure Composer console and local sync (they end on December 7, 2026). Reading YAML (`cdk.out` is JSON, and no dependency was added). Chapter 33's check code (that chapter is being written at the same time, so nothing depends on it). A comparison with Cloudflare and Vercel (they have nothing that corresponds to a template, and no counterpart was confirmed from a primary source, so none is written).

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| Reading a Template as a Graph | `examples/45-infrastructure-composer/src/template.ts`, `src/graph.ts`, `test/graph.test.ts` | `test:unit` |
| The Summary | `examples/45-infrastructure-composer/src/summary.ts`, `test/summary.test.ts` | `test:unit` |
| As Text and as a Figure | `examples/45-infrastructure-composer/src/render.ts`, `fixtures/notes-api.template.json`, `test/render.test.ts` | `composer:graph`, `test:unit` |
| Reading Your Own Stacks | `examples/45-infrastructure-composer/scripts/graph.ts`, `src/cdk-out.ts`, `test/cdk-out.test.ts` | `composer:graph`, `composer:graph:hello`, `composer:graph:ship` |
| Comparing Two Templates | `examples/45-infrastructure-composer/src/diff.ts`, `test/diff.test.ts` | `composer:graph`, `test:unit` |

**Primary sources** (all checked 2026-10-13)

- Infrastructure Composer Developer Guide: [What is AWS Infrastructure Composer?](https://docs.aws.amazon.com/infrastructure-composer/latest/dg/what-is-composer.html), [End of support](https://docs.aws.amazon.com/infrastructure-composer/latest/dg/infrastructure-composer-end-of-support.html), [Document history](https://docs.aws.amazon.com/infrastructure-composer/latest/dg/doc-history.html), [CloudFormation console mode](https://docs.aws.amazon.com/infrastructure-composer/latest/dg/using-composer-console-cfn-mode.html), [Configure and modify cards](https://docs.aws.amazon.com/infrastructure-composer/latest/dg/using-composer-cards.html), [Standard cards](https://docs.aws.amazon.com/infrastructure-composer/latest/dg/using-composer-standard-cards.html), [Card connections](https://docs.aws.amazon.com/infrastructure-composer/latest/dg/using-composer-connecting.html), [Group cards](https://docs.aws.amazon.com/infrastructure-composer/latest/dg/reference-navigation-gestures-group.html), [Local sync](https://docs.aws.amazon.com/infrastructure-composer/latest/dg/using-composer-project-local-sync.html), [File System Access API](https://docs.aws.amazon.com/infrastructure-composer/latest/dg/reference-fsa.html), [External files](https://docs.aws.amazon.com/infrastructure-composer/latest/dg/using-composer-external-files.html), [Change Inspector](https://docs.aws.amazon.com/infrastructure-composer/latest/dg/using-change-inspector.html), [From the AWS Toolkit for Visual Studio Code](https://docs.aws.amazon.com/infrastructure-composer/latest/dg/using-composer-ide.html), [Visual overview (VS Code)](https://docs.aws.amazon.com/infrastructure-composer/latest/dg/using-composer-ide-visual.html), [Access from the Toolkit](https://docs.aws.amazon.com/infrastructure-composer/latest/dg/setting-up-composer-access-ide.html)
- Infrastructure Composer, elsewhere: [product page](https://aws.amazon.com/infrastructure-composer/), [FAQs](https://aws.amazon.com/infrastructure-composer/faqs/), [AWS Application Composer is now AWS Infrastructure Composer](https://aws.amazon.com/about-aws/whats-new/2024/10/aws-application-composer-infrastructure-composer/), [Working with AWS Infrastructure Composer in the Toolkit](https://docs.aws.amazon.com/toolkit-for-vscode/latest/userguide/appcomposer-overview.html)
- CloudFormation: [Edit templates visually with template studio](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/template-studio.html), [Ref](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/intrinsic-function-reference-ref.html), [Fn::GetAtt](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/intrinsic-function-reference-getatt.html), [Fn::Sub](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/intrinsic-function-reference-sub.html), [DependsOn attribute](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-attribute-dependson.html), [Troubleshooting](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/troubleshooting.html)

:::
