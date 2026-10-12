---
title: "19 Observability: 手元で動かす"
---

# 19 Observability: 手元で動かす

## 手元で見る

<!-- section: 19.local -->

[ここまでのページ](/ja/chapters/19-observability/more.md)で作ったログとトレースを、AWS を使わずに手元で動かして確かめます。`examples/19-observability/.env.example` を `.env` にコピーして、起動します。

<<< @/examples/19-observability/.env.example

```bash
vp run dev:obs
```

<<< @/examples/19-observability/src/dev.ts{dev}

手元では、スパンをコンソールに出すエクスポーターを使います。別のターミナルから、次の 3 つを順に呼んでみてください。

```bash
curl -s -X POST http://localhost:8787/notes -H 'content-type: application/json' -d '{"title":"first note"}'
curl -s http://localhost:8787/health -H 'traceparent: 00-4efaaf4d1e8720b39541901950019ee5-00f067aa0ba902b7-01'
curl -s http://localhost:8787/health -H 'traceparent: 00-4efaaf4d1e8720b39541901950019ee5-00f067aa0ba902b7-00'
```

1 つ目を呼ぶと、`notes.create` と `POST` の 2 つのスパンと、`traceId` の付いたログの行が出ます。スパンは終わったときに出力されるので、内側の `notes.create` が先に出ます。

2 つ目は、`traceparent` で trace ID を指定しています。ログの `traceId` が `4efaaf4d…` になり、スパンの親が `00f067aa0ba902b7` になります。

3 つ目は、`traceparent` の最後の 2 文字が `00` です。`00` は呼び出し元がこのトレースを記録していないことを表すので、スパンは出ません。ログの行だけが `"sampled":false` で残ります。

`.env` の `TRACE_SAMPLE_RATIO` を `0` にして起動し直すと、すべてのリクエストが 3 つ目と同じ結果になります。

テストは次のコマンドで動かします。

```bash
vp run test:unit
```

手元で再現しないものは次のとおりです。

- CloudWatch と X-Ray そのもの。アラームの状態遷移、Logs Insights の実行、メトリクスフィルター、X-Ray の画面は再現しません
- Lambda のサンプリング。手元のサンプラーは割合だけで決め、「毎秒最初の 1 件」はありません
- レイヤー。手元の SDK は、Lambda のレイヤーとは別の構成です
- Lambda が書くシステムのログ。JSON 形式での `platform.report` などの行です
