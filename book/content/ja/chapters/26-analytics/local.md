---
title: "26 Analytics: 手元で動かす"
---

# 26 Analytics: 手元で動かす

## 手元で動かす

<!-- section: 26.local -->

[前のページ](/ja/chapters/26-analytics/build.md)で作った記録とクエリを、AWS を使わずに動かします。Firehose のかわりに、記録をためてファイルに書く小さな模型が動きます。`examples/26-analytics/.env.example` を `.env` にコピーして、起動します。

<<< @/examples/26-analytics/.env.example

```bash
vp run dev:analytics
```

<<< @/examples/26-analytics/src/dev.ts{dev}

別のターミナルから、ノートを作り、読み、更新し、古い版でもう一度更新します。`<id>` は、1 つ目のレスポンスの `id` に置き換えてください。

```bash
curl -s -X POST http://localhost:8787/notes -H 'content-type: application/json' -d '{"title":"first"}'
curl -s http://localhost:8787/notes/<id>
curl -s -X PUT http://localhost:8787/notes/<id> -H 'content-type: application/json' -d '{"title":"second","body":"","expectedVersion":1}'
curl -s -X PUT http://localhost:8787/notes/<id> -H 'content-type: application/json' -d '{"title":"stale","body":"","expectedVersion":1}'
curl -s http://localhost:8787/notes/missing
```

5 秒以内に、サーバーの側に次の 1 行が出ます。5 件のリクエストが 1 つのオブジェクトになりました。

```text
delivered dist/lake/requests_json/dt=2026-10-12/local-1-2026-10-12-15-17-46-000001.gz
```

この出力は、日本時間の 10 月 13 日 0 時 17 分に実行したときのものです。フォルダーの日付は UTC なので、12 日になっています。中身は `gunzip -c` で読めます。

```text
{"v":1,"event_id":"50da36f1-7021-42ff-bb0a-e2d28b8f4aa8","at":"2026-10-12T15:17:46.387Z","request_id":"c0ba7db2-5b4b-4639-a3ed-9ae7f47ae29f","method":"POST","route":"/notes","status":201,"duration_ms":4,"action":"note_created","note_id":"0mv5ebytt3c35dc1b1b"}
{"v":1,"event_id":"97fd1cf7-8b0f-401a-8e1d-34c91c570038","at":"2026-10-12T15:17:46.445Z","request_id":"b22b237c-101a-4af0-a03e-64ec7bb5f625","method":"GET","route":"/notes/:id","status":200,"duration_ms":0,"action":null,"note_id":null}
{"v":1,"event_id":"9dc80629-6760-4c55-92e8-11d244c2a932","at":"2026-10-12T15:17:46.461Z","request_id":"f93ae5f8-5db7-4c14-987a-de234de96d04","method":"PUT","route":"/notes/:id","status":200,"duration_ms":0,"action":"note_updated","note_id":"0mv5ebytt3c35dc1b1b"}
{"v":1,"event_id":"b5f40791-c065-4123-ba0c-72de43728158","at":"2026-10-12T15:17:46.478Z","request_id":"cc907fbd-9248-4f26-9920-a1e6cdc3fbb6","method":"PUT","route":"/notes/:id","status":409,"duration_ms":1,"action":"update_conflicted","note_id":"0mv5ebytt3c35dc1b1b"}
{"v":1,"event_id":"eec811cc-1b9a-4e48-82fb-a2092d7196bc","at":"2026-10-12T15:17:46.493Z","request_id":"d162f88a-a7b0-49f1-8830-c18483e4950d","method":"GET","route":"/notes/:id","status":404,"duration_ms":0,"action":null,"note_id":null}
```

タイトルの `first` はどこにもありません。読み取りと 404 の行では、`action` と `note_id` が `null` です。

このファイルに対して、クエリを評価します。日付を省くと、UTC の今日になります。

```bash
vp run analytics:query:local --name actions
```

```text
from dist/lake, by this chapter's model of the query (no SQL was run):
┌─────────┬──────────────┬─────────────────────┬────────┐
│ (index) │ day          │ action              │ events │
├─────────┼──────────────┼─────────────────────┼────────┤
│ 0       │ '2026-10-12' │ 'note_created'      │ 1      │
│ 1       │ '2026-10-12' │ 'note_updated'      │ 1      │
│ 2       │ '2026-10-12' │ 'update_conflicted' │ 1      │
└─────────┴──────────────┴─────────────────────┴────────┘
read 1 objects, 494 bytes, in partitions: 2026-10-12
```

表の前には、Athena に送る SQL も表示されます。表を作ったのは SQL ではなく、同じ構造を評価するこの章の関数です。`--name` には `routes`、`errors`、`status` も指定できます。

最後の行は、読んだオブジェクトの数とバイト数です。`--from` と `--to` で別の日を指定すると、読むフォルダーが変わり、0 個になることを確かめられます。

### 手元で再現しないもの

- Firehose そのもの。模型は、ためて 1 つのファイルにすることと、フォルダーの日付の決め方だけを写しています。5 KB 単位の課金、大きさによる区切り、失敗したときの再試行は再現しません
- Athena の SQL のエンジン。関数の細かな動き、型の変換、partition projection は、手元では動きません
- Parquet への変換。`vp run analytics:sizes` が書く Parquet は、手元のライブラリによるものです

テストは次のコマンドで動かします。

```bash
vp run test:unit
```
