---
title: "16 Workflow: ECS task、Step Functions、Lambda durable functions、AWS Batch"
revision: 1
---

# 16 Workflow: ECS task、Step Functions、Lambda durable functions、AWS Batch

[08章](/ja/chapters/08-async.md)の掃除の関数は、timeout を 15 分にしていました。Lambda の上限です。画像が増えたら、いつかそこに当たります。あの章は「枚数に比例させない」と書いて、先送りにしました。

この章では、15 分に収まらないかもしれない仕事を、最後まで動かします。題材は、全ノートの export です。table のノートを全部読んで、S3 にファイルとして書き出します。途中で止まっても、最初からではなく、続きから再開できるようにします。

道具は Step Functions です。ただ、話の中心は 08章と同じところにあります。step は 2 回走ることがあります。応答が届かないことも、止まったはずの worker が後から書き込むこともあります。それでも出力が 1 つになるように作る。workflow のサービスは、そこを肩代わりしてくれません。

前提は 08章（冪等性、Scheduler）と [12章](/ja/chapters/12-containers.md)（コンテナ）です。コードは `examples/16-long-jobs/` にあります。既定の stack は、置いてあるだけでは料金がほぼかかりません。数字は「お金の話」にあります。

## 全体像

<!-- section: 16.architecture -->

```figure
caption: Scheduler が 1 日 1 回、state machine "ExportWorkflow"（Standard、最長 6 時間）を起動し、state machine が step を順に進める
node scheduler: EventBridge Scheduler "aih-long-jobs-export" | rate(1 day), "ScheduleRole" を assume
node pages: ExportPages | Retry: 3 回、どの error でも
node more: MorePages | Choice
node finish: Finish | Retry: 3 回、ExportCorrupt を除く
node exported: Exported | Succeed
node discard: Discard | Retry: 3 回、どの error でも
node discarded: Discarded | Fail
edge scheduler -> pages: StartExecution {exportId: 予定の時刻}、少なくとも 1 回
edge pages -> more
edge more -> finish: done: true
edge more -> pages: done: false
edge finish -> exported
edge finish -> discard: ExportCorrupt
edge discard -> discarded
group workflow: Step Functions = pages, more, finish, exported, discard, discarded
```

```figure
caption: 3 つの関数は、table から読んだノートを part に書き、manifest を書き、取り消すときは part を消す
node table: DynamoDB table "Notes"
node pages: Lambda "ExportPages" | timeout 300 s
node parts: exports/<id>/parts/00001.ndjson … | S3 bucket "Exports"、exports/ 以下は 7 日で期限切れ
node finish: Lambda "Finish" | timeout 60 s
node discard: Lambda "Discard" | timeout 300 s
node manifest: exports/<id>/manifest.json | S3 bucket "Exports"、exports/ 以下は 7 日で期限切れ
edge table -> pages: Scan、1 ページ 100 件
edge pages -> parts: PutObject, If-None-Match: *
edge parts -> finish: ListObjectsV2
edge parts -> discard: ListObjectsV2
edge discard -> parts: DeleteObject
edge finish -> manifest: PutObject, If-None-Match: *
```

```figure
caption: -c durable=true を付けたときだけ、同じ 3 つの step を 1 つの関数にまとめた durable function も作られる
node pages: ExportPages
node finish: Finish
node discard: Discard
group durable: Lambda durable function "aih-long-jobs-durable-export", alias "live" = pages, finish, discard
```

新しく出てくるのは、state machine が 1 つ、関数が 3 つ、bucket が 1 つ、schedule が 1 つです。table は [05章](/ja/chapters/05-dynamodb.md)と同じ形のものを、この stack の中にもう 1 つ作ります。

1 日 1 回、Scheduler が state machine を起動します。state machine は `ExportPages` を「まだ続きがある」と言われるかぎり呼び続け、終わったら `Finish` を呼びます。関数どうしは、お互いを知りません。順番と、どこまで進んだかを覚えているのは、state machine です。

### 関数 1 つで、なぜだめなのか

Lambda の関数は、1 回の呼び出しで最長 900 秒（15 分）しか動けません。申請しても引き上げられない上限です（Lambda Managed Instances という別の動かし方には 90 分までの例外がありますが、この本では扱いません）。

ノートが少ないうちは、関数 1 つで全部読んで全部書けます。でも、件数に比例する仕事は、いつか 15 分を超えます。超えた瞬間に関数は止められて、次に動くときは最初からです。そして次も 15 分で止まります。永遠に終わりません。

なので、仕事を割ります。「1 回の呼び出しは、進められるだけ進めて、どこまで進んだかを返す」。次の呼び出しは、そこから続けます。割った仕事を順番に呼ぶ係が要ります。それが workflow です。

### この章で選ばなかったもの

Step Functions のほかにも、同じことができる道具があります。

- **Lambda durable functions。** 「順番に呼ぶ係」を、Lambda の関数そのものの中に書ける新しい機能です。この章の後半で、同じ export を書き直します。主役にしなかったのは、実機で確かめられていない範囲が Step Functions より広いからです
- **ECS の task。** 15 分は Lambda の上限で、コンテナにはかかりません。割らずに済む仕事もあります。章の終わりで触れます
- **SQS で自分を呼び直す。** 08章の queue に「続きはここから」というメッセージを自分で入れるやり方です。動きますが、進み具合がどこにも見えません

## 仕事を割る

<!-- section: 16.split -->

割り方を決めるのは、3 つの値です。どこから読むか、次に書くファイルは何番か、終わったか。

<<< @/examples/16-long-jobs/src/job.ts{progress}

これが、step から step へ渡る全部です。ノートそのものは入っていません。Step Functions が state の間で運べるのは 256 KiB までで、それより大きい値を返すと実行が失敗します。大きなデータは S3 に置いて、workflow には「どこまで進んだか」だけを通します。

### 読む側

<<< @/examples/16-long-jobs/src/note-source.ts{port}

読む側の約束は 1 つだけです。「前回の続き」を表す cursor を渡すと、その先の 1 ページを返すこと。

<<< @/examples/16-long-jobs/src/dynamodb-note-source.ts{scan}

05章の API は、1 人の持ち主のノートを `Query` で読んでいました。export は全員のノートが相手なので、table を端から読む `Scan` を使います。`Scan` は 1 回で最大 1 MB しか返さず、続きがあれば `LastEvaluatedKey` を返します。それを次の `ExclusiveStartKey` に渡す。これが、そのまま cursor になります。

気をつけるところが 2 つあります。`Limit` も 1 MB の上限も、filter をかける前の件数に効きます。なので、ノートが 1 件も入っていないページが、途中に返ってくることがあります。空のページは「終わり」ではありません。終わりの合図は、`LastEvaluatedKey` が無いことだけです。

もう 1 つ。`Scan` は、ある瞬間の table の写しを読むわけではありません。export の途中で書かれたノートは、入ることも、入らないこともあります。この章の export は「始めた時点の全ノート」を約束しません。約束するのは、次の節の 1 文です。

### 名前は、仕事の中身から

<<< @/examples/16-long-jobs/src/job.ts{start}

export の ID は、乱数でも、実行の ID でもありません。schedule が「この回は何時の分か」として渡してくる時刻です。

08章の話を思い出してください。Scheduler の配送は「少なくとも 1 回」でした。同じ回が 2 回届いたら、state machine は 2 つ起動します。そのとき、2 つが別々の ID で別々のファイルを書いたら、export が 2 つできます。同じ時刻から同じ ID を作れば、2 つの実行は同じ export を書こうとします。その先は、次の節が受け止めます。

<<< @/examples/16-long-jobs/src/job.ts{keys}

ファイルの置き場所も、ID と番号だけで決まります。何回目の試行かは、key に入りません。同じ step が 2 回走れば、2 回とも同じ key を狙います。

## step は 2 回走る

<!-- section: 16.idempotent-step -->

守ることを、先に 1 文で書きます。

**1 つの export の part は、番号ごとに 1 回だけ書かれ、次の part は、書かれた part が終わったところから始まる。同じ step がもう一度走っても、止まっていた worker が後から書こうとしても、同じ export の実行が 2 つ重なっても、変わらない。**

「Step Functions を使っているから、step は 1 回しか走らない」とは言えません。公式ドキュメントは、Standard workflow を exactly-once と説明しています。ただし、但し書きが付いています。定義に `Retry` を書かないかぎり、です。そして、`Retry` を書かない workflow は、一時的なエラー 1 つで全体が失敗します。実用になる workflow は、step を再実行します。

しかも、再実行されるのは「失敗した step」とは限りません。成功したのに、成功が伝わらなかった step も、です。

```text
one call of ExportPages for part N (cursor C)            if the worker stops right after this step
  1. Scan from C, up to 100 notes                        nothing has changed
  2. PutObject parts/N, If-None-Match: *                 part N exists; a retry gets 412 and reads its metadata
     on 412: HeadObject parts/N, take its count and next
  3. return {cursor: next, nextPart: N+1, ...}           the workflow never hears; it runs the step again from C

never, in any order of retries and late workers:
  a part written twice, or a part replaced after the workflow moved past it
```

2 と 3 の間で止まった場合を考えてみましょう。part N は S3 にあります。でも workflow は、それを知りません。同じ入力で、もう一度 step を呼びます。

ここで素直に `PutObject` すると、どうなるでしょう。key は同じなので、上書きです。重複はしません。一見、これで十分に見えます。

十分ではありません。1 回目と 2 回目の間に、table が変わっているかもしれないからです。1 回目のページに入っていたノートが 1 件消されていたら、2 回目のページは 1 件ぶん先まで読みます。上書きされた part N は、さっきより 1 件先で終わります。ここまでは、まだ辻褄が合っています。問題は、1 回目の worker が実は生きていた場合です。

```figure
caption: 止まっていた worker A の PutObject が、worker B が part 3 を書いたあとに届く
type: sequence
actor wf: workflow
actor a: worker A
actor b: worker B
actor s3: S3 | parts/3
step wf -> a: t0 ExportPages（part 3）
step a -> a: 読んで PutObject を始める
note a: t1 止まる（応答なし）
step wf -> b: t2 A を諦めて再試行
step b -> b: ページを読む（1 件消えていた）
step b -> s3: t3 PutObject: 書けた
step b --> wf: t4 戻る
step wf -> wf: t4 B の part の続きから進む
note s3: ふつうの PutObject なら
step a -> s3: t5 遅れた PutObject が届く
note s3: A の part に置き換わる
note wf: 1 件がどの part にも入らない
note s3: If-None-Match: * なら
step a -x s3: t5 遅れた PutObject: 412
step a -> s3: B の metadata を読む
step a --> wf: B の位置を報告する
```

t5 で A の書き込みが通ると、part 3 は A のページに戻ります。でも workflow は、B のページの続きから part 4 を書いています。A のページは 1 件手前で終わっているので、その間の 1 件が、どの part にも入りません。黙って 1 件欠けた export ができます。

### 先に書いたほうが勝つ

<<< @/examples/16-long-jobs/src/export-store.ts{port}

<<< @/examples/16-long-jobs/src/s3-export-store.ts{put-if-absent}

`If-None-Match: *` を付けた `PutObject` は、その key に object が無いときだけ書き込みます。あれば 412 です。検査と書き込みは、S3 が 1 つの操作として実行します。公式ドキュメントによると、同じ key への条件付き書き込みが重なったら、最初に終わった 1 つだけが成功して、残りは 412 になります。05章の楽観ロック、08章の「新しいときだけ書く」と同じ形で、相手が S3 になっただけです。

412 は失敗ではありません。「もう誰かが書いた」という答えです。大事なのは、その後です。

<<< @/examples/16-long-jobs/src/steps.ts{export-pages}

part が先に書かれていたら、自分が読んだページは捨てます。そして、書かれている part が「何件入っていて、どこで終わったか」を読んで、それを自分の結果として返します。part には、その 2 つを metadata として付けてあります。

こうすると、part N を誰が書いたかに関係なく、part N の後に続く cursor は 1 つに決まります。再実行された step も、遅れてきた worker も、重なった別の実行も、同じ場所から part N+1 を始めます。

### 順序を決めて、壊しにいく

テストは、step の関数を直接呼びます。Step Functions も、時計も、乱数も要りません。止める場所と、table を変える瞬間を、1 つずつ固定しています。

| 注入すること | 結果 |
| --- | --- |
| 同じ step を、同じ入力で 2 回呼ぶ | 2 回目は何も書かない。返す進捗も同じ |
| 1 つ目の part を書いた後で応答を捨て、ノートを 1 件消してから、最初から呼び直す | 1 つ目の part は最初の試行のまま。その後ろは飛ばされず、繰り返されない |
| 3 つ目の part の書き込みを失敗させる | step は例外を投げる。呼び直すと、2 つの part を飛ばして続きを書く |
| table の読み取りを失敗させる | 進捗は進まない。書かれた part はそのまま |
| worker A を書き込みの直前で止め、ノートを 1 件消し、worker B に全部やらせてから、A を再開する | 出力は B のもののまま。A は、B と同じ進捗を返す |
| 同じ export を 2 つ同時に、1 ページずつ交互に進める | part は 1 組だけ。2 つの実行は同じ結果を返す |

5 行目が、さっきの時系列です。テスト用の細工で、A の書き込みを「合図があるまで待つ」ようにして、その間に B を最後まで走らせています。待ち時間には頼っていません。

コードをわざと 2 か所壊して、テストが落ちることも確かめました。412 のときに自分のページの値をそのまま使うと、2 つ落ちます。手元の store を上書きできるようにしても、2 つ落ちます。
