---
title: "31 Progressive Delivery: 手元で動かす"
---

# 31 Progressive Delivery: 手元で動かす

## 手元で動かす

<!-- section: 31.local -->

[ここまでのページ](/ja/chapters/31-progressive-delivery/more.md)で作ったもののうち、フラグとアプリは、AWS を使わずに手元で動かせます。`examples/31-progressive-delivery/.env.example` を `.env` にコピーして、起動します。

<<< @/examples/31-progressive-delivery/.env.example

```bash
vp run dev:rollout
```

手元には AppConfig の拡張機能が無いので、フラグは `FLAGS_FILE` が指すファイルから読みます。AppConfig に保存するのと同じ `flags/flags.json` です。

<<< @/examples/31-progressive-delivery/src/flags/reader.ts{file}

ファイルはリクエストのたびに読み直すので、サーバーを動かしたまま編集すれば、次のリクエストから反映されます。別の端末から呼びます。

```bash
curl -i http://localhost:8787/health
curl -i http://localhost:8787/stats
```

```text
HTTP/1.1 200 OK
x-app-version: local
x-flags-origin: live
```

1 つ目のレスポンスには、この 2 つのヘッダーが付きます。手元では Lambda のバージョンが無いので、`x-app-version` は `local` です。2 つ目は 404 です。`noteStats` が切ってあるので、`/stats` というルートは存在しない扱いになります。

`flags/flags.json` の `values` を書き換えて、`readOnly` を `true` に、`noteStats` を `{ "enabled": true, "rolloutPercent": 100 }` にすると、`/stats` は `{"notes":0}` のようにノートの件数を返し、`POST /notes` は 503 を返すようになります。サーバーの再起動は要りません。

次に、ファイルを壊します。中身を `{` だけにして保存し、もう一度 `POST /notes` を送ると、レスポンスは 503 のままで、`x-flags-origin` が `last-known` に変わります。サーバーのログには、次の 1 行が出ます。

```text
{"level":"warn","message":"flags","origin":"last-known","error":"The flag file is not JSON."}
```

壊れた設定は使われず、最後に読めた値で動き続けています。前のページの「AppConfig に届かないとき」と同じ道を、ファイルで通したことになります。確かめ終わったら、ファイルを元に戻してください。`vp run flags:check` が、元に戻ったかどうかを教えてくれます。

`rolloutPercent` を 10 にすると、`/stats` が見えるかどうかは `x-client-id` で決まります。

```bash
curl -i -H 'x-client-id: alice' http://localhost:8787/stats
```

同じ ID なら何度呼んでも同じ結果で、ID を変えると、およそ 10 人に 1 人が 200 になります。

### バージョンごとの件数を数える

`rollout:probe` は、`/health` を続けて呼び、どのバージョンが何件答えたかを数えます。AWS で切り替えの様子を見るためのものですが、`--url` を付ければ手元のサーバーにも使えます。

<<< @/examples/31-progressive-delivery/src/probe.ts{tally}

```bash
vp run rollout:probe --url http://localhost:8787 --count 40
```

`.env` の `FAULT_PERCENT` を 30 にして起動し直すと、およそ 3 割のリクエストが 500 になります。手元で実行したときの出力は次のとおりでした。500 の件数は、実行のたびに変わります。

```text
api: http://localhost:8787
version local: 40 of 40 (100.0%), 7 with 5xx
flags: live 40
```

### テスト

```bash
vp test run examples/31-progressive-delivery
```

テストは 12 ファイルあります。切り替えの計画、アラームからの判断、切り替えの実行は、エイリアスとアラームと時計を偽物に差し替えて、失敗を決まった順序で起こします。フラグは、定義ファイルの検査、割合での公開、届かないときのフォールバックを見ています。アプリのテストは、04章のアプリを内側に置いたまま、フラグごとのふるまいを確かめます。スタックのテストは、権限、エイリアスの置き方、アラーム、リソースの種類の一覧を固定します。

計画だけを見たいときは、名前を渡します。

```bash
vp run rollout:plan --plan Linear10PercentEvery1Minute --bake 120
```

### 手元では再現しないもの

手元で動くのは、判断と、アプリのふるまいです。次のものは、AWS にデプロイしないと確かめられません。

- 重み付きエイリアスが、実際にどう振り分けるか。テストの振り分けは、種を固定した乱数です
- AppConfig の拡張機能。手元の読み先はファイルで、キャッシュも、45 秒ごとの確認も、起動時の先読みもありません
- AppConfig が設定を実行環境に配っていく様子と、アラームによる自動のロールバック
- アラームが `ALARM` になるまでの時間。テストの時計は、アラームの状態を決めた時刻に変えているだけです
- cdkd が、このスタックのリソースを実際に作れるかどうか
