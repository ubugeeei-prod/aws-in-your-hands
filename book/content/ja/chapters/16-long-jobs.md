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

## 最後の 1 個で、見えるようにする

<!-- section: 16.manifest -->

part が全部そろうまでの間、bucket には書きかけの export が置いてあります。それを誰かが読んだら、困ります。

<<< @/examples/16-long-jobs/src/steps.ts{finish}

なので、export を読む側との約束を 1 つ決めます。**manifest が無い export は、存在しない。** manifest は、part の key の一覧を書いた小さなファイルです。読む側は、まず manifest を読んで、そこに名前のある part だけを読みます。prefix の下を一覧して読んではいけません。

`Finish` は、manifest を書く前に、part が全部あるかを一覧で確かめます。無いものの名前を manifest に書くわけにはいかないからです。manifest の中身には、時刻を入れていません。同じ export を 2 つの実行が仕上げても、書こうとする bytes が同じになります。先に書いたほうが勝って、もう片方は 412 を受け取って、同じ結果を返します。

### 進めないときだけ、取り消す

part が欠けていたら、どうするか。ここが、この章の「補償処理」です。

データベースの transaction なら、途中で失敗したら rollback が全部を無かったことにしてくれます。workflow には、それがありません。step 1 が S3 に書いたものは、step 3 が失敗しても、そこに残ります。取り消したければ、取り消す step を自分で書きます。これが補償処理（compensation）です。

<<< @/examples/16-long-jobs/src/steps.ts{discard}

補償処理は、ふつうの step より難しい立場にいます。何かが壊れているときに呼ばれて、しかも自分も途中で止まります。なので、決まりが 3 つあります。

- **何度呼ばれてもよい。** 消えているものを消しても、エラーにしません。途中で止まったら、もう一度呼べば残りが消えます
- **完成したものには触らない。** manifest がある export は、消しません。「失敗した」という判断が古かった場合の保険です
- **取り消せないものは、取り消せない。** S3 の object は消せます。送ってしまったメールは消せません。取り消せない操作は、workflow のできるだけ後ろに置きます

そして、補償処理を呼ぶ場面は、思ったより少なくします。`ExportPages` が失敗しても、この workflow は part を消しません。書けた part は、次に再開するときの出発点だからです。消すのは、`Finish` が「part が欠けている」と言ったときだけ。再試行しても、欠けた part は戻ってこないからです。

**先へ進めるなら、再開する。進めないときだけ、取り消す。** 長い処理では、ここを最初に決めます。全部の失敗で取り消す workflow は、「続きから再開」を自分で捨てています。

再開も取り消しもされずに放っておかれた part は、どうなるでしょう。bucket の lifecycle rule が、7 日後に消します。完成した export も同じ 7 日で消えます。export は、取りに来る人のための一時的な置き場、という扱いです。

閉じていない穴を 1 つ、書いておきます。`Finish` の「一覧で確かめる」と「manifest を書く」は、2 つの操作です。その間に、別の実行の `Discard` が part を消したら、消えた part の名前が入った manifest ができます。同じ export の実行が 2 つ重なって、片方だけが「欠けている」と判断したときにしか起きませんが、起きえます。この章では閉じていません。

## 順番は、workflow に任せる

<!-- section: 16.workflow -->

step がそろったので、つなぎます。Step Functions の workflow は、state machine と呼ばれて、Amazon States Language（ASL）という JSON で書きます。

<<< @/examples/16-long-jobs/src/workflow.ts{definition}

この章は、定義を TypeScript の object として書いています。CDK にも construct がありますが、使いませんでした。同じ object を、手元の実行器（後で出てきます）と CDK の両方に渡したいからです。

state は 6 つです。`Task` が関数を呼び、`Choice` が分かれ道で、`Succeed` と `Fail` が終点です。

`Task` の `Resource` には、関数の ARN をそのまま書いています。こう書くと、state の入力がそのまま関数の event になり、関数の戻り値がそのまま state の出力になります。`ExportPages` が返した進捗が、`MorePages` を通って、次の `ExportPages` の入力になる。loop は、これだけで回ります。

### Retry と Catch

`Retry` は「この state を、同じ入力でもう一度」です。`ExportPages` は、どんなエラーでも 3 回までやり直します。間隔は 5 秒から始めて、倍にしていきます。`States.ALL` は、ほぼ全部のエラーに一致する名前です。関数の例外も、Lambda の一時的な障害も、timeout も入ります。

`Finish` だけ、`Retry` が 2 段になっています。`ExportCorrupt` は 0 回、つまり再試行しない。それ以外は 3 回。`ExportCorrupt` は、関数が投げる例外の `name` です。Lambda の関数が投げたエラーは、その `name` で Step Functions に届きます。

`Catch` は「再試行が尽きたら、失敗させるかわりに、この state へ」です。`ResultPath` を付けると、元の入力を残したまま、エラーの情報を横に足して渡します。`Discard` は、そこから export の ID を読みます。

`Catch` を付けたのは、`Finish` の `ExportCorrupt` だけです。ほかの失敗は、どこにも捕まらず、実行そのものが失敗します。わざとです。

### 失敗した実行は、続きから

失敗した Standard workflow の実行は、14 日以内なら redrive できます。失敗した state から、そのときの入力で、やり直す操作です。成功した state は、やり直しません。

`ExportPages` が 4 回続けて失敗して実行が止まったとします。原因（たとえば権限の誤り）を直してから redrive すると、`ExportPages` が、止まったときの進捗を入力にしてもう一度呼ばれます。part 1 から 30 まで書けていたなら、31 から続きます。厳密には、止まった呼び出しが途中まで書いた part も、412 で読み飛ばして先へ進みます。

ここで `Catch` を付けて `Fail` state に流していたら、redrive は効きません。ドキュメントによると、redrive は `Fail` state に入り直して、また失敗します。この workflow で `Discarded` まで行った実行は、もう再開できません。取り消したのだから、それで合っています。

### Standard と Express

state machine には 2 つの種類があって、作った後では変えられません。

| | Standard | Express |
| --- | --- | --- |
| 最長 | 1 年 | 5 分 |
| 状態 | state の間で保存される | 保存されない |
| 実行の保証 | exactly-once（`Retry` を除く） | 非同期は at-least-once |
| 課金 | state transition の数 | 実行の数、時間、メモリ |
| 失敗した実行の redrive | できる | 確認していません |

この章は Standard です。5 分で終わる保証がなく、途中から再開したいからです。

### timeout は、必ず書く

`Task` の `TimeoutSeconds` は、省くと 99,999,999 秒です。3 年を超えます。応答が永遠に返ってこない task があったら、実行はそこで止まったままになります。公式のベストプラクティスも、task には timeout を書くように、と言っています。

この章は、`Task` の timeout を、関数の timeout より 30 秒長くしました。先に Lambda が関数を止めて、エラーを返す。Step Functions は、それを受け取って再試行する。この順番にしておくと、「Step Functions はあきらめたのに、関数はまだ動いている」という状態を、ふつうは作らずに済みます。

「ふつうは」と書いたのは、作らずに済むとは言い切れないからです。ドキュメントは、timeout になった task を失敗として扱う、と書いています。動いている関数を止める、とは書いていません。それに、応答がネットワークの途中で失われることもあれば、同じ export の実行が 2 つ重なることもあります。前の節の `If-None-Match` は、そのためにあります。timeout の設定は、遅れてきた worker を減らします。無くすのは、書き込みの条件です。

## checkpoint の粒度

<!-- section: 16.checkpoint -->

「どこまで進んだか」を保存することを、checkpoint と呼びます。この workflow の checkpoint は、`ExportPages` が戻るたびに 1 つ作られます。では、どれくらいの頻度で戻るのがよいでしょう。

<<< @/examples/16-long-jobs/src/steps.ts{budget}

step の関数は、1 ページ書くたびに「もう 1 ページ行けるか」を外に聞きます。答えを誰が持っているかで、粒度が決まります。

<<< @/examples/16-long-jobs/src/export-pages-lambda.ts{handler}

Lambda で動くときの答えは、「関数の timeout まで、まだ 60 秒以上あるか」です。`getRemainingTimeInMillis()` は、Lambda が handler に渡す context の関数で、止められるまでの残り時間を返します。関数の timeout は 300 秒なので、1 回の呼び出しは、およそ 4 分ぶんのページを書いて戻ります。

<<< @/examples/16-long-jobs/src/env.ts{env}

両極端を考えてみましょう。

**1 ページごとに戻る。** 失敗したときにやり直す量は、1 ページで済みます。そのかわり、ページの数だけ workflow を通ります。Standard workflow は state transition の数で課金されるので、ページが増えれば、料金も一緒に増えます。もう 1 つ、上限があります。Standard workflow の 1 回の実行は、履歴が 25,000 イベントに達すると失敗します。loop を回すたびに、履歴は数件ずつ伸びます。

**全部を 1 回で。** state transition は最少です。でも、15 分で終わらない仕事では、そもそも選べません。

この章は、その間を取りました。時間の許すかぎり進めて、余裕を残して戻る。ノートが少ないうちは 1 回で終わり、増えたら自然に 2 回、3 回と割れていきます。

ここで、前の節までの設計が効いてきます。part は 1 ページごとに S3 に書かれていて、書かれた part は読み飛ばせます。つまり、**workflow の checkpoint が粗くても、やり直す量は増えません。** 4 分ぶん進んだところで関数が落ちても、再試行は、書けている part を 412 で確かめながら通り過ぎて、続きから書きます。読み直しの `Scan` は走りますが、書き込みは走りません。

checkpoint は、2 段になっているわけです。workflow が覚えている進捗は「どこから呼ぶか」の目安で、S3 にある part が「どこまで済んだか」の事実です。目安が古くても、事実のほうが正しい結果に連れていきます。テストは、1 ページごとに戻る場合と、1 回で全部書く場合で、出力が 1 バイトも違わないことを確かめています。

履歴の上限に近づくほど loop が長い仕事では、別の手が要ります。公式ドキュメントが挙げているのは、Distributed Map を使うか、途中で新しい実行を起動して続きを渡すか、です。この章では、どちらも試していません。

## 手元で動かす

<!-- section: 16.local -->

```bash
vp run export:local
vp run export:local --notes 450 --lose 2 --break 4
```

1 行目は、メモリ上の 250 件のノートを、デプロイするのと同じ定義で export します。2 行目は、わざと 2 つ壊します。`--lose 2` は、`ExportPages` の 2 回目の応答を捨てます。仕事は済んでいるのに、workflow には timeout に見える、という状況です。`--break 4` は、4 つ目の part の書き込みを 4 回続けて断ります。再試行が尽きて、実行が失敗します。そのあと、失敗した state から再開して、manifest の行数と、重複のないノートの件数が合っていることを確かめて終わります。

Docker も、AWS の認証情報も要りません。

### 定義を、そのまま歩く

<<< @/examples/16-long-jobs/src/local-workflow.ts{run}

<<< @/examples/16-long-jobs/src/local-workflow.ts{task}

Step Functions の代わりは、100 行ほどの関数です。ASL のうち、この章が使うものだけを知っています。`Task` の `Retry` と `Catch`、boolean を 1 つ見る `Choice`、`Succeed`、`Fail`。それだけです。

これを書いた理由は、定義の配線をテストしたかったからです。`Retry` の順番を間違えて `ExportCorrupt` が 3 回再試行される。`Catch` の行き先が違う。そういう誤りは、step の関数をいくら丁寧にテストしても見つかりません。

<<< @/examples/16-long-jobs/src/local.ts{local}

呼ばれる側は、Lambda の handler がやることから Lambda を抜いたものです。入力を schema に通して、step の関数を呼びます。

テストは、この実行器の上で、次を確かめています。

- 応答が失われた step が再試行されて、part が 2 重に書かれないこと
- 再試行が尽きると実行が失敗し、part が残り、失敗した state から再開できること
- 失敗した後で、最初から起動し直しても、同じ export ができること
- part が欠けていると、`Finish` は 1 回だけ試されて、`Discard` が走り、実行が `ExportDiscarded` で終わること
- `Discard` も、失敗すれば再試行されること

これは Step Functions の模擬ではありません。再現しないものを挙げておきます。

- 待つこと。再試行の間隔、`TimeoutSeconds`、実行全体の timeout は、どれも無視する。timeout は、テストが「timeout という名前のエラー」を投げて表している
- 状態の保存。実行器は 1 つの process の中の loop で、落ちれば全部消える
- ASL の残り。JSONPath、`Parameters`、`Map`、`Parallel`、`Wait`、JSONata。定義にそれらを書いても、ここでは動かない
- 入出力の 256 KiB の上限と、25,000 イベントの履歴の上限
- 関数の ARN を `Resource` に書いたときの、実際の入出力の形
- IAM、Scheduler、S3、DynamoDB

### テスト

```bash
vp run test:unit
```

durable function 版のテストも、ここで一緒に走ります。そちらは、SDK に付いてくる実行器を使っています。

## AWS にのせる準備

<!-- section: 16.infra -->

### bucket

<<< @/examples/16-long-jobs/infra/lib/long-jobs-stack.ts{bucket}

この bucket には、全員のノートが入ります。公開の設定は 4 つとも閉じて、HTTP での接続は拒否します。読めるのは、IAM で許された相手だけです。この章は、export を利用者に渡すところまでは作っていません。渡すなら、[07章](/ja/chapters/07-uploads.md)の presigned URL が使えます。

### 3 つの関数、3 つの role

<<< @/examples/16-long-jobs/infra/lib/long-jobs-stack.ts{steps}

関数を 1 つにまとめて、入力で分岐させることもできます。分けたのは、権限を分けたかったからです。

- `ExportPages` は、table を `Scan` できて、part を書けます。消せません
- `Finish` は、一覧できて、manifest を書けます。table は読めません
- `Discard` は、一覧できて、消せます。書けませんし、table も読めません

ノートを読める関数は 1 つだけ。object を消せる関数も 1 つだけです。`s3:PutObject` だけで `If-None-Match` の検査ができることは、S3 のドキュメントに書いてあります。`ExportPages` の `s3:GetObject` は、412 の後で metadata を読む `HeadObject` のためです。

### state machine

<<< @/examples/16-long-jobs/infra/lib/long-jobs-stack.ts{state-machine}

state machine にも、実行 role があります。Step Functions が、あなたの代わりに関数を呼ぶための role です。できるのは、3 つの関数の呼び出しだけ。信頼する相手を絞る条件（このアカウントの、このリージョンの state machine）は、公式ドキュメントの例と同じ形です。

定義は、`toJsonString` で 1 本の文字列にして渡しています。関数の ARN はデプロイするまで決まらないので、template の中では `Fn::Join` になります。

CloudFormation には、定義の中の `${名前}` を置き換える `DefinitionSubstitutions` という property もあります。この章は使いません。固定した版の cdkd（0.296.28）のソースを読むと、この置き換えは、定義を S3 から取ってくる場合にしか行われないからです。template に直接書いた定義には、効きません。テストは、この property が template に無いことを固定しています。

### schedule

<<< @/examples/16-long-jobs/infra/lib/long-jobs-stack.ts{schedule}

08章の schedule は、Lambda の関数を呼んでいました。今度の相手は state machine です。Scheduler は、Step Functions の `StartExecution` を呼びます。role に要るのは `states:StartExecution` で、対象はこの state machine 1 つです。

`input` の `<aws.scheduler.scheduled-time>` は、Scheduler が置き換える目印です。その回が予定されていた時刻（`2026-10-12T03:00:00Z` のような形）になります。これが、export の ID のもとです。

名前を付けて起動すれば、Step Functions の側で 2 重の起動を断ってもらえます。`StartExecution` は、同じ名前と同じ入力なら、動いている実行をそのまま返します。この章は、それを使っていません。この形の target では、Scheduler に実行の名前を渡す場所がないからです。別の形の target（universal target）なら渡せそうですが、時刻に含まれる `:` は実行の名前に使えません。試していないので、ここまでにします。2 重に起動されても困らないことは、step の側で受け止めています。

### テストが見ていること

- 使っているリソースの種類が 9 つちょうどで、`Custom::` で始まるものがない
- 既定では durable function が無い。関数は 3 つで、`DurableConfig` を持つものがなく、version も alias もない
- bucket の公開の設定が 4 つとも閉じていて、`exports/` の下が 7 日で消える
- 3 つの関数の role の action が、上に書いたものちょうどである
- object への操作が `exports/` の下に限られ、一覧にも prefix の条件が付いている。素の `*` がどこにもない
- state machine の role にできるのが、3 つの関数の呼び出しだけである
- デプロイされる定義が、手元で動かしたものと同じ state を持ち、`Task` が 3 つの関数を指している
- どの `Task` の timeout も、指している関数の timeout より長い
- schedule の入力、間隔、role

9 種類（`AWS::DynamoDB::Table`、`AWS::IAM::Policy`、`AWS::IAM::Role`、`AWS::Lambda::Function`、`AWS::Logs::LogGroup`、`AWS::S3::Bucket`、`AWS::S3::BucketPolicy`、`AWS::Scheduler::Schedule`、`AWS::StepFunctions::StateMachine`）は、固定した版の cdkd がどれも専用の実装を持っています。install した package の中身で確かめました。

## デプロイして確かめる

<!-- section: 16.deploy -->

ここから先は、実行していません。手順とタスクを用意したところまでです。

```bash
vp run export:infra:diff
vp run export:infra:deploy
vp run export:seed --notes 250
vp run export:start --id check-1 --wait
vp run export:status
```

`export:seed` は、05章の repository を使って、table にノートを書きます。`export:start` は、schedule を待たずに export を 1 回起動します。`--wait` を付けると、終わるまで 5 秒おきに状態を見ます。`export:status` は、最近の実行と、bucket にある export を並べます。manifest があるか、part がいくつあるか、履歴が何イベントあるかが見えます。

同じ ID でもう一度 `export:start` を実行すると、`ExecutionAlreadyExists` で断られるはずです。こちらは名前を付けて起動しているからです。

失敗した実行を再開するには、`export:status` が表示する ARN を渡します。

```bash
vp run export:status --redrive <execution ARN>
vp run export:logs --function pages
```

schedule は、作られるとすぐに 1 回目を起動します。08章と同じで、開始日を指定していない rate の schedule は、そう動くとドキュメントにあります。デプロイした直後に、頼んでいない export が 1 つできます。

drift の検査は、これまでと同じです。

```bash
vp run export:infra:drift
```

## 同じものを durable function で書く

<!-- section: 16.durable -->

ここまでの workflow は、JSON でした。loop は `Choice` で、変数は state の入出力で、try と catch は `Retry` と `Catch` でした。「ふつうのコードで書けたら」と思った人は、多いはずです。

Lambda durable functions は、それをやる機能です。公式ドキュメントで確かめた範囲で、同じ export を書き直してみます。

<<< @/examples/16-long-jobs/src/durable-export.ts{durable}

`while` が loop で、`try` と `catch` が補償処理です。step の関数（`exportPages`、`finishExport`、`discardExport`）は、Step Functions 版と同じものを、1 文字も変えずに使っています。

### 最初から、もう一度

読んで最初に引っかかるのは、「15 分で止められる関数の中の `while` が、なぜ続きから再開できるのか」でしょう。

```figure
caption: 2 回目の呼び出しは最初の行から走り直し、checkpoint のある step は実行されずに結果だけが返る
type: sequence
actor lambda: Lambda | checkpoint
actor handler: handler
actor s3: S3
note lambda: invocation 1
step lambda -> handler: handler が始まる
step handler -> handler: pages-from-1 が走る
step handler -> lambda: その結果を checkpoint
step handler -> handler: pages-from-21 が走る
step handler -x lambda: checkpoint の前に sandbox が死ぬ
note lambda: invocation 2
step lambda -> handler: 最初の行からもう一度始まる
step lambda --> handler: pages-from-1 は走らず、保存した結果が返る
step handler -> handler: pages-from-21 がもう一度走る
step handler -x s3: part はもう S3 にあり、2 回は書かれない
step handler -> handler: pages-from-41 … finish が走る
step handler -> lambda: それぞれの結果を checkpoint
```

答えは、続きから再開していない、です。関数は、最初の行からもう一度実行されます。ただし、`context.step` に包んだ処理は、結果が保存されていれば実行されず、保存された結果が返ります。これが replay です。コードは最初から走り、済んだ step だけが早送りされます。

ここから、決まりが 2 つ出てきます。

**step の外は、何度走っても同じでなければいけない。** replay のたびに、step の外のコードは全部もう一度走ります。そこで時刻を読んだり、乱数を引いたりすると、1 回目と 2 回目で違う道を通ります。このコードで step の外にあるのは、入力の検証と、`while` の条件と、step の名前の組み立てだけです。どれも、保存された結果から決まります。

**step の中は、やっぱり冪等でなければいけない。** ドキュメントは、step の既定を at-least-once と説明しています。step が終わる前に中断されたら、replay でもう一度走ります。上の図の `pages-from-21` です。この章の step は、前半で作ったとおり、何度走っても同じ part しか残しません。durable function にしたからといって、あの作業が要らなくなるわけではありません。

SDK には、step を「高々 1 回」にする設定もあります。ただ、ドキュメントの説明は慎重で、「再試行 1 回につき高々 1 回」です。再試行を止めないかぎり、step 全体で 1 回とは言えません。名前から保証を読み取らないほうがよい、という例です。

### Step Functions との違い

| | Step Functions（Standard） | Lambda durable functions |
| --- | --- | --- |
| workflow を書く場所 | ASL（JSON） | 関数のコード |
| 進捗の持ち主 | Step Functions | Lambda |
| 1 つの step の上限 | 呼ぶ相手による。Lambda なら 15 分 | 1 回の呼び出しが 15 分 |
| 全体の上限 | 1 年、履歴 25,000 イベント | 1 年、durable operation 3,000 個、保存 100 MB |
| 権限の分け方 | step ごとに別の関数、別の role にできる | 1 つの関数、1 つの role |
| Lambda 以外を呼ぶ | 多くのサービスを定義から直接呼べる | コードから SDK で呼ぶ |
| 課金 | state transition | durable operation、書いた量、保持した量 |

この章の題材で、いちばん効いた違いは 5 行目でした。Step Functions 版では、ノートを読める関数と、object を消せる関数が別々でした。durable function 版では、1 つの role が両方を持ちます。

AWS 自身の説明は、こうです。ロジックがほとんど Lambda の中にあって、コードで書きたいなら durable functions。多くのサービスをまたいだり、流れを図で見せたかったりするなら Step Functions。両方を使う構成も勧めています。

### デプロイするなら

<<< @/examples/16-long-jobs/infra/bin/app.ts{context}

<<< @/examples/16-long-jobs/infra/lib/long-jobs-stack.ts{durable}

durable function 版は、既定の stack には入っていません。`-c durable=true` を付けたときだけ、関数が 1 つ増えます。

```bash
vp run export:infra:deploy -c durable=true
vp run export:durable:start --id check-1
```

ふつうの関数と違うところが 3 つあります。

`durableConfig` で、durable execution を有効にします。`executionTimeout` は実行全体の上限、`timeout` は 1 回の呼び出しの上限で、別の設定です。すでにある関数に後から付けると、関数の作り直しになります。CDK は synth のときに、そう知らせてきます。

実行 role に、checkpoint を読み書きする 2 つの権限が要ります。対象の書き方に癖があります。Lambda は、この 2 つを「実行」の ARN に対して検査します。実行の ARN は、version の付いた関数の ARN の先に続きます。なので、関数の ARN そのままでは一致しません。`:*` を付けます。

呼ぶときは、version か alias を付けます。素の関数名では呼べません。実行は、始めたときの version に固定されます。`$LATEST` で始めた実行は、途中でコードを差し替えると、新しいコードで replay されます。step の名前や順番を変えていたら、保存された結果と合わなくなります。

`Lambda::Version` と `Lambda::Alias` は、固定した版の cdkd に専用の実装がなく、Cloud Control API 経由になります。[20章](/ja/chapters/20-shipping.md)と同じです。

正直に言うと、こちらは Step Functions 版よりも確かめられていません。手元では、SDK に付いてくる実行器（`LocalDurableTestRunner`）でコードを動かして、step が失敗した後のやり直しで part が増えないことまでは見ました。東京リージョンで使えることは、Price List に東京の単価が載っていることから推測しているだけです。公式ドキュメントに、使えるリージョンの一覧は見つけられませんでした。

### Durable Objects とは別のもの

Cloudflare を使ってきた人は、名前で混乱すると思います。Lambda durable functions と、Cloudflare の Durable Objects は、名前が似ているだけで、別のものです。

Durable Objects は、ID ごとに 1 つだけ存在する object です。それぞれが自分専用の storage を持ち、1 本の thread で動きます。「この部屋」「この利用者」のような 1 つの ID の状態を、1 か所で順番に扱うための部品です。[14章](/ja/chapters/14-kv-cache.md)で、rate limit の置き場所として出てきました。

Lambda durable functions は、1 回の処理の進み具合を保存する仕組みです。ID ごとの状態を持ち続けるものではありません。実行が終われば、残るのは履歴だけで、それも保持期間が過ぎれば消えます。

Cloudflare の側で近いのは、Workflows です。`step.do` で step を包み、step の結果が保存され、失敗すれば再試行されます。公式ドキュメントの注意書きも、よく似ています。step は何度も再試行されうるので冪等に。workflow は休止してメモリ上の状態を失うことがあるので、状態は step の戻り値から組み立てる。乱数や時刻は step の中で。

違いもあります。Workflows の 1 つの step は、経過時間に上限がありません（CPU 時間には上限があります）。Lambda は、durable function でも、1 回の呼び出しが 15 分までです。step の数の上限は、Workflows が有料プランの既定で 10,000、durable functions が 3,000 です。Workflows の配送の保証や、同じ ID の instance を 2 重に作ろうとしたときの動きは、読んだページからは確かめられませんでした。

## Lambda に入らない step

<!-- section: 16.containers -->

ここまでは、仕事を 15 分より短く割れる前提でした。割れない仕事もあります。1 本の動画を変換する。大きなファイルを 1 つ圧縮する。途中で止めたら最初からになる仕事です。メモリが 10 GB では足りない仕事や、Lambda に入らない道具が要る仕事もあります。

そういう step は、コンテナで動かします。この章では、説明だけにします。コードは作っていません。

**ECS の task。** 12章の service は、task を「常に N 個」動かし続けるものでした。task は、1 回だけ動かして、終わったら消えるようにも使えます。Step Functions からは、`Task` の `Resource` を `arn:aws:states:::ecs:runTask.sync` にします。`.sync` を付けると、Step Functions は task が終わるまで待ってから、次の state に進みます。Lambda の 15 分は、ここにはかかりません。Fargate なら、動いた秒数ぶんの vCPU とメモリに課金されます。

変わるところが 3 つあります。task は戻り値を返しません。進捗は、S3 や DynamoDB に自分で書いて、次の state がそれを読みます。入力は、コンテナの環境変数や引数として渡します。そして、image が要ります。12章の決まり（tag は immutable、`fromAsset` を使わない、image の tag なしで時間課金のものを作らない）が、そのまま当てはまります。

冪等性の話は、変わりません。task も再試行されますし、Step Functions があきらめた後で動き続けることもあります。ドキュメントは、`.sync` の task を中止したとき、止められずに課金が続く場合がある、と書いています。

**AWS Batch。** コンテナの job を queue に積んで、順番に、必要なだけの計算資源を用意して実行するサービスです。中で動くのは ECS（や EKS）で、Fargate も使えます。1 つの長い step なら、ECS の task で足ります。Batch が効くのは、job が何千個もあって、優先順位を付けたり、Spot の instance で安く回したりしたいときです。Step Functions からは、`arn:aws:states:::batch:submitJob.sync` で呼べます。

選び方を 1 行ずつにすると、こうなります。

| 仕事 | 道具 |
| --- | --- |
| 15 分より短く割れて、step が Lambda で書ける | Step Functions と Lambda（この章）、または durable functions |
| 割れないが、1 つずつ動かせばよい | Step Functions から ECS の task |
| 割れない job が大量にあって、queue と計算資源の管理が要る | AWS Batch |
| 5 分以内に必ず終わり、数が非常に多い | Express workflow |

## お金の話

<!-- section: 16.cost -->

金額は USD、東京リージョン、従量課金、税別です。計算の入力と単価は[料金の計算](/ja/reference/pricing.md)にあります。

新しく出てくる単価は、Standard workflow の state transition です。1 回あたり USD 0.000025、1,000 回で 2.5 セント。毎月 4,000 回までは無料で、料金ページによると、この無料枠に期限はありません。再試行も redrive も、state transition として数えられます。

table に 1 KB のノートが 10,000 件あって、1 日 1 回 export する月を考えます。

| 構成 | 定価 | 無料枠を引いた後 |
| --- | --- | --- |
| ノートが 1 件もない（置いてあるだけ） | 0.00 | 0.00 |
| この章の既定（1 回の呼び出しで全ページ） | 0.03 | 0.02 |
| 1 ページごとに workflow に戻る | 0.18 | 0.07 |
| durable function 版 | 0.03 | 0.02 |
| 比較: 1 時間の step を、毎日 Fargate の task で | 0.52 | 0.52 |

どれも、小さな数字です。この規模の export は、ほとんどタダで動きます。見てほしいのは、2 行目と 3 行目の差です。

同じ仕事、同じ出力で、定価が 6 倍違います。違いは、state transition の数だけです。既定の構成は 1 回の実行で 6 回、月に 180 回。1 ページごとに戻る構成は、1 回の実行で 204 回、月に 6,120 回。無料枠の 4,000 回を超えます。checkpoint の粒度は、料金の設定でもあります。ノートが 100 倍になれば、3 行目の state transition も 100 倍になり、その前に 25,000 イベントの履歴の上限に当たります。

state transition の数は、料金ページの例の数え方に合わせた見積もりです。あの例は、state が 2 つの workflow を 4 回と数えています。開始と終了も 1 つずつ、という数え方です。実際の請求で確かめてはいません。

### 待つことの値段

長い処理には、待ち時間が付きものです。人の承認を待つ、外のサービスの完了を待つ、明日まで待つ。待っている間に何が課金されるかは、道具ごとに違います。

- **Standard workflow。** 課金は state transition の数だけです。`Wait` state で 1 日待っても、1 か月待っても、待つ前と後の遷移の数は同じです
- **Express workflow。** 実行の時間とメモリに課金されます。待てば、そのぶんかかります。そもそも 5 分までです
- **Lambda の関数の中で待つ。** `setTimeout` で待っている間も、関数は動いています。待った秒数が、そのまま請求されます
- **durable function の wait。** 関数は中断されて、待っている間の実行時間は課金されません。かかるのは、保存している checkpoint の量に応じた保持の料金です
- **Fargate の task の中で待つ。** task が動いている間は、何もしていなくても vCPU とメモリに課金されます

待つ仕事は、待っている間に計算資源を持たない道具に置く。これが原則です。

durable function の単価は、東京で、operation 1 個あたり USD 0.0000106、書いたデータ 1 GB あたり 0.33、保持 1 GB・月あたり 0.20 です。料金ページに、無料枠の記載は見つけられませんでした。表の 4 行目は、1 回の実行を operation 7 個と数えています。

stack を消すと、state machine も、関数も、schedule も消えて、この章のぶんの料金は止まります。

## ハマりどころ

| こうなったら | ここを見る |
| --- | --- |
| デプロイで、state machine の作成が role を引き受けられないと言って失敗する | role の信頼ポリシーの条件（`aws:SourceArn`）が、state machine の ARN の形と合っていますか。章末の「まだ確かめていないこと」も見てください |
| 実行が `ExportPages` で失敗して、エラーが `States.Runtime` や `States.DataLimitExceeded` | `States.ALL` は、この 2 つを再試行しません。関数が 256 KiB を超える値を返していませんか |
| `ExportPages` のログに 403 があり、3 回再試行して失敗する | role に `s3:PutObject` と `s3:GetObject` がありますか。412 の後の `HeadObject` は `s3:GetObject` で許可されます |
| 実行が成功したのに、ノートの件数が table と合わない | export の途中で書かれた、または消されたノートは、入ることも入らないこともあります。`Scan` は、ある瞬間の写しではありません |
| 実行が `ExportDiscarded` で終わる | part が、manifest を書く前に消えています。誰かが bucket を手で掃除したか、7 日より長くかかったか、同じ export の別の実行が `Discard` まで行ったか、です |
| `export:start` が `ExecutionAlreadyExists` と言う | 同じ ID で、もう起動しています。`--id` を変えてください。名前は、実行が終わってから 90 日間は再利用できません |
| redrive しても、すぐにまた失敗する | 原因は直しましたか。`Discarded` まで行った実行は、redrive しても `Fail` state に入り直すだけです |
| 実行がいつまでも `RUNNING` のまま | `Task` に `TimeoutSeconds` はありますか。この章の定義は、全体でも 6 時間で打ち切ります |
| durable function が、checkpoint の権限がないと言って失敗する | role の対象は `function:<名前>:*` ですか。`:*` のない関数の ARN は、実行の ARN に一致しません |
| durable function を呼ぶと、修飾子が要ると言われる | alias か version を付けて呼んでいますか。`export:durable:start` は alias の ARN を使います |

## 本番にするなら

- **失敗に気づけるようにする。** この章の workflow は、失敗しても誰にも知らせません。Step Functions は、実行の状態が変わると EventBridge にイベントを送ります。それを通知につなぐか、失敗した実行の数にアラームを付けます（[19章](/ja/chapters/19-observability.md)）
- **export を渡す経路を作る。** manifest と part を読んで、利用者に渡す API です。持ち主ごとに分けるなら、part を持ち主の prefix に書き分けるか、渡すときに絞ります。この章の export は、全員のノートが 1 つのファイルに混ざっています
- **整合性を決める。** 「始めた時点の全ノート」が要るなら、`Scan` では足りません。DynamoDB には、table を S3 に書き出す機能（export to S3）があって、point-in-time recovery を有効にした table の、ある時点の状態を取れます。この章では試していません
- **`Finish` と `Discard` の間の穴を閉じる。** 同じ export の実行が重ならないように、名前を付けて起動します。あるいは、`Discard` を「消す」ではなく「捨てた印を書く」に変えます
- **state machine のログを残す。** この章は、実行の履歴を Step Functions に任せています。90 日で消えます。CloudWatch Logs に送る設定（`LoggingConfiguration`）がありますが、この章では付けていません
- **履歴の上限を見る。** `export:status` が表示するイベント数が、25,000 に対してどのくらいか。近づくようなら、1 回の呼び出しで進む量を増やすか、実行を分けます
- **bucket と table を消えないようにする。** どちらも `RemovalPolicy.DESTROY` です。本物のノートが入る table は `RETAIN` にします
- **durable function を使うなら、version の運用を決める。** 動いている実行がある間に、step の名前や順番を変えない。変えるなら、新しい version として出して、古い実行が終わるのを待ちます

## 片付け

<!-- section: 16.cleanup -->

```bash
vp run export:empty --yes
vp run export:infra:destroy
```

bucket を先に空にします。固定した版の cdkd は、中身のある bucket を消さないからです。`export:empty` は、`--yes` を付けなければ、数えるだけです。

`export:infra:destroy` で、state machine、3 つの関数、schedule、bucket、table が消えます。動いている途中の実行があっても、state machine ごと消えます。`-c durable=true` でデプロイしたなら、消すときにも同じ指定を付けてください。

残るのは、cdkd の bootstrap で作った保存場所（[02章](/ja/chapters/02-toolchain.md)）と、そこに置かれたデプロイ用のファイルだけです。

::: details この章の検証メモ

**手元で確かめたこと。** step のテスト（同じ step の 2 回目、応答が失われた後に table が変わった場合、呼び出しの途中での書き込みの失敗、読み取りの失敗、止まっていた worker の遅れた書き込み、同じ export の 2 つの実行の重なり、checkpoint の大きさを変えても出力が同じこと、空の table）。manifest と補償処理のテスト（欠けた part、最後のページより前の `Finish`、2 回の `Finish`、途中で止まった `Discard` のやり直し、完成した export を消さないこと）。入力の検証（時刻からの ID、prefix の外に出る ID、壊れた進捗）。workflow の定義を手元の実行器で動かすテスト（応答の喪失、再試行の打ち切りと再開、最初からのやり直し、`ExportCorrupt` が再試行されずに `Discard` へ進むこと、`Discard` の再試行、定義の中の行き先がすべて存在すること）。S3 と DynamoDB へのリクエストの形と、412、409、404、403 の扱い。durable function 版を、SDK の `LocalDurableTestRunner` で動かすテスト（step の区切り、失敗した step のやり直し）。インフラの assertion（既定と `-c durable=true`）。型検査と、両方の構成での synth。それから、条件を 2 か所わざと壊して、どちらもテストが 2 つ落ちることを確かめました。`export:local` を、既定、`--notes 450 --lose 2 --break 4`、`--notes 1000 --pages-per-call 20` の 3 通りで実行しました。

**まだ確かめていないこと。** AWS に対しては、何も実行していません。`export:infra:diff`、`export:infra:deploy`、`export:seed`、`export:start`、`export:status`、`export:logs`、`export:infra:drift`、`export:empty`、`export:infra:destroy`、`export:durable:start` のどれもです。したがって、次は実物で確かめていません。cdkd が、`Fn::Join` で組み立てた `DefinitionString` から state machine を作れること。state machine の role の信頼ポリシーの条件が通ること。Scheduler が `<aws.scheduler.scheduled-time>` を置き換えた入力で `StartExecution` を呼ぶこと、そのとき実行に名前が付くかどうか。関数の ARN を `Resource` に書いた `Task` の入出力の形。Lambda の例外の `name` が `Catch` の `ExportCorrupt` に一致すること。S3 が `If-None-Match: *` に 412 を返し、固定した版の SDK がそれを status 412 の例外として投げること。`HeadObject` が metadata の key を小文字で返すこと。`Task` の timeout の後も関数が動き続けるかどうか。state transition と履歴のイベントの実際の数。redrive の動き。`Scan` の読み取り unit と、関数の実行時間（料金の例の 200 ミリ秒と 20 秒は仮定です）。durable function については、東京リージョンで使えること、cdkd で `DurableConfig` つきの関数と version、alias を作れること、role の権限が足りること、bundle した SDK が Lambda の上で動くこと、`DurableExecutionName` が 2 重の起動を防ぐこと、1 回の呼び出しが関数の timeout に当たったときの動き、durable operation の実際の数。ECS の task と AWS Batch は、説明だけで、コードがありません。Express workflow は、ドキュメントを読んだだけです。Cloudflare Workflows も、ドキュメントを読んだだけで、動かしていません。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 全体像 | `examples/16-long-jobs/infra/lib/long-jobs-stack.ts`、`src/workflow.ts` | - |
| 仕事を割る | `examples/16-long-jobs/src/job.ts`、`src/note-source.ts`、`src/dynamodb-note-source.ts`、`test/adapters.test.ts` | `test:unit` |
| step は 2 回走る | `examples/16-long-jobs/src/steps.ts`、`src/export-store.ts`、`src/s3-export-store.ts`、`test/steps.test.ts`、`test/harness.ts`、`test/adapters.test.ts` | `test:unit` |
| 最後の 1 個で、見えるようにする | `examples/16-long-jobs/src/steps.ts`、`src/job.ts`、`test/steps.test.ts` | `test:unit` |
| 順番は、workflow に任せる | `examples/16-long-jobs/src/workflow.ts`、`test/workflow.test.ts` | `test:unit` |
| checkpoint の粒度 | `examples/16-long-jobs/src/steps.ts`、`src/export-pages-lambda.ts`、`src/env.ts`、`test/steps.test.ts` | `test:unit` |
| 手元で動かす | `examples/16-long-jobs/src/local-workflow.ts`、`src/local.ts`、`scripts/run-local.ts`、`test/workflow.test.ts` | `export:local`、`test:unit` |
| AWS にのせる準備 | `examples/16-long-jobs/infra/lib/long-jobs-stack.ts`、`infra/bin/app.ts`、`infra/test/long-jobs-stack.test.ts`、`src/finish-lambda.ts`、`src/discard-lambda.ts`、`cdk.json` | `export:infra:synth`、`test:unit` |
| デプロイして確かめる | `examples/16-long-jobs/scripts/seed.ts`、`scripts/start.ts`、`scripts/status.ts`、`scripts/logs.ts` | `export:infra:diff`、`export:infra:deploy`、`export:seed`、`export:start`、`export:status`、`export:logs`、`export:infra:drift` |
| 同じものを durable function で書く | `examples/16-long-jobs/src/durable-export.ts`、`src/durable-lambda.ts`、`test/durable.test.ts`、`scripts/durable-start.ts`、`infra/lib/long-jobs-stack.ts` | `test:unit`、`export:durable:start` |
| Lambda に入らない step | （コードなし） | - |
| お金の話 | `data/pricing/` | `test:unit` |
| 片付け | `examples/16-long-jobs/scripts/empty.ts` | `export:empty`、`export:infra:destroy` |

**一次情報**（確認日はすべて 2026-10-12）

- Step Functions: [Choosing workflow type](https://docs.aws.amazon.com/step-functions/latest/dg/choosing-workflow-type.html)、[Handling errors](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html)、[Task workflow state](https://docs.aws.amazon.com/step-functions/latest/dg/state-task.html)、[Invoke an AWS Lambda function](https://docs.aws.amazon.com/step-functions/latest/dg/connect-lambda.html)、[Handling error conditions（チュートリアル）](https://docs.aws.amazon.com/step-functions/latest/dg/tutorial-handling-error-conditions.html)、[ResultPath](https://docs.aws.amazon.com/step-functions/latest/dg/input-output-resultpath.html)、[Redrive](https://docs.aws.amazon.com/step-functions/latest/dg/redrive-executions.html)、[Service quotas](https://docs.aws.amazon.com/step-functions/latest/dg/service-quotas.html)、[Best practices](https://docs.aws.amazon.com/step-functions/latest/dg/sfn-best-practices.html)、[Creating an IAM role for your state machine](https://docs.aws.amazon.com/step-functions/latest/dg/procedure-create-iam-role.html)、[Run Amazon ECS or Fargate tasks](https://docs.aws.amazon.com/step-functions/latest/dg/connect-ecs.html)、[Service integration patterns](https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html)、[EventBridge への連携](https://docs.aws.amazon.com/step-functions/latest/dg/eventbridge-integration.html)、[StartExecution](https://docs.aws.amazon.com/step-functions/latest/apireference/API_StartExecution.html)、[AWS::StepFunctions::StateMachine](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-stepfunctions-statemachine.html)
- Lambda durable functions: [Lambda durable functions](https://docs.aws.amazon.com/lambda/latest/dg/durable-functions.html)、[Basic concepts](https://docs.aws.amazon.com/lambda/latest/dg/durable-basic-concepts.html)、[Idempotency](https://docs.aws.amazon.com/lambda/latest/dg/durable-execution-idempotency.html)、[Invoking](https://docs.aws.amazon.com/lambda/latest/dg/durable-invoking.html)、[Security and permissions](https://docs.aws.amazon.com/lambda/latest/dg/durable-security.html)、[Infrastructure as Code](https://docs.aws.amazon.com/lambda/latest/dg/durable-getting-started-iac.html)、[Supported runtimes](https://docs.aws.amazon.com/lambda/latest/dg/durable-supported-runtimes.html)、[Durable execution SDK（metering）](https://docs.aws.amazon.com/lambda/latest/dg/durable-execution-sdk.html)、[Durable functions or Step Functions](https://docs.aws.amazon.com/lambda/latest/dg/durable-step-functions.html)、[Best practices](https://docs.aws.amazon.com/lambda/latest/dg/durable-best-practices.html)
- AWS Durable Execution SDK Developer Guide: [Key concepts](https://docs.aws.amazon.com/durable-execution/getting-started/key-concepts/)、[Idempotency and retries](https://docs.aws.amazon.com/durable-execution/patterns/best-practices/idempotency/)。[@aws/durable-execution-sdk-js 2.6.0](https://www.npmjs.com/package/@aws/durable-execution-sdk-js/v/2.6.0)（README と型定義）
- Lambda: [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)、[Node.js の context object](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-context.html)
- EventBridge Scheduler: [Adding context attributes](https://docs.aws.amazon.com/scheduler/latest/UserGuide/managing-schedule-context-attributes.html)、[Using templated targets](https://docs.aws.amazon.com/scheduler/latest/UserGuide/managing-targets-templated.html)、[What is Amazon EventBridge Scheduler?](https://docs.aws.amazon.com/scheduler/latest/UserGuide/what-is-scheduler.html)
- S3 と DynamoDB: [Conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)、[HeadObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html)、[Scanning tables in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Scan.html)、[DynamoDB data export to Amazon S3](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/S3DataExport.HowItWorks.html)
- AWS Batch: [What is AWS Batch?](https://docs.aws.amazon.com/batch/latest/userguide/what-is-batch.html)、[Fargate compute environments](https://docs.aws.amazon.com/batch/latest/userguide/fargate.html)
- 料金: [AWS Step Functions pricing](https://aws.amazon.com/step-functions/pricing/)、[AWS Lambda pricing](https://aws.amazon.com/lambda/pricing/)、AWS Price List bulk API: [Step Functions](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonStates/current/ap-northeast-1/index.json)、[Lambda](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/ap-northeast-1/index.json)
- Cloudflare: [What are Durable Objects?](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/)、[Workflows](https://developers.cloudflare.com/workflows/)、[Rules of Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)、[Workflows: Limits](https://developers.cloudflare.com/workflows/reference/limits/)、[Workflows: Pricing](https://developers.cloudflare.com/workflows/reference/pricing/)
- [cdkd v0.296.28 の register-providers.ts](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts)（install した package の dist で確認）、[@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)、[aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0)

:::
