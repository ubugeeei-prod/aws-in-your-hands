---
title: "19 Observability: デプロイ"
---

# 19 Observability: デプロイ

## デプロイして確かめる

<!-- section: 19.deploy -->

ここからは AWS です。この節の手順は、まだ実機で通せていません。

```bash
vp run obs:infra:diff
vp run obs:infra:deploy -c alarmEmail=you@example.com
```

メールアドレスは template と cdkd の state に入ります。共有のアドレスにするか、省略して後から購読を足してください。確認メールが届いたら、リンクを押します。

リクエストを送ります。

```bash
vp run obs:smoke
```

ノートを 1 件作って、古い版で更新して 409 を起こし、存在しないノートを読んで 404 を起こし、消します。応答ごとに `x-request-id` を表示します。

```bash
vp run obs:query --name request --id <x-request-id>
vp run obs:query --name errors --minutes 60
vp run obs:alarms
```

`obs:query` は、指定した時間の範囲にあるログを全部読んで、読んだ量に課金されます。範囲は狭くします。`obs:alarms` は 2 つのアラームの状態を表示します。デプロイの直後は `INSUFFICIENT_DATA` で、これは正常です。

layer を足すなら、ADOT のドキュメントの表から ARN を取って渡します。

```bash
vp run obs:infra:deploy -c otelLayerArn=arn:aws:lambda:ap-northeast-1:615299751070:layer:AWSOpenTelemetryDistroJs:16
```

cdkd の話を 1 つ。固定している版（0.296.28）のソースを読むと、アラーム、SNS の topic と購読、log group には専用の実装があります。ダッシュボードと metric filter には無く、Cloud Control API 経由になります。どちらの種類も Cloud Control API の対応一覧にはありますが、cdkd から実際に作れるかは未確認です。

drift の検査は、これまでの章と同じです。

```bash
vp run obs:infra:drift
```

## ブラウザの側と、外からの監視

<!-- section: 19.browser-and-probes -->

ここまでは、全部サーバーの側の話でした。見えていないものが 2 つあります。

**利用者のブラウザで何が起きているか。** API が 50 ミリ秒で返していても、ページの表示に 5 秒かかっているかもしれません。JavaScript のエラーは、サーバーには届きません。**CloudWatch RUM** は、ページに小さなスクリプトを入れて、実際の利用者の表示時間やエラーを集める機能です。集める session の割合を選べます。データは 30 日で消えます。

**誰も来ていないときに壊れていないか。** さっき見たとおり、リクエストが無ければアラームは黙っています。**CloudWatch Synthetics** は、canary と呼ぶスクリプトを決まった間隔（最短で 1 分ごと）で動かして、外から API やページを呼びます。利用者がいない深夜でも、壊れていれば気づけます。

この章は、どちらも実装しませんでした。理由はこうです。

- RUM は、ブラウザのアプリと、ブラウザから AWS にデータを送るための認可の設定が要ります。この章の題材は API だけです
- Synthetics の canary は、Lambda の関数、成果物を置く S3 の bucket、専用の runtime の版を伴います。runtime の版は頻繁に入れ替わるので、確かめずに書くと、すぐ古くなります
- どちらも、置いてあるだけで料金が発生し続けます。次の節で計算します

足す順番の目安を書いておきます。利用者がいない時間帯があるサービスなら、先に Synthetics です。アラームの「データが無い」を「壊れている」と区別できるようになります。SPA の体感が問題になってきたら RUM です。どちらも、サーバー側のアラームとログが整ってからで遅くありません。

cdkd の固定した版には、`AWS::RUM::AppMonitor` にも `AWS::Synthetics::Canary` にも専用の実装がありません。Cloud Control API 経由になります。
