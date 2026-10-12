---
title: "33 Production Readiness: 費用、注意点、片付け"
---

# 33 Production Readiness: 費用、注意点、片付け

章の最後のページです。本番向けの設定が足す料金、つまずきやすいところ、自分のプロジェクトに持っていくときに足すもの、片付けの順に書きます。検証した範囲と一次情報は、ページ末尾の検証メモにあります。

## 料金

<!-- section: 33.costs -->

この章のスタックはデプロイしないので、この章そのものにかかる料金はありません。検査もテストも、手元で動くだけです。

ここで計算するのは、[しくみと実装](/ja/chapters/33-production-readiness/build.md)の Aspect が当てる設定が、19章のノート API にいくら足すかです。金額は USD、東京リージョン、従量課金、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

Aspect が変える設定は 4 つあり、そのうち料金の項目があるのは 2 つです。

| 設定 | 数量 | 定価 | 毎月の無料枠の適用後 |
| --- | --- | --- | --- |
| PITR の保存 | 1 GB 月 | 0.23 | 0.23 |
| ログの保存（7 日から 90 日に延ばしたぶん） | 2.638 GB 月 | 0.09 | 0 |
| 小計 | | **0.32** | **0.23** |

仮定は、19章の料金の計算と同じ月 100 万リクエストで、ログが 1 リクエストあたり 1 KB、テーブルの大きさが 1 GB です。PITR の保存量は、テーブルと同じ 1 GB と仮定しました。PITR が持つ変更の記録のぶんがどう数えられるかは確かめておらず、含めていません。ログの保存の無料枠（月 5 GB）は、アカウント全体で共有します。

残りの 2 つ、削除保護と、`DeletionPolicy`・`UpdateReplacePolicy` には、料金の項目がありません。東京リージョンの DynamoDB の Price List に載っている 27 品目の中に、削除保護にあたるものはありませんでした（2026-10-12 に確認）。ただし `Retain` は、スタックを消したあともリソースを残すので、消し忘れたテーブルやロググループの保存料金が続きます。

誰も呼ばない月なら、足されるのは、空に近いテーブルの PITR の保存料金だけです。アラームの料金（定価で月 0.30）は 19章のスタックがもともと持っているもので、この設定で増えるわけではありません。

準備の項目のうち、月額のかかるものは、ほかの章にあります。web ACL、customer managed の KMS の鍵、シークレットは [21章の料金の節](/ja/chapters/21-security/wrap.md)に、AWS Backup と複製は [22章](/ja/chapters/22-recovery/wrap.md)に、外からの監視は [19章](/ja/chapters/19-observability/wrap.md)にあります。アカウントを分けること、Organizations、SCP は、21章によれば追加料金がかかりません。

金額より大きいのは、人の時間です。復元の訓練、当番、障害の記録は、どれも Price List に載っていません。この章の 32 項目のうち、料金表で値段がわかるものは少数です。

## つまずきやすいところ

| 症状 | 見るところ |
| --- | --- |
| `ready:gate` が `no such template was read` で失敗する | `AihReadyProduction.template.json` が `cdk.out` にありません。`vp run ready:infra:synth` を実行します。`ready:gate` をタスクとして実行していれば、先に synth が動きます |
| `waiver for ... matches nothing; delete it` で失敗する | 例外が指しているリソースの論理 ID が変わったか、原因が直っています。論理 ID の末尾の 8 文字は、コンストラクトのパスから決まるので、コンストラクトの名前を変えると変わります。直っていたのなら、例外を消します |
| 出力が `stateful-delete` で埋まる | 練習用のスタックを読んでいます。通過を求めたいスタックだけを `--gate` で指定し、読むディレクトリを引数で絞ります |
| アラームがあるのに `function-alarm` が出る | アラームが見ているのが、このルールの辿らない経路です。トピック、スケジュール、ステートマシンの先の関数は、関数そのものを見るアラームを足すか、理由を書いて例外にします |
| 購読があるのに通知が届かない | 検査は購読の有無しか見ていません。確認メールのリンクを押したか、トピックのポリシーがアラームからの publish を許しているかを、[19章](/ja/chapters/19-observability.md)の手順で確かめます |
| `ready:check` に時間がかかる | 本のすべてのスタックを合成しています。スクリプトを直接、読みたい `cdk.out` を引数にして実行すれば、合成はしません |
| テンプレートを直したのに指摘が消えない | 検査が読むのは `cdk.out` です。コードを変えたあとに synth をやり直していないと、古いテンプレートを読みます |

## 自分のプロジェクトに持っていくなら

- **既製の道具から始めます。** cdk-nag や CloudFormation Guard は、この章の 10 個よりずっと多くのルールを持っています。この章のコードは、足りないルールを書くときの形として使ってください
- **デプロイするテンプレートそのものを読みます。** [20章](/ja/chapters/20-shipping.md)の経路では、CDK CLI が合成したテンプレートが CloudFormation に渡ります。検査は、その同じファイルに当てます。別に合成したテンプレートを読むと、コンテキストの値が違うかもしれません
- **通過を、デプロイの前の条件にします。** 20章のワークフローで、差分を見るステップの前に置きます。本番のスタックの名前を `--gate` に書きます
- **例外に日付を入れ、定期的に読み直します。** 理由は古くなります。「あとで直す」と書いた例外は、たいてい直されません
- **デプロイした後の状態も検査します。** テンプレートの検査が見えないものは、[手元で動かすページ](/ja/chapters/33-production-readiness/local.md)に並べました。ドリフト検出と、アカウントを読むタスクを、同じ頻度で動かします
- **点検を、公開の前の 1 回で終わらせません。** OPS07-BP02 は、公開前だけでなく、その後も続けて行うものとして書いています。構成が大きく変わったときと、障害のあとに読み直します
- **項目を自分のものにします。** `src/review.ts` の 32 項目は、この本のアプリのためのものです。決済を扱うなら決済の項目が、個人情報を扱うなら法令の項目が要ります。それらは、この本には書いてありません

## 片付け

<!-- section: 33.cleanup -->

AWS には何も作っていないので、消すものはありません。

手元に残るのは `examples/33-production-readiness/cdk.out` です。git の管理からは外れていて、`vp run ready:infra:synth` でいつでも作り直せます。消してかまいません。

`AihReadyProduction` を自分でデプロイした場合は、話が変わります。このスタックのテーブルとロググループは `Retain` で、テーブルには削除保護が付いています。スタックを消しても両方が残り、料金がかかり続けます。消すには、テーブルの削除保護を外してから、テーブルとロググループを手で消します。この手順は実行して確かめていません。試すなら、練習用のアカウントで、消し方を先に確かめてからにしてください。

## 分散システムとして見ると

この章が扱った状態の持ち主は 3 つあります。コードが合成するテンプレート、デプロイの道具が持つ記録、そして AWS にある実物です。[02章](/ja/chapters/02-toolchain.md)は、この 3 つを比べる検査を、差分とドリフトに分けました。この章の検査が読むのは 1 つ目だけです。

そのため、検査の結果には時刻があります。「通った」は、「この時刻に合成したテンプレートには、こう書いてあった」という意味です。そのあとで誰かがコンソールで保持期間を消しても、結果は変わりません。点検の項目も同じで、当番が退職すれば、先月の「はい」は今月の「いいえ」になります。

検査そのものの不変条件は、1 文で書けます。**通過を求めたスタックは、そのテンプレートが読まれ、指摘が 0 件で、例外がすべて使われているときにだけ通る。** これを壊そうとするテストを、3 つ入れてあります。通過を求めたスタックのテンプレートが見つからないとき。原因が直って、例外だけが残ったとき。テンプレートでないものを渡されたとき。どれも、検査は「通った」と答えません。

何も読まなかった検査が成功を返す、というのは、検査の失敗の中でいちばん気づきにくいものです。21章の lint も、22章の検査も、同じところに歯止めを置いていました。

::: details この章の検証メモ

**手元で確かめたこと。** テンプレートの読み取り（配列、`Resources` のないオブジェクト、`Type` のないリソースの拒否。`constructor` と `__proto__` という論理 ID を読み落とさないこと。`Ref`、`Fn::GetAtt` の 2 つの書き方、`Fn::Sub` の参照。リテラル、未記入、組み込み関数の区別）。10 個のルールそれぞれの、通る例と落ちる例（公開ブロックの欠け・`false`・文字列の `"true"`・組み込み関数、公開の ACL、全員に開いたポリシーと条件付きのポリシーと `Deny`、PITR とグローバルテーブルのレプリカ、12 種類のリソースの `DeletionPolicy` と `UpdateReplacePolicy`、RDS の既定のスナップショット、保持期間のないロググループとロググループを指定しない関数、関数・API・エイリアス・キュー・デッドレターキューを見るアラームと、スケジュールの先の関数、通知先のないアラームとテンプレートの外のトピック、スロットリング、関数 URL の認証、デッドレターキュー）。例外（理由の必須と長さ、リソースも文言もない例外の拒否、使われていない例外、21章の例外の取り込み）。判定（報告だけのスタック、通過を求めたスタック、読まれなかったテンプレート）。2 つのフィクスチャが同じ種類のリソースを持つこと。点検の 32 項目（ルールがどれも項目に置かれていること、タスクが `vite.config.ts` に実在すること）。2 つのスタックの合成と検査の結果、Aspect があとから足したテーブルに届くこと、Aspect がリソースを足さないこと。型検査、`ready:infra:synth`、`ready:gate`、`ready:review` の実行。`vp run ready:check` はタスクとして実行し、本のすべてのスタックを合成し直したうえで、73 個のテンプレートを読みました。加えて、コードを 11 か所わざと壊して、テストが落ちることを確かめました。そのうち 1 か所は最初は落ちず、バケットポリシーの配列を読み落とす誤りが見つかりました。

**まだ確かめていないこと。** AWS に対しては、何も実行していません。検査の指摘を、デプロイ済みのアカウントの設定と突き合わせたことはありません。`AihReadyProduction` はデプロイしておらず、Aspect が書いた PITR、削除保護、`Retain`、90 日の保持が実物でどう働くかは見ていません。`DeletionPolicy` と `UpdateReplacePolicy` の意味は CloudFormation のドキュメントで読んだもので、スタックの削除も、リソースを作り直す更新も実行していません。cdkd 0.296.28 がこの 2 つの属性を読むことは、同梱のコードの文字列で見ただけです。デプロイのページで挙げた 25章以降の章は、範囲の説明か概要のページだけをもとにしていて、本文の全体は読んでいません。25章以降のスタックにある `iam-wildcard` の 41 件と `function-url-auth` の 1 件には、この検査の例外としての理由を書いていません。デプロイのページに出てくるタスク（`account:whoami`、`sec:posture`、`sec:trail:iam`、`sec:secret:versions`、`sec:secret:rotate`、`obs:alarms`、`ship:cfn:diff`、`ship:cfn:drift`、`recovery:status`、`account:budget:create`）は、この章では実行していません。cdk-nag、CloudFormation Guard、AWS Config の管理ルールは、説明を読んだだけです。Config のルールがそれぞれ何を評価するかは読んでいません。PITR の保存量にテーブルの変更の記録がどう数えられるかは確かめていません。`nodejs24.x` のサポートの終了日は調べていません。Cloudflare が公開前の確認事項の一覧を公開しているかどうかは確認していません。AWS の複数アカウントのホワイトペーパーと ORR のガイドは、冒頭だけを読みました。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 全体像、項目の書き方 | `examples/33-production-readiness/src/review.ts`、`scripts/review.ts`、`test/review.test.ts` | `ready:review`、`test:unit` |
| テンプレートを読む | `examples/33-production-readiness/src/template.ts`、`test/template.test.ts` | `test:unit` |
| 10 個のルール | `examples/33-production-readiness/src/rules/rule.ts`、`src/rules/data.ts`、`src/rules/doors.ts`、`test/rules.test.ts` | `test:unit` |
| 関数を見ているアラーム | `examples/33-production-readiness/src/rules/watching.ts`、`test/rules.test.ts` | `test:unit` |
| 理由つきの例外 | `examples/33-production-readiness/src/check.ts`、`readiness/waivers.json`、`test/check.test.ts` | `test:unit` |
| 本番向けの設定を当てる | `examples/33-production-readiness/infra/bin/app.ts`、`infra/lib/production-settings.ts`、`infra/test/twins.test.ts` | `ready:infra:synth`、`test:unit` |
| 手元で動かす | `examples/33-production-readiness/scripts/check.ts`、`src/report.ts`、`test/fixtures/` | `ready:gate`、`test:unit` |
| 本のすべてのスタックに当てた結果 | `examples/33-production-readiness/scripts/check.ts` | `ready:check` |
| 分野ごとの点検 | `examples/33-production-readiness/src/review.ts` | `ready:review`、各章のタスク |
| 料金 | `data/pricing/` | `test:unit` |

**一次情報**（確認日は、断りのないものは 2026-10-12）

- AWS Well-Architected Framework: [The pillars of the framework](https://docs.aws.amazon.com/wellarchitected/latest/framework/the-pillars-of-the-framework.html)、[OPS06-BP01](https://docs.aws.amazon.com/wellarchitected/latest/framework/ops_mit_deploy_risks_plan_for_unsucessful_changes.html)、[OPS06-BP03](https://docs.aws.amazon.com/wellarchitected/latest/framework/ops_mit_deploy_risks_deploy_mgmt_sys.html)、[OPS07-BP02](https://docs.aws.amazon.com/wellarchitected/latest/framework/ops_ready_to_support_const_orr.html)、[OPS07-BP03](https://docs.aws.amazon.com/wellarchitected/latest/framework/ops_ready_to_support_use_runbooks.html)、[OPS10-BP02](https://docs.aws.amazon.com/wellarchitected/latest/framework/ops_event_response_process_per_alert.html)、[OPS11-BP02](https://docs.aws.amazon.com/wellarchitected/latest/framework/ops_evolve_ops_perform_rca_process.html)、[SEC01-BP01](https://docs.aws.amazon.com/wellarchitected/latest/framework/sec_securely_operate_multi_accounts.html)、[SEC03-BP02](https://docs.aws.amazon.com/wellarchitected/latest/framework/sec_permissions_least_privileges.html)、[REL01-BP01](https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_manage_service_limits_aware_quotas_and_constraints.html)、[REL09-BP04](https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_backing_up_data_periodic_recovery_testing_data.html)、[REL12-BP05](https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_testing_resiliency_game_days_resiliency.html)、[REL13-BP01](https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_planning_for_recovery_objective_defined_recovery.html)、[COST01-BP03](https://docs.aws.amazon.com/wellarchitected/latest/framework/cost_cloud_financial_management_budget_forecast.html)。それぞれ冒頭の説明、目指す状態、よくある失敗の例までを読みました
- [Operational Readiness Reviews (ORR)](https://docs.aws.amazon.com/wellarchitected/latest/operational-readiness-reviews/wa-operational-readiness-reviews.html)、[Organizing Your AWS Environment Using Multiple Accounts](https://docs.aws.amazon.com/whitepapers/latest/organizing-your-aws-environment/organizing-your-aws-environment.html)（どちらも冒頭のみ）
- CloudFormation: [DeletionPolicy attribute](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-attribute-deletionpolicy.html)、[UpdateReplacePolicy attribute](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-attribute-updatereplacepolicy.html)（2026-10-13）、[AWS::Logs::LogGroup](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-logs-loggroup.html)、[AWS::S3::Bucket PublicAccessBlockConfiguration](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-s3-bucket-publicaccessblockconfiguration.html)、[AWS::DynamoDB::Table](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-dynamodb-table.html)、[PointInTimeRecoverySpecification](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-dynamodb-table-pointintimerecoveryspecification.html)、[AWS::CloudWatch::Alarm](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-cloudwatch-alarm.html)（2026-10-13）
- [Configuring CloudWatch log groups](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-cloudwatchlogs-loggroups.html)（Lambda）、[Working with log groups and log streams](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/Working-with-log-groups-and-streams.html)（2026-10-13）、[Blocking public access to your Amazon S3 storage](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html)
- [List of AWS Config Managed Rules](https://docs.aws.amazon.com/config/latest/developerguide/managed-rules-by-aws-config.html)（ルールの名前のみ）、[cdk-nag の README](https://github.com/cdklabs/cdk-nag/blob/main/README.md)、[CloudFormation Guard の README](https://github.com/aws-cloudformation/cloudformation-guard/blob/main/README.md)（冒頭のみ）
- [aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0)（インストールしたパッケージの型定義: `IAspect`、`CfnResource.applyRemovalPolicy`、`CfnGlobalTable` のレプリカの設定、`BucketAccessControl`、`RetentionDays`）、[@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)（`cdkd synth --help` と、同梱の dist の文字列）
- AWS Price List bulk API: [DynamoDB](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonDynamoDB/current/ap-northeast-1/index.json)（公開日 2026-09-11 の版。27 品目）。ログの保存の単価と無料枠は、19章が登録したものを使いました
- [Vercel: Production checklist for launch](https://vercel.com/docs/production-checklist)、[Cloudflare Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)（保持の上限のみ）

:::
