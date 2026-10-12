---
title: "55 Grafana: デプロイ"
---

# 55 Grafana: デプロイ

## ワークスペースを作って、ダッシュボードを届ける

<!-- section: 55.deploy -->

ここからの手順は、実際の AWS では 1 つも実行していません。ワークスペースを作ると、その月から最低でも 9 の料金がかかります（無料トライアルの期間を除く）。試したら、[最後のページ](/ja/chapters/55-grafana/wrap.md)の手順で消してください。

前提が 2 つあります。19章のスタックがデプロイされていることと、サインインの方法が用意できていることです。IAM Identity Center を使うなら、先にアカウントで有効にして、自分の利用者を作っておきます。

```bash
vp run obs:infra:deploy
vp run grafana:infra:diff -c authentication=AWS_SSO
vp run grafana:infra:deploy -c authentication=AWS_SSO
```

SAML の IdP を使うなら、`AWS_SSO` の代わりに `SAML` を渡します。その場合、IdP のメタデータの登録は、ワークスペースができてからコンソールで行います。

**`-c authentication=...` は、この先のどのコマンドにも付けます。** 付け忘れて `grafana:infra:deploy` を実行すると、テンプレートからワークスペースが消えるので、デプロイはワークスペースを、中のダッシュボードごと削除しようとします。先に `grafana:infra:diff` を見る習慣が、ここでは特に効きます。

ワークスペースの状態が `ACTIVE` になったら、利用者を割り当てます。割り当ては CloudFormation のリソースではないので、スタックには入っていません。Managed Grafana のコンソールでワークスペースを開き、Authentication のタブから自分を割り当てて、管理者にします。ドキュメントは、ワークスペースごとに少なくとも 1 人を管理者にするよう求めています。割り当てたら、スタックの出力 `WorkspaceEndpoint` の URL を開いて、サインインできることを確かめます。

次に、ダッシュボードを届けます。

```bash
vp run obs:smoke
vp run grafana:push
```

`obs:smoke` は 19章のタスクで、API にリクエストを数件送ります。線が 1 本も無いダッシュボードでは、正しく描けているのか分からないからです。

`grafana:push` は、次の順に動きます。

1. 19章のスタックの出力からダッシュボードの名前を取り、`aws cloudwatch get-dashboard` でボディを読む
2. ボディが `src/signals.ts` の定義と一致することを確かめ、API、関数、テーブルの名前を取り出す。一致しなければ、ここで止まる
3. `aih-dashboards` というサービスアカウントを探し、無ければ管理者の役割で作る
4. 15 分で切れるトークンを発行する
5. CloudWatch のデータソースを探し、無ければ作る
6. ダッシュボードを送る
7. トークンを消す

3 のサービスアカウントは、API を呼んだ月には利用者 1 人として課金されます。

サインインしたワークスペースで `Notes API` のダッシュボードを開き、CloudWatch のコンソールにある 19章のダッシュボードと見比べます。7 つのパネルに同じ線が出ていれば、この章の目的は果たせています。

ドリフトの検査は、これまでの章と同じです。

```bash
vp run grafana:infra:drift -c authentication=AWS_SSO
```

ここで比べられるのは、スタックにあるもの、つまりワークスペースの設定とロールだけです。ダッシュボードはスタックのリソースではないので、ワークスペースの画面で誰かが変えても、この検査には出ません。Grafana の側のずれは、次の `grafana:push` が上書きして直します。CloudWatch の側のずれは、`grafana:push` の 2 番目の手順が見つけます。

cdkd については、固定している版（0.296.28）のパッケージを調べました。`AWS::IAM::Role` と `AWS::IAM::Policy` には専用の実装があります。`AWS::Grafana::Workspace` には専用の実装が無く、Cloud Control API 経由になります。この種類は Cloud Control API の対応一覧にありますが、cdkd から実際に作れるか、`Endpoint` と `Id` の属性を出力として読めるかは未確認です。

### うまくいかないとき

| 症状 | 見るところ |
| --- | --- |
| ワークスペースの作成が失敗する | `AWS_SSO` を渡したのに、アカウントで IAM Identity Center が有効になっていない可能性があります。このときの失敗の出方は確かめていません |
| サインインの画面で先に進めない | Authentication のタブで、自分が割り当てられているか。割り当てはワークスペースごとです |
| ワークスペースの URL が 403 を返す | `prefixListIds` を渡した場合、自分のアドレスがプレフィックスリストに入っているか |
| `grafana:push` が「does not show what src/signals.ts describes」で止まる | 19章のダッシュボードが定義と違います。`vp run grafana:render --cloudwatch` の出力と、`aws cloudwatch get-dashboard` のボディを比べます |
| `could not create the data source: HTTP 403` | サービスアカウントの役割が管理者でない。別の役割で作られた `aih-dashboards` が残っていないか |
| パネルに権限のエラーが出る | ワークスペースのロールのアクションが足りません。`infra/lib/grafana-stack.ts` の `WORKSPACE_ACTIONS` に足して、テストを直します |
