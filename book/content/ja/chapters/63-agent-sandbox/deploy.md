---
title: "63 Agent Sandbox: デプロイ"
---

# 63 Agent Sandbox: デプロイ

## デプロイする

<!-- section: 63.deploy -->

このページの手順は、実際の AWS では一度も通していません。エージェントも一度も起動していません。コマンドと順序は、前提の章の手順と、固定した版の cdkd から組み立てたものです。

**デプロイ先は、本番ではないアカウントにしてください。** この章の不変条件は、タスクロールに付けたポリシーについて確かめたものです。同じアカウントにあるリソースの側のポリシーは見ていません。本番のデータが 1 つも無いアカウントに置けば、見ていないものを心配せずに済みます。アカウントを分ける方法は [33章](/ja/chapters/33-production-readiness.md)にあります。

GitHub の側の準備が先です。次の 3 つは、この本のタスクにはなっていません。GitHub の画面で設定します。

- GitHub App を作り、リポジトリの権限として Contents と Pull requests の読み書きだけを付け、エージェントに触らせるリポジトリにだけインストールします
- そのリポジトリのルールセットで、既定のブランチに、プルリクエストの必須化、承認の数 1 以上、強制プッシュの禁止を設定します
- App の秘密鍵を作り、クライアント ID とインストールの ID を控えます

秘密鍵は、Secrets Manager に置きます。名前はスタックの既定値に合わせます。値は、`clientId`、`installationId`、`owner`、`privateKey` の 4 つを持つ JSON です。シークレットは、置いてある間、1 か月に USD 0.40 かかります。

```bash
aws secretsmanager create-secret --region ap-northeast-1 --name aih/agent-sandbox/github-app --secret-string file://github-app.json
```

`github-app.json` は、作り終えたら消してください。

11章の VPC を、外へ出る経路つきでデプロイします。**ここから時間課金です**（NAT Gateway で 1 か月 USD 48.91）。この構成では、出口を外側で絞るものはありません。[出口の許可リスト](/ja/chapters/63-agent-sandbox/more.md)を読んでから進めてください。

```bash
vp run net:infra:deploy -c egress=nat
```

この章のスタックを、タグなしでデプロイします。リポジトリだけができます。

```bash
vp run sandbox:infra:deploy
```

イメージを作ってプッシュします。Docker のデーモンが必要なのは、この手順です。

```bash
vp run sandbox:bundle
vp run sandbox:image:build a1
vp run sandbox:image:push a1
```

タグと、許可するリポジトリを付けてデプロイします。

```bash
vp run sandbox:infra:diff -c imageTag=a1 -c repositories=<owner>/<name>
vp run sandbox:infra:deploy -c imageTag=a1 -c repositories=<owner>/<name>
```

Bedrock のモデルは、初めて使う前に、アカウントで使用目的のフォームを出しておく必要があります（[17章](/ja/chapters/17-ai.md)）。

タスクを 1 つ起動します。**ここからモデルの料金がかかります。**

```bash
vp run sandbox:launch <owner>/<name> "README の誤字を直してください" --minutes 10 --budget 0.5
```

応答に、タスクの ARN、作業用のブランチ、期限が入っていれば起動しています。`refused` が返ったら、理由が一緒に書かれています。タスクの出力は、次のコマンドで追えます。

```bash
vp run sandbox:logs
```

最初に確かめるのは、Claude Code が始まったかどうかです。`system` の `init` の行が出ていれば始まっています。出る前にタスクが終わっていたら、サンドボックスが起動できなかった可能性があります。そのときに出力されるメッセージは確かめていないので、ログの最初の数行をそのまま読んでください。最後の行は、この章のプログラムが書く `{"event":"job",...}` です。`status` が `pull_request` なら、URL が入っています。

期限が効くことも確かめておきます。終わらない仕事を 5 分の期限で頼むと、期限の 2 分前、つまり 3 分後に、タスクの中のプログラムがエージェントを止めます。ログの最後の行の `status` は `deadline` になり、何もプッシュされません。

```bash
vp run sandbox:launch <owner>/<name> "1 時間かけて、すべてのファイルを 1 つずつ説明してください" --minutes 5
```

これで確かめられるのは、内側の上限です。リーパーが働くのは、内側の上限が効かなかったときだけなので、この手順では動きません。リーパーが実際のタスクを止めるところを見る手順は、用意していません。リーパーが止めたタスクには、`stoppedReason` に `agent sandbox: deadline` のような理由が入ります。止まったタスクの理由は、次のコマンドで見られます。

```bash
aws ecs list-tasks --cluster <ClusterName> --region ap-northeast-1 --desired-status STOPPED
aws ecs describe-tasks --cluster <ClusterName> --tasks <task id> --region ap-northeast-1 --query "tasks[].stoppedReason"
```

モデルの呼び出しが CloudTrail に残っていることは、次のコマンドで見られます。

```bash
aws cloudtrail lookup-events --region ap-northeast-1 --lookup-attributes AttributeKey=EventName,AttributeValue=InvokeModelWithResponseStream --max-items 5
```

テンプレートと実物の差は、ほかの章と同じタスクで調べます。

```bash
vp run sandbox:infra:drift
```

終わったら、[片付け](/ja/chapters/63-agent-sandbox/wrap.md)まで進めてください。NAT Gateway は、タスクが 1 つも動いていなくても課金されます。
