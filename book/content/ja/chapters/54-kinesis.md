---
title: "54 Kinesis: Data Streams、shard、順序、読み直し"
revision: 1
---

# 54 Kinesis: Data Streams、shard、順序、読み直し

Kinesis Data Streams の stream は、キューではなく記録です。書かれたレコードは読まれても消えず、決めた期間だけ残ります。読む側はそれぞれ自分の位置を持つので、同じレコードを何人でも読めますし、位置を戻せば読み直せます。順序は、shard と呼ぶ列の中で保たれます。

[08章](/ja/chapters/08-async.md)のキューは、仕事を 1 つずつ誰かに渡し、済んだら消す部品でした。この章では、ノートの変更（リビジョン）を stream に書き、Lambda の関数がそれを順に読んで、ノートごとの履歴を作ります。守りたいことは 1 つで、ノートごとに、リビジョンが順番どおりに、1 回ずつ効くことです。stream が約束するのは「少なくとも 1 回届ける」までなので、残りは書く側と読む側のコードで埋めます。

料金を先に書きます。**この章のスタックは、置いてあるだけで 1 か月におよそ 14.49 ドルかかります。** ほとんどが stream の料金で、shard 1 つにつき 1 時間 0.0195 ドルが、1 件も書かなくてもかかります。Kinesis Data Streams に無料枠はありません。試し終えたら `vp run kinesis:infra:destroy` で消してください。内訳と仮定は[費用のページ](/ja/chapters/54-kinesis/wrap.md)にあります。

前提は 08章と[05章](/ja/chapters/05-dynamodb.md)です。コードは `examples/54-kinesis/` にあります。この章は AWS では何も実行していません。stream と Lambda の動きは、公式ドキュメントから作った手元のモデルで確かめています。

## 全体像

<!-- section: 54.architecture -->

```figure
caption: リビジョンはノートの ID で決まる shard に並び、関数が shard ごとに順に読む
node producer: Producer | PutRecords
node stream: Kinesis data stream "Revisions" | shard 1 つ、24 時間保持
node mapping: event source mapping | 100 件ずつ、順に
node consumer: Lambda function "Consumer"
node history: DynamoDB テーブル "History"
node failures: SQS キュー "Failures"
edge producer -> stream: partition key = noteId
edge stream --> mapping: GetRecords
edge mapping -> consumer: 同期の呼び出し
edge consumer -> history: 版が新しければ適用
edge mapping --> failures: 諦めた batch の場所
mark stream
```

書く側（producer）は、リビジョンを 1 件ずつレコードにして stream に入れます。レコードには partition key という文字列を付けます。この章ではノートの ID です。同じ partition key のレコードは必ず同じ shard に入り、shard の中では書かれた順に並びます。

読む側は Lambda の関数です。関数と stream のあいだには event source mapping があり、shard からレコードをまとめて読み、関数を呼び、どこまで読んだかを覚えています。08章でキューと関数をつないだのと同じ部品ですが、stream につなぐと動きが変わります。関数が失敗すると、その shard の続きは読まれません。順序を守るためです。

関数は、リビジョンを DynamoDB のテーブル（History）に適用します。適用は条件付きの更新 1 回で、保存してある版より新しいリビジョンだけが通ります。同じレコードがもう一度届いても、何も変わりません。

何度試しても処理できないレコードを、event source mapping は決めた回数で諦めます。諦めた batch が stream のどこにあるかは、SQS のキュー（Failures）に書き残されます。

```figure
caption: レコードは読まれても残る。読み手はそれぞれ位置を持ち、あとから来ても最初から読める
type: sequence
actor p: Producer
actor s: shard
actor a: Consumer A
actor b: Consumer B
step p -> s: n1@1, n1@2, n1@3
step s --> a: n1@1, n1@2, n1@3
note a: 位置は n1@3 の後
step s --> b: n1@1, n1@2, n1@3
note b: あとから読み始めた
step p -> s: n1@4
step s --> a: n1@4
step s --> b: n1@4
```

2 つ目の図が、キューとの違いです。Consumer A が読んだレコードを、あとから来た Consumer B も読めます。A が読んだことを shard は知りません。位置を持っているのは読む側です。

スタックに入れるコンシューマーは 1 つだけです。2 つ目のコンシューマーは、手元のスクリプト（`kinesis:replay`）として用意しました。デプロイした stream を最初から読み、関数と同じコードで履歴をメモリの上に作ります。

## キューとの違い

<!-- section: 54.log -->

| | SQS の標準キュー（08章） | Kinesis の stream |
| --- | --- | --- |
| 読んだあと | 処理が済んだら消す | 残る。保持期間が切れると消える |
| 読み手 | 1 つのメッセージは 1 つの読み手へ | 読み手ごとに位置があり、全員がすべて読む |
| 順序 | 入れ替わることがある | shard の中では書かれた順 |
| 失敗した 1 件 | その 1 件が戻り、ほかは進む | 後ろのレコードが待つ |
| 読み直し | できない | 位置を戻せばできる |
| 容量 | 指定しない | shard ごとに上限がある |

表の右の列は、どれも「順に並んだ記録を、読む側が自分の位置から読む」というしくみから出てきます。

順序を守るには、失敗したレコードを飛ばせません。飛ばせないので、処理できないレコードが 1 件あると、その shard は止まります。キューなら 1 件がデッドレターキューへ行くだけで済んだ失敗が、stream では全体の遅れになります。この章のテストと設定の半分は、この 1 点のためにあります。

読んでも消えないので、消えるのは時間だけが理由です。保持期間は 24 時間が既定で、365 日まで延ばせます。コンシューマーが保持期間より長く止まると、読まれないままレコードが消えます。コンシューマーの遅れを表す iterator age というメトリクスにアラームを付けるのは、そのためです。

容量は shard の数で決まります。公式ドキュメントによると、shard 1 つが受け付ける書き込みは 1 秒に 1,000 件または 1 MB まで、読み取りは 1 秒に 2 MB までです。同じ partition key のレコードは 1 つの shard に集まるので、1 つのノートに書き込みが集中すれば、shard をいくつに増やしても、そのノートの上限は shard 1 つぶんのままです。

## 容量のモードと料金

<!-- section: 54.modes -->

stream には容量のモードが 3 つあります。単価は、2026-10-13 に AWS Price List で読んだ東京リージョンのものです。

provisioned は、shard の数を自分で決めます。shard 1 つにつき 1 時間 0.0195 ドルで、1 か月（730 時間）置くと 14.23 ドルです。書き込みには、25 KB を 1 単位として 100 万単位あたり 0.0215 ドルがかかります。24 時間の保持のなかで GetRecords で読むぶんには、読み取りの料金はありません。

on-demand の Standard は、shard を Kinesis が増減させます。容量を見積もらなくて済むかわりに、stream 1 本につき 1 時間 0.052 ドルがかかり、1 か月で 37.96 ドルになります。そのうえで、書き込みに 1 GB あたり 0.104 ドル、読み取りに 1 GB あたり 0.052 ドルがかかります。書き込みの量は、レコード 1 件を 1 KB に切り上げて数えます。

on-demand の Advantage は、アカウント単位の設定です。stream ごとの時間料金がなくなり、単価も下がりますが、有効にしたアカウントは、on-demand の stream 全体で書き込み 25 MiB/秒、読み取り 25 MiB/秒ぶんを少なくとも支払います。東京の単価で計算すると、1 か月に 4,003.59 ドルです。使った量がそれより少なくても、差額が請求されます。この本の読者が試しに有効にする設定ではありません。

どのモードにも、置いてあるだけで料金のかからない形はありません。この章は、いちばん安い provisioned の shard 1 つにしました。月に 100 万件のリビジョンを書いても、stream の料金は時間料金がほとんどで、スタック全体で 15.23 ドルです。同じ使い方を on-demand の Standard にすると 39.04 ドルになります。

on-demand が合うのは、流量が読めないか、大きく波打つときです。新しい stream は 1 秒に 4 MB の書き込みから始まり、過去 30 日の最大の 2 倍までをすぐに受け付けると、ドキュメントにあります。ただし、1 つの partition key に集中した書き込みまでは面倒を見てくれません。1 つのキーが shard 1 つの上限を超えると、on-demand でも断られ続けます。

保持期間を 24 時間より長くすると、別の料金がかかります。provisioned では、7 日までの延長が shard 1 つにつき 1 時間 0.026 ドルの上乗せです。この章は 24 時間のままにしています。

## ほかの選択肢

<!-- section: 54.choices -->

仕事を 1 つずつ渡すだけなら、[08章](/ja/chapters/08-async.md)の SQS です。順序も読み直しも要らず、失敗した 1 件がほかを止めないほうがよい処理は、キューのほうが単純で、使っていないときの料金もかかりません。SQS そのものは[61章](/ja/chapters/61-sqs.md)で扱います。

中身を見て行き先を振り分けたいなら、[25章](/ja/chapters/25-events.md)の EventBridge です。25章が使った Classic のバスは、イベントをルールに照らしてターゲットへ配る部品で、読む側が位置を持つ記録ではありません。新しい Custom Event Bus は、イベントを保持し、subscriber ごとに開始位置を持たせられると、ドキュメントにあります。この章では比べていません。

DynamoDB のテーブルの変更を順に受け取りたいなら、DynamoDB Streams です（25章、[30章](/ja/chapters/30-data-modeling.md)）。アイテムごとの変更が、起きた順に、重複なしで並びます。保持は 24 時間で、同時に読めるのは shard あたり 2 つまでです。

この選択肢は、この章の題材にも関わります。ノートの版は 05章のテーブルが決めているので、版の順序をそのまま受け取りたいだけなら、DynamoDB Streams のほうが確実です。API がテーブルに書いたあとで Kinesis に書く作りでは、2 つのリクエストが版 2 と版 3 を逆の順で stream に入れることがありえます。Kinesis が保つのは、stream に届いた順です。この章が Kinesis を使うのは、Kinesis そのものを説明するためと、次のどれかが要る場面のためです。テーブルを経由しない出来事を流したい。24 時間より長く残したい。読み手を 3 つ以上にしたい。

S3 に溜めて分析するのが目的なら、[26章](/ja/chapters/26-analytics.md)の Firehose です。Firehose は Kinesis の stream を入力にもできます。

Kafka のクライアントやツールをそのまま使いたいなら、Amazon MSK があります。Apache Kafka を動かすマネージドサービスで、ブローカーをアベイラビリティゾーンごとに置くクラスターか、MSK Serverless を選びます。この本では扱いません。

時間の窓で集計する、複数の stream を結合する、といった処理を書くなら、Amazon Managed Service for Apache Flink があります。Apache Flink のアプリケーションを Java、Scala、Python、SQL で書いて動かすサービスです。この本では扱いません。

### Cloudflare から来た人へ

2026-10-13 の時点で、Cloudflare には Kinesis の stream にそのまま当たる部品は見当たりません。近いものは 2 つあります。

Cloudflare Queues は、08章の SQS に近い部品です。少なくとも 1 回届け、順序は保証しない、とドキュメントにあります。

Basin Pipelines（以前の Cloudflare Pipelines）には stream という部品があり、HTTP か Worker の binding でイベントを受け取り、SQL で変換して、R2 に Iceberg のテーブルや Parquet のファイルとして届けます。1 つの stream を複数の pipeline が読めます。役割は 26章の Firehose に近く、アプリケーションのコードが好きな位置から読み直す API は、読んだページには見つかりませんでした。

Workers と Queues で足りているなら、そのままで構いません。Kinesis が要るのは、キーごとの順序と、複数の読み手と、読み直しが同時に要るときです。そのかわりに、shard の数、partition key の選び方、詰まったときの扱いを、自分で決めることになります。
