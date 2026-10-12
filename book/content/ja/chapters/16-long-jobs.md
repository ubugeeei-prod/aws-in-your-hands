---
title: "16 Workflow: ECS task、Step Functions、Lambda durable functions、AWS Batch"
revision: 1
---

# 16 Workflow: ECS task、Step Functions、Lambda durable functions、AWS Batch

[08章](/ja/chapters/08-async.md)の掃除の関数は、タイムアウトを Lambda の上限である 15 分にしていました。画像が増えればいつかその上限に当たりますが、08章は「枚数に比例させない」と書いただけで、先へ進みました。

この章では、15 分に収まらないかもしれない仕事を最後まで動かします。題材は全ノートのエクスポートで、テーブルのノートをすべて読み、S3 にファイルとして書き出します。途中で止まっても、最初からやり直すのではなく、続きから再開できるようにします。

使う道具は Step Functions ですが、話の中心は 08章と同じところにあります。ステップは 2 回走ることがあり、応答が届かないことも、止まったはずのワーカーが後から書き込むこともあります。それでも出力が 1 つになるように作るのは自分の仕事で、ワークフローのサービスが肩代わりしてくれるわけではありません。

前提は 08章（冪等性、Scheduler）と [12章](/ja/chapters/12-containers.md)（コンテナ）です。コードは `examples/16-long-jobs/` にあります。既定のスタックは、置いてあるだけなら料金がほぼかかりません。金額は[費用のページ](/ja/chapters/16-long-jobs/wrap.md)にまとめました。

## 全体像

<!-- section: 16.architecture -->

```figure
caption: Scheduler が 1 日 1 回、ステートマシン "ExportWorkflow"（Standard、最長 6 時間）を起動し、ステートマシンがステップを順に進める
node scheduler: EventBridge Scheduler "aih-long-jobs-export" | rate(1 day), "ScheduleRole" を assume
node pages: ExportPages | Retry: 3 回、どのエラーでも
node more: MorePages | Choice
node finish: Finish | Retry: 3 回、ExportCorrupt を除く
node exported: Exported | Succeed
node discard: Discard | Retry: 3 回、どのエラーでも
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
caption: 3 つの関数は、テーブルから読んだノートを part に書き、マニフェストを書き、取り消すときは part を消す
node table: DynamoDB テーブル "Notes"
node pages: Lambda "ExportPages" | timeout 300 s
node parts: exports/<id>/parts/00001.ndjson … | S3 バケット "Exports"、exports/ 以下は 7 日で期限切れ
node finish: Lambda "Finish" | timeout 60 s
node discard: Lambda "Discard" | timeout 300 s
node manifest: exports/<id>/manifest.json | S3 バケット "Exports"、exports/ 以下は 7 日で期限切れ
edge table -> pages: Scan、1 ページ 100 件
edge pages -> parts: PutObject, If-None-Match: *
edge parts -> finish: ListObjectsV2
edge parts -> discard: ListObjectsV2
edge discard -> parts: DeleteObject
edge finish -> manifest: PutObject, If-None-Match: *
```

```figure
caption: -c durable=true を付けたときだけ、同じ 3 つのステップを 1 つの関数にまとめた durable function も作られる
node pages: ExportPages
node finish: Finish
node discard: Discard
group durable: Lambda durable function "aih-long-jobs-durable-export", alias "live" = pages, finish, discard
```

新しく出てくるのは、ステートマシン（state machine）が 1 つ、関数が 3 つ、バケットが 1 つ、スケジュールが 1 つです。テーブルは、[05章](/ja/chapters/05-dynamodb.md)と同じ形のものを、このスタックの中にもう 1 つ作ります。

Scheduler は 1 日 1 回、ステートマシンを起動します。ステートマシンは、`ExportPages` が「まだ続きがある」と返すかぎり `ExportPages` を呼び続け、終わったら `Finish` を呼びます。3 つの関数はお互いを知りません。呼ぶ順番と、どこまで進んだかを覚えているのは、ステートマシンです。

### 関数 1 つでは終わらない理由

Lambda の関数は、1 回の呼び出しで最長 900 秒（15 分）しか動けません。申請しても引き上げられない上限です。Lambda Managed Instances という別の動かし方には 90 分までの例外がありますが、この本では扱いません。

ノートが少ないうちは、関数 1 つですべて読んで、すべて書けます。しかし、件数に比例する仕事はいつか 15 分を超えます。超えた時点で関数は止められ、次の呼び出しは最初から始まって、また 15 分で止められます。これでは、何度呼んでも終わりません。

そこで、仕事を割ります。1 回の呼び出しは進められるだけ進めて、どこまで進んだかを返し、次の呼び出しはそこから続けます。こうして割った仕事を、順番に呼ぶ係が必要になります。その係がワークフローです。

### この章で選ばなかったもの

同じことができる道具は、Step Functions のほかにもあります。

- Lambda durable functions は、「順番に呼ぶ係」を Lambda の関数そのものの中に書ける新しい機能です。[デプロイのページ](/ja/chapters/16-long-jobs/deploy.md)の後半で、同じエクスポートをこの機能で書き直します。主役にしなかったのは、実機で確かめられていない範囲が Step Functions より広いからです
- ECS のタスクには、Lambda の 15 分の上限がかかりません。仕事によっては、割らずに済みます。こちらもデプロイのページの最後で触れます
- 08章のキューに「続きはここから」というメッセージを自分で入れて、SQS 経由で自分を呼び直す方法もあります。動きますが、進み具合がどこにも見えません

## 仕事を割る

<!-- section: 16.split -->

割り方は、どこから読むか、次に書くファイルは何番か、終わったかどうか、の 3 つの値で決まります。

<<< @/examples/16-long-jobs/src/job.ts{progress}

ステップからステップへ渡すのは、この 3 つとエクスポートの ID、書いたノートの件数だけです。ノートそのものは入れていません。Step Functions がステートの間で運べるのは 256 KiB までで、それより大きい値を返すと実行が失敗するからです。大きなデータは S3 に置き、ワークフローには「どこまで進んだか」だけを通します。

### 読む側

<<< @/examples/16-long-jobs/src/note-source.ts{port}

読む側の約束は 1 つだけで、「前回の続き」を表すカーソルを渡すと、その先の 1 ページを返すことです。

<<< @/examples/16-long-jobs/src/dynamodb-note-source.ts{scan}

05章の API は、1 人の持ち主のノートを `Query` で読んでいました。エクスポートは全員のノートが相手なので、テーブルを端から読む `Scan` を使います。`Scan` は 1 回で最大 1 MB しか返さず、続きがあれば `LastEvaluatedKey` を返します。この値を次の `ExclusiveStartKey` に渡せば続きが読めるので、`LastEvaluatedKey` をそのままカーソルにしています。

`Scan` には、気をつけるところが 2 つあります。1 つ目は、`Limit` も 1 MB の上限も、フィルターをかける前の件数に効くことです。そのため、ノートが 1 件も入っていないページが途中で返ってくることがあります。空のページは「終わり」を意味しません。終わりの合図は、`LastEvaluatedKey` が無いことだけです。

2 つ目は、`Scan` が、ある瞬間のテーブルの写しを読むわけではないことです。エクスポートの途中で書かれたノートは、入ることも入らないこともあります。したがって、この章のエクスポートは「始めた時点の全ノート」を約束しません。約束する内容は、「ステップは 2 回走る」の節の最初に 1 文で書きます。

### 名前は、仕事の中身から

<<< @/examples/16-long-jobs/src/job.ts{start}

エクスポートの ID には、乱数も実行の ID も使いません。スケジュールが「この回は何時の分か」として渡してくる時刻を、ID にします。

08章で見たとおり、Scheduler の配送は「少なくとも 1 回」です。同じ回が 2 回届けば、ステートマシンの実行が 2 つ始まります。このとき 2 つの実行が別々の ID で別々のファイルを書くと、エクスポートが 2 つできてしまいます。同じ時刻から同じ ID を作っておけば、2 つの実行は同じエクスポートを書こうとします。書き込みがぶつかったときの扱いは、次の節で決めます。

<<< @/examples/16-long-jobs/src/job.ts{keys}

ファイルの置き場所も、ID と番号だけで決まります。何回目の試行かはキーに入れていないので、同じステップが 2 回走れば、2 回とも同じキーに書こうとします。

## ステップは 2 回走る

<!-- section: 16.idempotent-step -->

守ることを、先に 1 文で書きます。

**1 つのエクスポートの part は、番号ごとに 1 回だけ書かれ、次の part は、書かれた part が終わったところから始まる。同じステップがもう一度走っても、止まっていたワーカーが後から書こうとしても、同じエクスポートの実行が 2 つ重なっても、変わらない。**

Step Functions を使っているからといって、ステップが 1 回しか走らないとは言えません。公式ドキュメントは Standard ワークフローを exactly-once と説明していますが、定義に `Retry` を書かないかぎり、という但し書きが付いています。一方で、`Retry` を書かないワークフローは、一時的なエラー 1 つで全体が失敗します。実用になるワークフローは、ステップを再実行するものです。

しかも、再実行されるのは失敗したステップだけではありません。成功したのに、成功したことが伝わらなかったステップも再実行されます。

```text
one call of ExportPages for part N (cursor C)            if the worker stops right after this step
  1. Scan from C, up to 100 notes                        nothing has changed
  2. PutObject parts/N, If-None-Match: *                 part N exists; a retry gets 412 and reads its metadata
     on 412: HeadObject parts/N, take its count and next
  3. return {cursor: next, nextPart: N+1, ...}           the workflow never hears; it runs the step again from C

never, in any order of retries and late workers:
  a part written twice, or a part replaced after the workflow moved past it
```

2 と 3 の間で止まった場合を考えます。part N は S3 にありますが、ワークフローはそのことを知らないので、同じ入力でもう一度ステップを呼びます。

2 回目の呼び出しが条件を付けずに `PutObject` したとします。キーが同じなので、part N は上書きされます。重複はしないので、これで十分に見えます。

しかし、十分ではありません。1 回目と 2 回目の間に、テーブルが変わっているかもしれないからです。1 回目のページに入っていたノートが 1 件消されていれば、2 回目のページは 1 件ぶん先まで読みます。上書きされた part N は 1 回目より 1 件先で終わりますが、次の part もそこから始まるので、ここまでは辻褄が合っています。辻褄が合わなくなるのは、1 回目のワーカーが実は生きていた場合です。

```figure
caption: 止まっていたワーカー A の PutObject が、ワーカー B が part 3 を書いたあとに届く
type: sequence
actor wf: ワークフロー
actor a: ワーカー A
actor b: ワーカー B
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
step a -> s3: B のメタデータを読む
step a --> wf: B の位置を報告する
```

t5 で A の書き込みが通ると、part 3 は A のページに戻ります。ところがワークフローは、B のページの続きから part 4 を書いています。A のページは B のページより 1 件手前で終わっているので、その間の 1 件が、どの part にも入りません。エラーは 1 つも出ないまま、1 件欠けたエクスポートができあがります。

### 先に書いたほうが勝つ

<<< @/examples/16-long-jobs/src/export-store.ts{port}

<<< @/examples/16-long-jobs/src/s3-export-store.ts{put-if-absent}

`If-None-Match: *` を付けた `PutObject` は、そのキーにオブジェクトが無いときだけ書き込み、あれば 412 を返します。検査と書き込みは、S3 が 1 つの操作として実行します。公式ドキュメントによると、同じキーへの条件付き書き込みが重なった場合は、最初に終わった 1 つだけが成功して、残りは 412 になります。05章の楽観ロックや 08章の「新しいときだけ書く」と同じ形で、相手が S3 になっただけです。

412 は失敗ではなく、「もう誰かが書いた」という答えです。この答えを受け取った後に何をするかで、上の 1 文が守れるかどうかが決まります。

<<< @/examples/16-long-jobs/src/steps.ts{export-pages}

part が先に書かれていたら、ステップは自分が読んだページを捨てます。そのうえで、書かれている part に何件入っていて、どこで終わったかを読み、その値を自分の結果として返します。part には、件数と終わりの位置をメタデータとして付けてあります。

こうしておくと、part N を誰が書いたかに関係なく、part N の後に続くカーソルは 1 つに決まります。再実行されたステップも、遅れてきたワーカーも、重なった別の実行も、同じ場所から part N+1 を始めます。

### 順序を決めて、壊しにいく

テストは、ステップの関数を直接呼びます。Step Functions も、時計も、乱数も要りません。処理を止める場所と、テーブルを変える瞬間を、テストごとに 1 つずつ固定しています。

| 注入すること | 結果 |
| --- | --- |
| 同じステップを、同じ入力で 2 回呼ぶ | 2 回目は何も書かない。返す進捗も同じ |
| 1 つ目の part を書いた後で応答を捨て、ノートを 1 件消してから、最初から呼び直す | 1 つ目の part は最初の試行のまま。その後ろは飛ばされず、繰り返されない |
| 3 つ目の part の書き込みを失敗させる | ステップは例外を投げる。呼び直すと、2 つの part を飛ばして続きを書く |
| テーブルの読み取りを失敗させる | 進捗は進まない。書かれた part はそのまま |
| ワーカー A を書き込みの直前で止め、ノートを 1 件消し、ワーカー B に全部やらせてから、A を再開する | 出力は B のもののまま。A は、B と同じ進捗を返す |
| 同じエクスポートを 2 つ同時に、1 ページずつ交互に進める | part は 1 組だけ。2 つの実行は同じ結果を返す |

5 行目が、ワーカー A と B の図に描いた時系列です。テストでは、A の書き込みを合図があるまで待たせておき、その間に B を最後まで走らせています。待ち時間の長さには頼っていません。

コードをわざと 2 か所壊して、テストが落ちることも確かめました。412 のときに自分のページの値をそのまま使うようにすると、テストが 2 つ落ちます。手元のストアを上書きできるようにしても、2 つ落ちます。
