---
title: "31 Progressive Delivery: デプロイ"
---

# 31 Progressive Delivery: デプロイ

ここからは AWS にデプロイして、切り替えとフラグを実物で動かします。このページの手順は、まだ実際の AWS で通せていません。書いてある「こうなるはず」は、コードとドキュメントから読み取った見込みで、実行した結果ではありません。

## デプロイする

<!-- section: 31.deploy -->

```bash
vp run rollout:infra:diff
vp run rollout:infra:deploy
```

<<< @/examples/31-progressive-delivery/infra/bin/app.ts{app}

作られるのは、HTTP API、関数、バージョン 1、エイリアス `live`、アラーム 2 つ、AppConfig のアプリケーションと環境と設定プロファイルとデプロイ戦略、ロール 2 つ、ロググループです。時間単位で課金されるものはありません。

cdkd については、固定している版（0.296.28）の中身を読んで、リソースの種類ごとの扱いを確かめました。API Gateway、関数、関数の権限、アラーム、ロール、ポリシー、ロググループには専用の実装があります。`AWS::Lambda::Alias`、`AWS::Lambda::Version` と、AppConfig の 4 種類には専用の実装が無く、Cloud Control API 経由になります。cdkd が「Cloud Control では作れない」として持っている一覧には、どれも入っていませんでした。実際に作れるかどうかは未確認です。

デプロイできたら、呼んでみます。

```bash
vp run rollout:probe
```

すべての答えがバージョン 1 から返り、`flags:` の行は `defaults` になるはずです。フラグはまだ一度も配っていないので、関数はコードの既定値で動いています。

フラグの最初の版を配ります。中身は、どちらも切です。

```bash
vp run flags:deploy --apply
vp run flags:status
```

`flags:status` が `COMPLETE` を表示した後は、`rollout:probe` の `flags:` の行が `live` に変わるはずです。配り終わるまでに 5 分、アラームを見る時間が 5 分あります。

これらのタスクを実行する人には、スタックをデプロイする権限とは別に、`lambda:GetAlias`、`lambda:UpdateAlias`、`lambda:PublishVersion`、`cloudwatch:DescribeAlarms`、そして AppConfig の版の保存とデプロイの開始と停止の権限が要ります。

## 段階的に切り替える

<!-- section: 31.shift-steps -->

最初に、わざと壊れたバージョンで、戻るところを見ます。半分のリクエストに 500 を返す設定でデプロイします。

```bash
vp run rollout:infra:deploy -c fault=50
vp run rollout:probe
```

デプロイが終わっても、`rollout:probe` の結果は変わらないはずです。壊れたコードは `$LATEST` にあり、エイリアスはバージョン 1 を指したままです。

切り替えを始めます。`--apply` を付けなければ、いまのエイリアスと、これからすることを表示するだけです。

```bash
vp run rollout:start
vp run rollout:start --apply
```

スクリプトは、いまの `$LATEST` をバージョン 2 として発行し、エイリアスに 10% の重みを足して、30 秒ごとにアラームを読みます。別の端末で、リクエストを送り続けます。

```bash
vp run rollout:probe --count 300
```

バージョン 2 に当たったリクエストのおよそ半分が 500 になり、API Gateway の `5xx` のアラームが `ALARM` になるはずです。スクリプトは、次に読んだときにそれを見つけて重みを消し、`rolled-back` と表示して、0 以外で終わります。アラームが鳴るまでにかかる時間は、測っていません。メトリクスが 1 分ごとに集計されるので、最初の 500 から 1〜2 分は、10% のリクエストが壊れたバージョンに届き続けると見ておいてください。

```bash
vp run rollout:status
```

エイリアスがバージョン 1 に 100% で戻っていることと、アラームの状態が表示されます。アラームが `OK` に戻るのを待ってから、直したコードをデプロイして、もう一度切り替えます。鳴っている間は、`rollout:start` が始めることを断ります。

```bash
vp run rollout:infra:deploy -c fault=0
vp run rollout:start --apply
```

今度はバージョン 3 が発行され、10% で 5 分、100% で 5 分を経て、`completed` で終わるはずです。その間も `rollout:probe` を動かし続けてください。リクエストが 1 件も来なければ、アラームは鳴りようがなく、切り替えは何も確かめないまま完了します。

計画を変えるには `--plan` を、bake time を変えるには `--bake` を付けます。

```bash
vp run rollout:start --plan Linear10PercentEvery1Minute --bake 120 --apply
```

切り替えが終わった後で戻したくなったら、戻す先のバージョンを指定します。

```bash
vp run rollout:rollback --to 1
vp run rollout:rollback --to 1 --apply
```

切り替えの途中でスクリプトを止めてしまった場合は、`--to` を付けずに `rollout:rollback --apply` を実行すれば、重みが消えて元のバージョンに戻ります。続きから進めるなら、同じバージョンを指定して `rollout:start --version 3 --apply` を実行します。

最後に、ドリフトを見ます。

```bash
vp run rollout:infra:drift
```

エイリアスは、テンプレートに書いたバージョン 1 ではなく、切り替えた先を指しています。この差が報告されるのは、この章の設計どおりです。報告のされ方は確かめていません。受け入れてよい差なので、このスタックでは `drift:revert` を実行しないでください。エイリアスがテンプレートの値に書き戻されれば、リクエストは最初のバージョンに一度に戻ります。

## フラグを出す

<!-- section: 31.flag-steps -->

コードが全員に届いたら、機能を出します。`flags/flags.json` の `values` を編集して、`noteStats` を 10% にします。

```json
"noteStats": { "enabled": true, "rolloutPercent": 10 }
```

```bash
vp run flags:check
vp run flags:deploy
vp run flags:deploy --apply
vp run flags:status
```

`flags:check` は、ファイルを検査して、アプリが受け取る形を表示します。`flags:deploy` は、`--apply` が無ければ同じ内容を表示するだけです。`--apply` を付けると、新しい版を保存して、配り始めます。

配り終わるまでの間、`x-client-id` を変えながら `/stats` を呼ぶと、およそ 10 人に 1 人が 200 になるはずです。ただし、配っている途中は、新しい設定をまだ受け取っていない実行環境に当たると、対象の ID でも 404 になります。拡張機能が AppConfig に確認するのは 45 秒ごとなので、配り終わった後も、行き渡るまでに最大でその時間がかかります。

割合を上げるときは、数字を変えて、同じ手順を繰り返します。フラグの変更もコードの変更と同じく、リポジトリのファイルの差分として残ります。

配っている途中で問題に気づいたら、止めます。

```bash
vp run flags:stop
vp run flags:stop --apply
```

配り終わった後なら、`readOnly` のような運用のスイッチも含めて、ファイルを直してもう一度 `flags:deploy` するのが基本です。`flags:stop` は、完了したデプロイを前の版に戻すこともできますが、リポジトリのファイルは新しい版のまま残るので、次の `flags:deploy` で同じ値がもう一度配られます。戻したら、ファイルも戻してください。

2 つのアラームは、フラグのデプロイも見ています。フラグを配っている間にコードの側の問題でアラームが鳴れば、フラグも前の版に戻ります。原因がどちらにあるかを、AppConfig は区別しません。コードの切り替えとフラグのデプロイは、同時に進めないほうが、後で何が起きたかを読みやすくなります。
