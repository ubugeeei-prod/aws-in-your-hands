---
title: "19 Observability: 手元で動かす"
---

# 19 Observability: 手元で動かす

## 手元で見る

<!-- section: 19.local -->

`examples/19-observability/.env.example` を `.env` にコピーして、起動します。

<<< @/examples/19-observability/.env.example

```bash
vp run dev:obs
```

<<< @/examples/19-observability/src/dev.ts{dev}

手元では、span をコンソールに出す exporter を使います。別のターミナルから呼んでみてください。

```bash
curl -s -X POST http://localhost:8787/notes -H 'content-type: application/json' -d '{"title":"first note"}'
curl -s http://localhost:8787/health -H 'traceparent: 00-4efaaf4d1e8720b39541901950019ee5-00f067aa0ba902b7-01'
curl -s http://localhost:8787/health -H 'traceparent: 00-4efaaf4d1e8720b39541901950019ee5-00f067aa0ba902b7-00'
```

1 つ目では、`notes.create` と `POST` の 2 つの span と、`traceId` の付いたログの行が出ます。span は終わったときに出るので、内側の `notes.create` が先です。

2 つ目は、`traceparent` で trace ID を指定しています。ログの `traceId` が `4efaaf4d…` になり、span の親が `00f067aa0ba902b7` になります。

3 つ目は、最後の 2 文字が `00` です。「呼び出し元は記録していない」という意味なので、span は出ません。ログの行だけが `"sampled":false` で残ります。

`.env` の `TRACE_SAMPLE_RATIO` を `0` にして起動し直すと、全部のリクエストがこの状態になります。

テストはこうです。

```bash
vp run test:unit
```

手元で再現しないものも書いておきます。

- **CloudWatch と X-Ray そのもの。** アラームの状態遷移、Logs Insights の実行、metric filter、X-Ray の画面
- **Lambda の sampling。** 手元の sampler は割合だけで、「毎秒最初の 1 件」はありません
- **layer。** 手元の SDK は、Lambda の layer とは別の構成です
- **Lambda が書くシステムのログ。** JSON 形式での `platform.report` などの行
