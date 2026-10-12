---
title: "62 CI Runner: デプロイ"
---

# 62 CI Runner: デプロイ

このページは、手元で確かめられることと、AWS と GitHub に対して行う手順を分けて書きます。後半の手順は、一度も実行していません。

## 手元で確かめる

<!-- section: 62.local -->

受信の処理は、AWS も GitHub も無しで動かせます。外とのやり取りがすべてインターフェースの向こうにあるからです。

```bash
vp run runners:decide
vp test run examples/62-ci-runners
vp run runners:infra:synth
```

`runners:decide` は、手で書いた配送を 7 件、本物の受信処理に通します。GitHub、ECS、DynamoDB は、スクリプトの中の代役です。次は、このコマンドの実際の出力です。

```text
signed with another secret                   401 {"error":"bad_signature"}
a job for ubuntu-latest                      200 {"outcome":"skipped","reason":"labels_not_ours"}
a repository not on the list                 200 {"outcome":"skipped","reason":"repository_not_allowed"}
a pull request from a fork                   200 {"outcome":"skipped","reason":"fork"}
a queued job, no capacity                    500 {"error":"launch_failed"}
the same delivery, sent again                200 {"outcome":"launched","taskArn":"task-for-aih-31000000001-1"}
the same delivery, a third time              200 {"outcome":"duplicate"}

tasks that would have been started: aih-31000000001-1
```

5 行目から 7 行目が、起動の失敗と再送の流れです。起動に失敗した配送は 500 になり、同じ配送を送り直すと起動し、さらに送り直しても 2 つ目は起動しません。

配送のペイロード（`fixtures/workflow-job-queued.json`）は、GitHub の OpenAPI の定義を見て手で書いたものです。GitHub から実際に届いた配送の記録ではありません。項目の名前と型は定義に合わせてありますが、実物との違いが無いことは確かめていません。

テストが確かめていることは、次のとおりです。

- 署名: GitHub のドキュメントの検算用の値と一致すること。別のシークレット、書き換えられたボディ、形の崩れたヘッダーを断ること
- 判定: ラベル、リポジトリの一覧、公開リポジトリ、フォーク、`pull_request_target` のそれぞれで、起動しないこと
- 受信: 偽の署名では、GitHub にも ECS にも何も求めないこと。同じ配送が続けて届いても、同時に届いても、タスクは 1 つであること。起動の失敗で登録と記録が片付き、再送でやり直せること。途中で止まった受信が残した記録が、期限のあとで取り直せること
- GitHub の API: JWT の署名と期限、トークンを 1 つのリポジトリと 2 つの権限に絞ること、送るリクエストの形
- スタック: タスクロールに権限が無いこと、受信の Lambda のロールに `*` が無いこと、入る通信が無いこと、秘密鍵がテンプレートに無いこと、リソースの種類の一覧

手元では再現できないものもあります。GitHub が実際に送ってくる配送、JIT の設定の中身と長さ、ランナーのイメージの起動、Fargate のタスクがジョブを受け取って終わるまでの流れ、DynamoDB の条件式の評価です。条件式は、メモリ上の同じ規則で代わりにテストしています。

## デプロイする

<!-- section: 62.deploy -->

ここからの手順は、実際には一度も通していません。GitHub の画面での操作は、ドキュメントの記述から組み立てたもので、画面を見て確かめてはいません。練習用の非公開リポジトリを 1 つ用意して、そこで試してください。公開リポジトリでは試さないでください。

先に 11章の VPC をデプロイしておきます（`vp run net:infra:deploy`）。この章のスタックは、VPC の ID とサブネットを、スタックの出力から読み込みます。

まず、リポジトリも App も指定せずにデプロイします。この状態のスタックは、すべての配送を断ります。

```bash
vp run runners:infra:diff
vp run runners:infra:deploy
```

出力の `WebhookUrl` が webhook の宛先、`WebhookSecretArn` と `AppPrivateKeySecretArn` が 2 つのシークレットです。webhook のシークレットは、デプロイのときに生成されています。値を読み出します。

```bash
aws secretsmanager get-secret-value --secret-id <WebhookSecretArn> \
  --query SecretString --output text --region ap-northeast-1
```

次に、GitHub App を作ります。設定する内容は、次のとおりです。

- Webhook の URL に `WebhookUrl` の値、シークレットに、いま読み出した値
- リポジトリの権限は、Administration を読み書き、Actions を読み取りだけ。ほかは付けない
- 購読するイベントは Workflow job だけ
- インストール先は、練習用のリポジトリ 1 つだけ

App の秘密鍵を生成すると、PEM のファイルがダウンロードされます。それを、もう 1 つのシークレットに入れます。入れたら、手元のファイルは消します。

```bash
aws secretsmanager put-secret-value --secret-id <AppPrivateKeySecretArn> \
  --secret-string file://<downloaded>.private-key.pem --region ap-northeast-1
```

App のクライアント ID とリポジトリの名前を渡して、デプロイし直します。

```bash
vp run runners:infra:deploy -c repositories=<owner>/<repo> -c appClientId=<client-id>
```

署名の無いリクエストが断られることを確かめます。401 と `{"error":"bad_signature"}` が返れば、function URL は届いていて、受信の処理が動いています。

```bash
curl -i -X POST <WebhookUrl>
```

最後に、`examples/62-ci-runners/workflows/ci.yml` を、練習用のリポジトリの `.github/workflows/` に置いて push します。ロールの ARN を入れるリポジトリの変数は、20章と同じものです。ジョブがキューに入ると、タスクが 1 つ起動するはずです。

```bash
aws ecs list-tasks --cluster <ClusterName> --region ap-northeast-1
aws logs tail <RunnerLogGroupName> --since 10m --region ap-northeast-1
```

ジョブが始まらないときは、順に見ます。GitHub App の設定画面にある配送の履歴で、応答の状態コードと本文を確かめます。200 で `skipped` なら、本文の `reason` が理由です。500 なら、受信の Lambda のログに `launch failed` と原因が出ています。タスクは起動したのにジョブが始まらないなら、ランナーのロググループを見ます。

ドリフトの確認は、ほかの章と同じです。

```bash
vp run runners:infra:drift
```

試し終わったら、[片付け](/ja/chapters/62-ci-runners/wrap.md)まで進めてください。App をインストールしたままにすると、配送が届き続けます。
