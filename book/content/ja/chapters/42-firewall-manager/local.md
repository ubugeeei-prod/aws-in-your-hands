---
title: "42 Firewall Manager: 手元で動かす"
---

# 42 Firewall Manager: 手元で動かす

## 手元で動かす

<!-- section: 42.local -->

[しくみと実装のページ](/ja/chapters/42-firewall-manager/build.md)で書いたモデルとスタックを、AWS を使わずに確かめます。この章には、手元で起動するサーバーがありません。動かすのは、テスト、2 つのスクリプト、synth です。組織もアカウントも要りません。

```bash
vp test run examples/42-firewall-manager
```

テストは 7 つのファイルに分かれています。

```text
file                                what it pins
test/scope.test.ts                  include and exclude maps, child OUs, AND and OR over tags, a resource created later, a resource that leaves by tag, quotas
test/security-group-audit.test.ts   CIDR containment, the audit rule, the three verdicts, rules read from a template
test/managed-service-data.test.ts   the JSON of both policies, unknown keys, WCU totals, the quota on rule groups
test/reconcile.test.ts              what the report says before and after an observation, the stale window, cleanup, a seeded walk of 2,000 steps
test/finding.test.ts                the finding event's shape, the notice it becomes, an unreadable event
test/cost.test.ts                   the month's arithmetic over data/pricing
infra/test/stacks.test.ts           both stacks: scope, resource types, the topic policy, the notifier's permissions, the context
```

fixture は、どれもこの章のために書いたものです。組織の fixture（`test/fixtures/organization.ts`）のアカウント ID は同じ数字の繰り返しで、OU の ID は Organizations の API リファレンスが書いているパターンに合わせただけの文字列です。実在の組織から取ったものはありません。

料金の計算は、次のタスクで見られます。`data/pricing/` の単価から、[最初のページ](/ja/chapters/42-firewall-manager.md)に書いた月額を計算します。

```bash
vp run fwm:cost
```

```text
  100.00  fms.policy.global.wafv2  (1 AWS WAF policy for CloudFront (Global))
  100.00  fms.policy.apne1.sg-content-audit  (1 security group content audit policy in ap-northeast-1)
   15.00  waf.global.webacl  (3 accounts x 1 managed web ACL)
    6.00  waf.global.rule  (3 web ACLs x 2 rule groups)
    1.80  waf.global.request  (3 web ACLs x 1000000 requests inspected)
    0.24  config.use1.item.continuous  (4 accounts x 20 items in us-east-1)
    2.40  config.item.continuous  (4 accounts x 200 items in ap-northeast-1)
    0.30  config.use1.rule.evaluation  (3 accounts x 100 evaluations (AWS WAF policy))
    0.30  config.rule.evaluation  (3 accounts x 100 evaluations (audit policy))
  226.04  USD a month at list price

Not in the sum:
  - Security Hub CSPM, which the findings travel through
  - S3 storage for the configuration history AWS Config delivers
  - whether the policy fee is prorated for a policy that exists for part of a month
  - how the rule groups Firewall Manager places in a member web ACL are metered (counted here as one rule each)
  - the notifier's Lambda, SNS, EventBridge, and CloudWatch Logs usage
```

合計に入れていない項目を、0 としてではなく、名前を挙げて出しています。数字の意味は[費用のページ](/ja/chapters/42-firewall-manager/wrap.md)で説明します。

監査のルールを、この本のスタックに当てることもできます。

```bash
vp run fwm:audit:templates
```

```text
compliant    AihEc2 InstanceSecurityGroup (examples/23-ec2/cdk.out)
incomplete   AihCelld NodeSecurityGroup (examples/24-celld/cdk.out)
             not-evaluated: the source is another security group
compliant    AihManagedInstances InstanceSecurityGroup896E10BF (examples/35-lambda-managed-instances/cdk.out)
compliant    AihDatabaseMigration ReplicationSecurityGroup (examples/39-database-migration/cdk.out)
incomplete   AihDatabaseMigration (group of SourceAllowsReplication) (examples/39-database-migration/cdk.out)
             not-evaluated: the source is another security group
incomplete   AihDatabaseMigration (group of TargetAllowsReplication) (examples/39-database-migration/cdk.out)
             not-evaluated: the source is another security group
compliant    AihFirewallManager AuditGroup (examples/42-firewall-manager/cdk.out)

46 templates, 4 groups compliant, 0 noncompliant, 3 with a rule this model does not evaluate.
```

この出力は 2026-10-13 に、その時点で `cdk.out` があった章について実行したものです。読むのは、各章の synth のタスクが書き出したテンプレートだけで、ほかの章のファイルは変更しません。synth していない章は対象に入らないので、件数は実行するたびに変わります。

`incomplete` は、送信元がほかのセキュリティグループになっているルールを含むグループです。モデルが評価しないルールで、準拠していないという意味ではありません。このタスクは報告を出すだけで、失敗の判定はしません。練習用のスタックは、このポリシーが見る組織に入っていないからです。

スタックの synth には、アカウントの ID と OU の ID が要ります。手元で形だけ確かめるためのタスクが、AWS のドキュメントが例に使う ID を渡します。

```bash
vp run fwm:infra:synth:example
```

`vp run fwm:infra:synth` を引数なしで実行すると、コンテキストが無いというエラーで止まります。これは意図した動作です。

### 手元では再現しないもの

手元で確かめられるのは、この章のコードが、この章の読み取りどおりに動くことだけです。次のものは再現しません。

- Firewall Manager そのもの。範囲の判定、web ACL の作成と関連付け、監査の判定、修復は、どれもモデルです。サービスがモデルと同じ答えを出すかどうかは分かりません
- AWS Organizations。OU の階層は fixture に書いたものです
- AWS Config。設定の変化が届くまでの時間は、テストでは「届ける」という 1 手で表しています。実際の遅れは再現しません
- Security Hub CSPM と、その finding。イベントは fixture です
- Cloud Control API が `AWS::FMS::Policy` を受け付けること。テンプレートの形までは確かめましたが、受け付けられるかどうかは、デプロイしないと分かりません
