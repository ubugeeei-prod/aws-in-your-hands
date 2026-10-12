---
title: "27 Search: 手元で動かす"
---

# 27 Search: 手元で動かす

[しくみと実装](/ja/chapters/27-search/build.md)で作った検索を、手元で起動します。AWS は呼びません。手元で確かめられることと、確かめられないことを分けてから、テストを見ます。

## 手元で動かす

<!-- section: 27.local -->

`examples/27-search/.env.example` を、同じディレクトリに `.env` という名前でコピーします。

<<< @/examples/27-search/.env.example

```bash
vp run dev:search
```

開発サーバーは <http://localhost:8827> で起動します。`SEARCH_BACKEND=local` のとき、ノートもベクトルもプロセスの中の `Map` に置き、`fixtures/notes.json` のノートを最初に入れます。所有者は `alice` と `bob` の 2 人で、どちらも「決済」について書いています。

<<< @/examples/27-search/src/local.ts{local}

手元にはストリームがありません。ノートを書いた直後に、索引の関数を直接呼んでいます。AWS では、この 2 つの間にストリームと Lambda が入り、遅れと再配送が起こります。

別のターミナルから検索します。

```bash
curl -s http://localhost:8827/search -H 'x-notes-owner: alice' -d '{"query":"決済のタイムアウト"}'
curl -s http://localhost:8827/search -H 'x-notes-owner: bob' -d '{"query":"決済のタイムアウト"}'
curl -s -i http://localhost:8827/search -d '{"query":"決済"}'
```

同じクエリでも、所有者によって返るノートが違います。3 つ目は所有者のヘッダーがないので、401 です。次は、この 3 つを実行したときの出力です（1 つ目と 2 つ目は読みやすく改行し、3 つ目は最初の行だけ）。

```text
{"hits":[
  {"noteId":"0000000a2","title":"障害の振り返り","snippet":"火曜の夜、決済のタイムアウトが増えた。原因は接続プールの上限で、再試行が重なって悪化した。上限を上げ、再試行に待ち時間を入れる。","score":0.03278688524590164,"matched":["meaning","words"]},
  {"noteId":"0000000a1","title":"リリース前の確認","snippet":"金曜のリリースまでに、決済の結合テストと負荷試験を終える。担当は佐藤さんと鈴木さん。水曜の朝会で進み具合を確認する。","score":0.016129032258064516,"matched":["words"]}
],"meaning":"used"}

{"hits":[
  {"noteId":"0000000b1","title":"決済の見積もり","snippet":"決済の手数料を見直す。来期の予算は未確定で、社外には出さない。","score":0.01639344262295082,"matched":["words"]}
],"meaning":"used"}

HTTP/1.1 401 Unauthorized
```

`score` は順位を合わせたときの値で、1 位どうしなら 1 ÷ 61 の 2 倍、約 0.0328 になります。大きさそのものに意味はなく、並べるためだけの数です。

ここで、手元の「意味の検索」が何をしているかを、はっきりさせておきます。

<<< @/examples/27-search/src/embedder.ts{hashing}

手元の埋め込みは、モデルではありません。語ごとに決まった位置へ 1 か -1 を足すだけの計算で、同じ語を共有する文章が近くなります。意味は何も知りません。1 つ目の結果で `meaning` が付いているのは、クエリとノートが同じ語を含んでいるからです。語を共有しないクエリを試すと、何も返りません。

```bash
curl -s http://localhost:8827/search -H 'x-notes-owner: alice' -d '{"query":"支払いのトラブル"}'
```

```text
{"hits":[],"meaning":"used"}
```

「支払いのトラブル」は、人が読めば「決済のタイムアウト」のノートに近い内容です。本物の埋め込みモデルなら、これを近いと判断することが期待されます。その確認は、Bedrock を呼ばなければできません。手元の検索で確かめられるのは、検索の配線、所有者の分離、順位の合わせ方、失敗時の扱いまでです。検索の質は確かめられません。

手元のインデックスにも、本物との違いがあります。

<<< @/examples/27-search/src/memory-vector-index.ts{memory}

手元のインデックスは、すべてのベクトルとクエリを比べるので、最も近いものを必ず返します。S3 Vectors は近似なので、近いものを見落とすことがあります。距離の計算は次のとおりです。

<<< @/examples/27-search/src/memory-vector-index.ts{cosine}

回答も試せます。

```bash
curl -sN http://localhost:8827/answers -H 'x-notes-owner: alice' -d '{"question":"リリースまでに何を終える?"}'
```

```text
event: sources
data: {"type":"sources","sources":[{"n":1,"noteId":"0000000a1","title":"リリース前の確認"}]}

event: delta
data: {"type":"delta","text":"金曜のリリースまでに、"}

event: delta
data: {"type":"delta","text":"決済の結合テストと負荷試験を終える予定です [1]。"}

event: delta
data: {"type":"delta","text":"進み具合は水曜の朝会で確認します [1][7]。"}

event: done
data: {"type":"done","stopReason":"end_turn","complete":true,"usage":{"inputTokens":640,"outputTokens":62},"citations":[1],"unknownCitations":[7]}
```

`sources` は、実際の検索の結果です。そのあとの文章は、17章と同じ仕組みで再生している固定のフィクスチャ（`fixtures/answer.json`）で、質問が何であっても同じ内容が流れます。フィクスチャは、存在しない出典 `[7]` をわざと引用していて、`done` の `unknownCitations` に 7 が入ります。モデルの答えの質は、手元では何もわかりません。

何も見つからない質問では、モデル（ここではフィクスチャ）を呼ばずに終わります。

```bash
curl -sN http://localhost:8827/answers -H 'x-notes-owner: alice' -d '{"question":"zzz qqq"}'
```

```text
event: sources
data: {"type":"sources","sources":[]}

event: done
data: {"type":"done","stopReason":"no_sources","complete":false,"usage":null,"citations":[],"unknownCitations":[]}
```

`SEARCH_BACKEND=aws` にすると、同じサーバーが、デプロイしたテーブルとインデックス、Bedrock をあなたの認証情報で呼びます。検索のたびに埋め込みが課金されます。開発サーバーが `127.0.0.1` だけで待ち受けるのは、所有者のヘッダーをそのまま信じるからです。

## テスト

<!-- section: 27.tests -->

```bash
vp run test:unit
```

テストは、起きると実害のあることを、決まった順序で再現します。

不変条件「検索は、他の所有者のノートを決して返さない」には、壊そうとするテストを 4 つ付けています（`test/search.test.ts`）。2 人が同じことについて書いている場合。インデックスが所有者の絞り込みを無視して、別の人の当たりを返す場合。インデックスの中に、他人のノートを「あなたのもの」と偽るエントリーがある場合。最後は、所有者、ノート、バージョン、パッセージをでたらめに組み合わせた当たりを返すインデックスに対して、決まった種の乱数で 200 回試します。どの場合も、返るのは呼び出し元のノートだけです。

テーブルとインデックスがずれた状態も再現します。ノートを消したのにベクトルが残っている場合、そのノートは返りません。ノートを書き換えたのに古いベクトルが残っている場合、新しい言葉では見つかり、古い意味では見つかりません。埋め込みのモデルが失敗した場合は、言葉だけで答えます。

索引の関数（`test/indexer.test.ts`）では、同じ変更を 2 回届けても結果が変わらないこと、短くなったノートの余ったパッセージが消えること、削除が 2 回届いても何も残らないことを確かめます。ストリームのハンドラーでは、バッチの途中で失敗したときに、後ろのレコードに手を付けずに失敗した番号を返すこと、やり直しで最初のレコードがもう一度届いても同じ結果に収束することを確かめます。

作り直し（`test/reconcile.test.ts`）では、作り直しが古いバージョンを読んだ直後にストリームが新しいバージョンを索引する、という順序を再現し、最後に新しいバージョンが残ることを確かめます。

回答（`test/answer.test.ts`）では、モデルに渡るプロンプトを記録して、他の所有者のノートの文章が入っていないことを確かめます。何も見つからなければモデルを呼ばないこと、渡していない番号の引用が `unknownCitations` に入ることも固定しています。

テストが確かめていないこともあります。ストリームのレコードの形は、ドキュメントと `@types/aws-lambda` の型に合わせて手で書いたもので、実際のストリームから採取したものではありません。S3 Vectors と Titan は一度も呼んでいません。S3 Vectors のアダプターのテスト（`test/s3-vectors-index.test.ts`）は、SDK に渡すリクエストの形と、返ってきた値の読み方を、代わりのクライアントで確かめているだけです。そのリクエストを本物のサービスが受け付けるかどうかは、確かめていません。Titan のアダプター（`src/bedrock-embedder.ts`）にはテストがなく、型検査を通っているだけです。確かめていないことの一覧は、[この章の検証メモ](/ja/chapters/27-search/wrap.md)にあります。
