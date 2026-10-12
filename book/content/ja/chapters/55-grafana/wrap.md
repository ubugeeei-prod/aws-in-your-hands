---
title: "55 Grafana: 費用、注意点、片付け"
---

# 55 Grafana: 費用、注意点、片付け

## 料金

<!-- section: 55.cost -->

金額は USD、東京リージョン、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。19章のスタックそのものの料金は 19章で計算したので、ここでは Grafana を足したぶんだけを見ます。

既定のスタックにあるのは IAM ロールだけで、料金はかかりません。

ワークスペースを作ると、誰もサインインしない月でも **9.00** かかります。ワークスペースごとに最低 1 つの Editor ライセンスが要るためです。

使った月の例として、管理者 1 人と閲覧者 2 人がサインインし、`grafana:push` を 1 回以上実行した月を計算します。

| 項目 | 数量 | 金額 |
| --- | ---: | ---: |
| 管理者と編集者（1 人あたり 9） | 2 | 18.00 |
| 閲覧者（1 人あたり 5） | 2 | 10.00 |
| GetMetricData で要求したメトリクス（1,000 個あたり 0.01） | 220,800 | 2.21 |
| 合計 | | **30.21** |

1 行目の 2 人のうち 1 人は、サービスアカウントです。サービスアカウントは、API を呼んだ月には、その役割の利用者 1 人として数えられます。ダッシュボードを 1 回も反映しなかった月には数えられません。

3 行目は、Grafana ではなく CloudWatch の料金です。Grafana のパネルは、開くたび、再読み込みのたびに、CloudWatch の GetMetricData を呼びます。この API は、要求したメトリクスの数で課金されます。

<<< @/examples/55-grafana/src/cost-inputs.ts{inputs}

この章のダッシュボードは、1 回の再読み込みで 23 個のメトリクスを読みます。合計の線は 1 本でも、部品の 5 つはそれぞれ要求されるからです。表の 220,800 個は、ブラウザのタブ 1 つが、1 日 8 時間、月 20 日、1 分ごとに再読み込みを続けた場合の数です。壁のモニターに 24 時間映しておけば、およそ 4.5 倍になります。減らすには、再読み込みの間隔を延ばすか、見ていないタブを閉じます。テストは、ダッシュボードにパネルを足すとこの数量が変わることを見張っています。

確認できていないことが 4 つあります。月の途中で作って消したワークスペースが日割りになるかどうか。無料トライアルの期間に、最低 1 ライセンスがどう扱われるか。GetMetricData に毎月の無料枠があるかどうか。Grafana が、1 回の再読み込みで実際に何個ぶんの要求をするか。どれも、金額からは何も引いていません。

このほか、Enterprise のプラグインを有効にすると、利用者 1 人あたり月 45 が加わります。この章では使っていません。IAM Identity Center や外部の IdP の料金も、ここには入れていません。

## 本番にするなら

この章のスタックは、練習用に最小の形にしてあります。本番で使うなら、次の点を見直します。

- 届く範囲を絞る。既定ではどのアドレスからもサインインの画面に届きます。`prefixListIds` で会社のアドレスに限るか、VPC のエンドポイントからだけにします
- 役割を IdP のグループで決める。人を 1 人ずつ割り当てると、異動のたびに直すことになります。Identity Center ならグループを割り当て、SAML ならアサーションの属性で役割を決めます
- 管理者を 2 人以上にする。1 人しかいない管理者がサインインできなくなると、ワークスペースの中の設定を画面から直せる人がいなくなります
- 閲覧者を基本にする。編集者は 9、閲覧者は 5 で、ダッシュボードの正本はリポジトリにあるので、画面から編集する人はほとんど要りません
- 反映を CI に移す。[20章](/ja/chapters/20-shipping.md)のパイプラインから `grafana:push` を実行し、トークンを発行する権限を、そのロールにだけ持たせます
- 暗号化の鍵を決める。ワークスペースの中身は、既定では AWS が持つ鍵で暗号化されます。自分の鍵を使うこともできます（[21章](/ja/chapters/21-security.md)）。この章では試していません

## 片付け

<!-- section: 55.cleanup -->

```bash
vp run grafana:infra:destroy -c authentication=AWS_SSO
```

ワークスペースとロールが消えます。ワークスペースを消すと、中のダッシュボード、データソースの設定、アラート、スナップショットも一緒に消えます。ダッシュボードは定義から作り直せるので、失うものはありません。画面で作ったものがあれば、それは戻りません。

スタックと一緒に消えないものがあります。IAM Identity Center と Organizations は、この章のために有効にしたものでも、有効なまま残ります。Identity Center に作った利用者も残ります。消した月の料金が日割りになるかどうかは、確認できていません。

19章のスタックは、この章のスタックとは別です。19章のダッシュボードとアラームは、ワークスペースを消しても何も変わらず動き続けます。

## 分散システムとして見ると

- 状態の持ち主: 何を見るかを決めているのは、リポジトリの `src/signals.ts` です。CloudWatch のダッシュボードも、Grafana のダッシュボードも、その写しです。数字そのものの持ち主は CloudWatch で、Grafana は持っていません
- 不変条件（invariant）: 2 つのダッシュボードは、同じメトリクスを、同じ統計と同じ周期で読む
- 不変条件を壊そうとするテスト: 19章のテンプレートと定義を丸ごと比べるテストが、19章の側の変更を捕まえます。統計を変えた、線を足した、別のテーブルが混ざったボディを作り、反映の前の検査が断ることを確かめています
- 部分的な失敗: `grafana:push` は途中で止まっても、もう一度実行すれば同じ結果になります。データソースは名前で探してから作り、ダッシュボードは同じ `uid` を置き換えるからです。トークンの削除に失敗した場合、トークンは 15 分で使えなくなりますが、消すまで上限の 100 個に数えられます
- 同時の更新: 2 人が同時に反映すると、後から届いたほうが残ります。新しいコミットのほうが残るとは限りません。反映を CI の 1 か所にまとめれば、順序は main の順になります
- 遅れ: Grafana に出る線は、CloudWatch に届いたメトリクスです。19章で見たとおり、メトリクスは数秒から数分遅れて届きます。Grafana を足しても、気づくまでの時間は縮みません

::: details この章の検証メモ

**手元で確かめたこと。** 定義、CloudWatch のボディの組み立てと照合、Grafana のダッシュボードの生成とスキーマ、HTTP API の呼び出し（偽の `fetch`）、料金計算の入力、スタックのユニットテスト。型検査。synth（既定と、`-c authentication=AWS_SSO` を付けた場合）。`grafana:render` の出力（`--cloudwatch` を付けた場合も）。AWS CLI 2.35.11 のヘルプで、`scripts/push.ts` が使う `aws grafana` と `aws cloudwatch get-dashboard` の引数の名前。料金は AWS Price List の bulk API から取りました。

**まだ確かめていないこと。** `grafana:infra:deploy`、`grafana:push`、`grafana:infra:drift`、`grafana:infra:destroy` は、実際の AWS では動かしていません。Amazon Managed Grafana のワークスペースを 1 つも作っていないので、次の点はドキュメントと Grafana のソースから読み取っただけです。

- cdkd 0.296.28 が `AWS::Grafana::Workspace` を Cloud Control API 経由で作れること、`Endpoint` と `Id` を出力に読めること。`Endpoint` がスキームを含むかどうか（コードは両方の形を受け付けます）
- IAM Identity Center が無効なアカウントで `AWS_SSO` を渡したときの失敗の出方。`SAML` を渡して SAML の設定を後回しにする作成が、CloudFormation のリソースでも通ること
- 生成した JSON を、本物の Grafana が受け取って描くこと。`schemaVersion` 41 の JSON をバージョン 13 のワークスペースが読むこと、隠したクエリの合計が 1 本の線になること、`authType: "default"` がワークスペースのロールを使うこと
- ワークスペースのロールの 2 つのアクションだけで、パネルが描けること
- `aws cloudwatch get-dashboard` が返すボディが、CDK が書いたボディと JSON として等しいこと。`grafana:push` の一致の検査は、等しいことを前提にしています
- サービスアカウントの一覧、作成、トークンの発行と削除の応答の形。ドキュメントの応答の構文に合わせて読んでいます
- `-c grafanaVersion=...` に渡すバージョンの文字列の形
- Grafana のアラートのルールは作っていません。アラートの節は、ドキュメントの記述だけに基づいています
- 料金のうち、日割り、無料トライアル中の最低ライセンス、GetMetricData の無料枠、1 回の再読み込みで要求されるメトリクスの数

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 全体像 | `examples/55-grafana/infra/lib/grafana-stack.ts` | |
| 定義を 1 つにする | `examples/55-grafana/src/signals.ts`、`src/cloudwatch.ts`、`test/signals.test.ts`、`test/harness.ts` | `test:unit` |
| Grafana のダッシュボードを生成する | `examples/55-grafana/src/grafana.ts`、`src/schema.ts`、`test/grafana.test.ts` | `test:unit`、`grafana:render` |
| ワークスペースとロール | `examples/55-grafana/infra/lib/grafana-stack.ts`、`infra/bin/app.ts`、`infra/test/grafana-stack.test.ts` | `test:unit`、`grafana:infra:synth` |
| ダッシュボードを届ける | `examples/55-grafana/src/provision.ts`、`test/provision.test.ts`、`scripts/push.ts` | `test:unit` |
| 手元で確かめる | `examples/55-grafana/scripts/render.ts`、`test/` | `test:unit`、`grafana:render`、`grafana:infra:synth` |
| デプロイ | `examples/55-grafana/infra/bin/app.ts`、`scripts/push.ts` | `grafana:infra:diff`、`grafana:infra:deploy`、`grafana:push`、`grafana:infra:drift` |
| 料金 | `examples/55-grafana/src/cost-inputs.ts`、`test/cost-inputs.test.ts`、`data/pricing/` | `test:unit` |
| 片付け | `tools/src/infra/` | `grafana:infra:destroy` |

**cdkd（0.296.28）での扱い。** インストールしたパッケージの `dist` を調べました。専用の実装があるもの: `AWS::IAM::Role`、`AWS::IAM::Policy`。専用の実装が無く Cloud Control API 経由になるもの: `AWS::Grafana::Workspace`。

**一次情報**（確認日はすべて 2026-10-13）

- Amazon Managed Grafana のユーザーガイド: [What is Amazon Managed Grafana?](https://docs.aws.amazon.com/grafana/latest/userguide/what-is-Amazon-Managed-Service-Grafana.html)、[Authenticate users](https://docs.aws.amazon.com/grafana/latest/userguide/authentication-in-AMG.html)、[Use AWS IAM Identity Center](https://docs.aws.amazon.com/grafana/latest/userguide/authentication-in-AMG-SSO.html)、[Create a workspace](https://docs.aws.amazon.com/grafana/latest/userguide/AMG-create-workspace.html)、[Manage user and group access](https://docs.aws.amazon.com/grafana/latest/userguide/AMG-manage-users-and-groups-AMG.html)、[User roles](https://docs.aws.amazon.com/grafana/latest/userguide/Grafana-user-roles.html)
- 権限とネットワーク: [Permissions and policies for AWS data sources](https://docs.aws.amazon.com/grafana/latest/userguide/AMG-manage-permissions.html)、[Cross-service confused deputy prevention](https://docs.aws.amazon.com/grafana/latest/userguide/cross-service-confused-deputy-prevention.html)、[AWS managed policies](https://docs.aws.amazon.com/grafana/latest/userguide/security-iam-awsmanpol.html)、[Configure network access](https://docs.aws.amazon.com/grafana/latest/userguide/AMG-configure-nac.html)、[Security best practices](https://docs.aws.amazon.com/grafana/latest/userguide/AMG-Security-Best-Practices.html)、[Service Authorization Reference の CloudWatch の定義](https://servicereference.us-east-1.amazonaws.com/v1/cloudwatch/cloudwatch.json)
- ワークスペースの設定: [Configure a workspace](https://docs.aws.amazon.com/grafana/latest/userguide/AMG-configure-workspace.html)、[Extend your workspace with plugins](https://docs.aws.amazon.com/grafana/latest/userguide/grafana-plugins.html)、[Update your workspace version](https://docs.aws.amazon.com/grafana/latest/userguide/AMG-workspace-version-update.html)、[Differences between Grafana versions](https://docs.aws.amazon.com/grafana/latest/userguide/version-differences.html)、[Service quotas](https://docs.aws.amazon.com/grafana/latest/userguide/AMG_quotas.html)、[Delete a workspace](https://docs.aws.amazon.com/grafana/latest/userguide/AMG-edit-delete-workspace.html)
- データソース: [Built-in data sources](https://docs.aws.amazon.com/grafana/latest/userguide/AMG-data-sources-builtin.html)、[Manually add CloudWatch](https://docs.aws.amazon.com/grafana/latest/userguide/adding--CloudWatch-manual.html)、[Using the metric search option](https://docs.aws.amazon.com/grafana/latest/userguide/CloudWatch-using-the-metric-search.html)、[Pricing（CloudWatch のデータソース）](https://docs.aws.amazon.com/grafana/latest/userguide/cloudwatch-pricing.html)、[AWS X-Ray](https://docs.aws.amazon.com/grafana/latest/userguide/x-ray-data-source.html)、[Using Athena data source](https://docs.aws.amazon.com/grafana/latest/userguide/Athena-using-the-data-source.html)、[Amazon Managed Service for Prometheus のデータソース](https://docs.aws.amazon.com/grafana/latest/userguide/amazon-prometheus-data-source.html)、[What is Amazon Managed Service for Prometheus?](https://docs.aws.amazon.com/prometheus/latest/userguide/what-is-Amazon-Managed-Service-Prometheus.html)
- コードから入れる: [Authenticate with service accounts](https://docs.aws.amazon.com/grafana/latest/userguide/v13-authenticating-grafana-apis.html)、[Dashboard API](https://docs.aws.amazon.com/grafana/latest/userguide/v13-Grafana-API-Dashboard.html)、[Data Source API](https://docs.aws.amazon.com/grafana/latest/userguide/v13-Grafana-API-Datasource.html)、[Dashboard JSON model](https://docs.aws.amazon.com/grafana/latest/userguide/v13-dash-dashboard-json-model.html)、[Provisioned dashboards and the version 2 schema](https://docs.aws.amazon.com/grafana/latest/userguide/v13-dash-dynamic-provisioned.html)、[CreateWorkspaceServiceAccount](https://docs.aws.amazon.com/grafana/latest/APIReference/API_CreateWorkspaceServiceAccount.html)、[CreateWorkspaceServiceAccountToken](https://docs.aws.amazon.com/grafana/latest/APIReference/API_CreateWorkspaceServiceAccountToken.html)
- アラート: [Provisioning Grafana Alerting resources](https://docs.aws.amazon.com/grafana/latest/userguide/v13-alerting-setup-provision.html)、[Alert rule evaluation](https://docs.aws.amazon.com/grafana/latest/userguide/v13-alerting-rules-evaluation.html)、[State and health of alert rules](https://docs.aws.amazon.com/grafana/latest/userguide/v13-alerting-explore-state.html)、Grafana Labs の [Alerting provisioning HTTP API](https://grafana.com/docs/grafana/latest/developers/http_api/alerting_provisioning/)
- CloudFormation: [AWS::Grafana::Workspace](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-grafana-workspace.html)、[NetworkAccessControl](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-grafana-workspace-networkaccesscontrol.html)、[Cloud Control API の対応リソース](https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/supported-resources.html)
- Grafana のソース（v13.0.9 のタグ）: [CloudWatch のクエリの型](https://github.com/grafana/grafana/blob/v13.0.9/public/app/plugins/datasource/cloudwatch/dataquery.gen.ts)、[ダッシュボードの定義](https://github.com/grafana/grafana/blob/v13.0.9/kinds/dashboard/dashboard_kind.cue)。Grafana Labs の [Configure the Amazon CloudWatch data source](https://grafana.com/docs/grafana/latest/datasources/aws-cloudwatch/configure/)
- 料金: [Amazon Managed Grafana Pricing](https://aws.amazon.com/grafana/pricing/)、AWS Price List の [AmazonGrafana](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonGrafana/current/ap-northeast-1/index.json)（公開日 2026-09-11）と [AmazonCloudWatch](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/ap-northeast-1/index.json)（公開日 2026-10-07）

:::
