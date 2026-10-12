---
title: "19 Observability: デプロイ"
---

# 19 Observability: デプロイ

## デプロイして確かめる

<!-- section: 19.deploy -->

ここからは AWS にデプロイして、アラーム、クエリ、トレースを実物で確かめます。ただし、この節の手順は、まだ実際の AWS で通せていません。

```bash
vp run obs:infra:diff
vp run obs:infra:deploy -c alarmEmail=you@example.com
```

メールアドレスは、テンプレートと cdkd の state に入ります。共有のアドレスを使うか、ここでは省略して、後から購読を足してください。確認メールが届いたら、リンクを押します。

次に、リクエストを送ります。

```bash
vp run obs:smoke
```

`obs:smoke` は、ノートを 1 件作り、古い版で更新して 409 を起こし、存在しないノートを読んで 404 を起こしてから、ノートを消します。レスポンスごとに `x-request-id` を表示するので、その値を次のクエリに渡します。

```bash
vp run obs:query --name request --id <x-request-id>
vp run obs:query --name errors --minutes 60
vp run obs:alarms
```

`obs:query` は、指定した時間の範囲にあるログをすべて読み、読んだ量に課金されるので、範囲は狭くします。`obs:alarms` は 2 つのアラームの状態を表示します。デプロイの直後は `INSUFFICIENT_DATA` と表示されますが、正常です。

レイヤーを足すなら、ADOT のドキュメントの表から ARN を取って渡します。

```bash
vp run obs:infra:deploy -c otelLayerArn=arn:aws:lambda:ap-northeast-1:615299751070:layer:AWSOpenTelemetryDistroJs:16
```

cdkd については、固定している版（0.296.28）のソースを読んで、リソースの種類ごとの扱いを確かめました。アラーム、SNS のトピックと購読、ロググループには専用の実装があります。ダッシュボードとメトリクスフィルターには専用の実装が無く、Cloud Control API 経由になります。どちらの種類も Cloud Control API の対応一覧にはありますが、cdkd から実際に作れるかは未確認です。

ドリフトの検査は、これまでの章と同じです。

```bash
vp run obs:infra:drift
```

## ブラウザの側と、外からの監視

<!-- section: 19.browser-and-probes -->

ここまでに作ったものは、すべてサーバーの側を見ています。そのため、まだ見えていないものが 2 つあります。

1 つは、利用者のブラウザで起きていることです。API が 50 ミリ秒で返していても、ページの表示には 5 秒かかっているかもしれません。JavaScript のエラーも、サーバーには届きません。CloudWatch RUM は、ページに小さなスクリプトを入れて、実際の利用者の表示時間やエラーを集める機能です。集めるセッションの割合を選べます。データは 30 日で消えます。

もう 1 つは、誰も来ていないときに壊れていないかどうかです。[最初のページ](/ja/chapters/19-observability.md)で見たとおり、リクエストが無ければアラームは鳴りません。CloudWatch Synthetics は、canary と呼ぶスクリプトを決まった間隔（最短で 1 分ごと）で動かして、外から API やページを呼びます。利用者がいない深夜に壊れても、気づけるようになります。

この章では、どちらも実装していません。理由は次の 3 つです。

- RUM には、ブラウザのアプリと、ブラウザから AWS にデータを送るための認可の設定が要ります。この章の題材は API だけです
- Synthetics の canary は、Lambda の関数、成果物を置く S3 のバケット、専用のランタイムの版を伴います。ランタイムの版は頻繁に入れ替わるので、確かめずに書くとすぐ古くなります
- どちらも、置いてあるだけで料金がかかり続けます。金額は[料金の節](/ja/chapters/19-observability/wrap.md)で計算します

足す順番の目安も書いておきます。利用者がいない時間帯のあるサービスなら、先に Synthetics を足します。アラームの「データが無い」と「壊れている」を区別できるようになるからです。SPA の体感の遅さが問題になってきたら、RUM を足します。どちらも、サーバー側のアラームとログが整ってからで遅くありません。

cdkd の固定した版には、`AWS::RUM::AppMonitor` にも `AWS::Synthetics::Canary` にも専用の実装がなく、どちらも Cloud Control API 経由になります。
