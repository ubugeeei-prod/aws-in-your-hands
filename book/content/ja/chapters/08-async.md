---
title: "08 リクエストの外で処理する: SQS、DLQ、冪等性、Scheduler"
revision: 1
---

# 08 リクエストの外で処理する: SQS、DLQ、冪等性、Scheduler

ノートに画像を付けられるようになりました。ただ、[07章](/ja/chapters/07-uploads.md)は宿題を 3 つ残しています。アップロードされたファイルの中身を、誰も見ていないこと。孤立した object の掃除が、手で実行するタスクのままなこと。そして、完了した後に同じ form をもう一度送ると、添付した画像が 1 日後に消えてしまうこと。

この章では、利用者のリクエストの外で動く処理を 2 つ足して、3 つとも片付けます。1 つは、アップロードのたびに動いて画像の中身を確かめる worker。もう 1 つは、1 時間ごとに動く掃除です。

話の中心は、道具の使い方よりも、その先にあります。queue を通ったメッセージは、2 回届くことがあります。順序が入れ替わることも、処理の途中で worker が落ちることもあります。それでも結果が 1 つになるように作る。この章のほとんどは、その話です。

前提は 07章です。コードは `examples/08-async/` にあります。アップロードの API も画面も 07章のものをそのまま import して使うので、この章で書くのは増えるところだけです。

## 全体像

<!-- section: 08.architecture -->

```text
Browser
  |  POST form to S3 (chapter 07)            DELETE /notes/{id}/attachments/{attachmentId} (chapter 07)
  v                                                   |
S3 bucket "Uploads"  <--------------------------------+
  |  event notification for keys under u/:
  |    ObjectCreated:*, ObjectRemoved:Delete, LifecycleExpiration:Delete
  |  at least once, in no guaranteed order, usually within seconds
  v
SQS queue "UploadEvents" (standard, visibility timeout 180 s, kept 4 days)
  |      \
  |       received 5 times and never deleted --> SQS queue "DeadLetters" (kept 14 days)
  v
Lambda event source mapping (up to 10 messages a batch, at most 2 batches at once)
  v
Lambda function "Worker" (timeout 30 s)
     1. GetObject, If-Match <eTag of the event>        -> S3
     2. look at the first bytes: type, width, height
     3. PutItem INSPECTION#..., only if newer          -> DynamoDB table (the notes table)
     4. DeleteObjectTagging, if ATTACHMENT#... exists  -> S3

EventBridge Scheduler "aih-async-housekeeping": rate(1 hour)
  |  assumes "ScheduleRole", invokes asynchronously
  v
Lambda function "Housekeeping" (timeout 15 min)
     lists the bucket, reads the table, and deletes what nothing points at
     or what failed the inspection; takes the pending tag off attached images
```

新しく出てくるのは、queue が 2 つ、関数が 2 つ、schedule が 1 つです。bucket と table は 07章のものを使います。

図の上半分は、イベントで動きます。画像が置かれるたび、消されるたびに、S3 が queue にメッセージを入れて、Lambda がそれを worker に渡します。下半分は、時計で動きます。イベントが来ても来なくても、1 時間ごとに bucket と table を見比べます。この 2 つを両方持つ理由は、あとで出てきます。

### なぜ、完了のリクエストの中でやらないのか

07章の「完了」（`PUT /notes/{id}/attachments/{attachmentId}`）の中で、ついでに画像を読んで確かめる。それがいちばん素直ですよね。でも、やりません。

完了のリクエストは、利用者が待っています。そこで画像を S3 から読むと、最大 5 MB を読み終わるまで応答が返りません。途中で失敗したら、利用者に「もう一度」と言うことになります。それに、完了を呼ばれなかったアップロードは、誰にも確かめられないままです。

リクエストの外に出すと、利用者は待たなくて済みます。失敗しても、利用者の知らないところでやり直せます。そのかわり、新しい問題を引き受けます。「いつ終わるかわからない」「同じ仕事が 2 回走るかもしれない」。この章の残りは、その引き受け方です。

### サムネイルではなく、検査にした

章のアウトラインでは、ここでサムネイルを作る予定でした。変えました。理由を書いておきます。

画像を縮小するには、画像を decode して encode するライブラリが要ります。よく使われるものは、OS と CPU ごとに違う native のコードを含みます。この本の Lambda は arm64 で動いていて、関数のコードは synth のときに esbuild で 1 つにまとめています。native のコードは、そのままではまとまりません。Docker の中でビルドするか、Lambda layer を別に用意することになり、章の主題から遠い話が増えます。

そこで、worker の仕事を軽くしました。ファイルの先頭を読んで、本当に画像かどうか、縦横が何ピクセルかを確かめて、記録するだけです。decode はしません。07章が「S3 は中身を見ない」と書いて残した宿題が、ちょうどこれでした。

queue、再試行、冪等性の話は、worker の中身がサムネイルでも検査でも同じです。

### 07章の stack に足す

stack（`AihAsync`）は、07章の `UploadsStack` を継承して、増えるものだけを書いています。07章の stack（`AihUploads`）とは別の stack なので、両方をデプロイすると、bucket も table も利用者も別々になります。

## 画像の中身を見る

<!-- section: 08.inspect -->

まず、worker の仕事の中身から。ここには AWS が出てきません。bytes を受け取って、判定を返すだけの関数です。

<<< @/examples/08-async/src/inspect.ts{sniff}

画像のファイルは、先頭の数バイトで種類がわかるように作られています。PNG は決まった 8 バイトで始まります。GIF は `GIF87a` か `GIF89a`、JPEG は `FF D8`、WebP は `RIFF` と `WEBP` です。縦横の大きさも、ファイルの前のほうに書いてあります。全体を decode しなくても読めます。

JPEG だけ、少し手間がかかります。大きさが書いてある場所（frame header）の前に、撮影情報（EXIF）などの塊がいくつも並ぶことがあるので、塊を 1 つずつ飛ばしながら探します。

<<< @/examples/08-async/src/inspect.ts{judge}

判定は 3 つの理由で「だめ」を返します。

- 4 つの画像形式のどれでもない（`image/png` と名乗る HTML など）
- 画像ではあるが、名乗った種類と違う
- 画像ではあるが、ピクセル数が多すぎる

最後のは、見落としやすいところです。5 MB のファイルでも、「縦 6 万、横 6 万」と名乗ることはできます。あとでこの画像を decode する処理（ブラウザ、いつか足すサムネイル生成）は、名乗られた大きさのぶんのメモリを確保しようとします。上限は 4,000 万ピクセルにしました。

テストは、手で打った bytes ではなく、実際の encoder（macOS の `sips` と、`cwebp`）が書いた 3×2 ピクセルのファイルを読ませています。JPEG のファイルには、frame header の前に EXIF が入っています。

結果は、こういう記録になります。

<<< @/examples/08-async/src/inspection.ts{record}

`sequencer` と `eTag` は、「どのイベントの、どの bytes を見たのか」を表します。これが、後半の主役です。

## 「1 回だけ届く」とは、誰も言っていない

<!-- section: 08.delivery -->

画像が bucket に置かれてから worker が動くまでに、メッセージは 3 つのサービスを通ります。それぞれの公式ドキュメントが何を約束しているか、先に並べます。

- **S3 のイベント通知**は、少なくとも 1 回届くように設計されている。起きた順に届く保証はない。まれに、同じイベントが重複して届く。ふつうは数秒で届くが、1 分以上かかることもある
- **SQS の標準 queue**は、少なくとも 1 回届ける。メッセージの複製が 2 つ以上届くことがあり、順序が入れ替わることもある
- **Lambda の event source mapping**は、各イベントを少なくとも 1 回処理する。重複して処理することがある

3 つとも「少なくとも 1 回」です。「ちょうど 1 回」は、どこにも書いてありません。SQS のドキュメントは、アプリケーションを idempotent（同じメッセージを 2 回処理しても困らない）に作るように、とはっきり書いています。Lambda のドキュメントも同じことを「強く勧める」と書いています。

なお、SQS には FIFO queue という別の種類があって、そちらは重複を取り除く仕組みを持っています。ただ、S3 のイベント通知は FIFO queue に送れません。それに、queue が重複を取り除いても、worker が処理の途中で落ちれば、同じメッセージはもう一度渡されます。

### 受け取っても、消えない

SQS のメッセージは、受け取っただけでは queue から消えません。隠されるだけです。

```text
time    queue "UploadEvents"                      worker A               worker B
t0      message M is visible
t1      M is received: hidden for 180 s           starts on M
t2                                                still running, or gone
t1+180  M is visible again
t3      M is received again (receive count 2)                            starts on M
        ...
        received 5 times and never deleted: the next receive moves M to "DeadLetters"
```

隠されている時間が visibility timeout です。その間に「終わりました」（削除）が届かなければ、メッセージはまた見えるようになって、次の誰かに渡されます。worker が落ちても、メッセージは失われません。

裏を返すと、t3 の時点で worker A がまだ動いていたら、同じメッセージを 2 つの worker が同時に処理しています。queue は、約束したとおりに動いているだけです。「隠している間は他の誰にも渡さない」ことさえ、SQS のドキュメントは標準 queue について保証していません。

この章の visibility timeout は 180 秒、worker の timeout は 30 秒です。Lambda のドキュメントが「queue の visibility timeout を、関数の timeout の少なくとも 6 倍に」と勧めているので、そのとおりにしました。

### メッセージを読む

queue から来るメッセージの本文は、S3 が書いた JSON です。型の外から来る値なので、schema に通します。

<<< @/examples/08-async/src/events.ts{schema}

<<< @/examples/08-async/src/events.ts{parse}

気をつけるところが 3 つあります。どれも公式ドキュメントに書いてあって、どれも忘れやすいです。

**test event が届く。** 通知を設定すると、S3 は `s3:TestEvent` というメッセージを 1 つ送ってきます。形がふつうのイベントと違って、`Records` がありません。これを「読めないメッセージ」として失敗させると、デプロイした直後に dead-letter queue に 1 件入ることになります。

**key は encode されている。** イベントの中の object key は、URL encode されています。空白は `+` です。この章の key は英数字とハイフンと `/` だけなので実害はありませんが、decode してから使います。

**sequencer がないかもしれない。** sequencer は、イベントの順序を知るための値です（次の節で使います）。ドキュメントは「PUT と DELETE のリクエストでだけ使われる」と書いています。作成のイベントに付いていなければ、worker はそのメッセージを失敗にします。順序がわからないイベントを、勘で処理しないためです。

正直に言うと、ここは実機で確かめられていません。この章のアップロードは form による POST です。POST で作られた object のイベントに sequencer が入るかどうかは、ドキュメントからは読み取れませんでした。確かめる手順は章末のメモにあります。

### 10 件のうち 1 件だけ失敗したら

Lambda は、queue から最大 10 件をまとめて読んで、worker を 1 回呼びます。何も設定しなければ、worker が例外を投げたとき、10 件全部が queue に戻ります。成功した 9 件も、もう一度処理されます。

それを避けるのが partial batch response です。event source mapping に `ReportBatchItemFailures` を設定すると、worker は「失敗したのはこの ID のメッセージだけ」と返せます。

<<< @/examples/08-async/src/worker.ts{batch}

メッセージごとに `try` で囲んで、失敗したものの ID だけを集めて返します。Lambda は、そこに名前のないメッセージを queue から消します。

返し方には、決まりがあります。空の一覧を返すと、全部成功です。関数が例外を投げると、全部失敗です。そして、返した ID が batch の中にないものだったり、空文字だったりすると、やはり全部失敗の扱いになります。「失敗を報告したつもりが、形を間違えていて、全部がやり直しになっていた」は、起きます。テストは、worker が返す形を固定しています。

### 何度やってもだめなメッセージ

本文が JSON ですらないメッセージは、何度渡されても処理できません。放っておくと、visibility timeout のたびに戻ってきて、worker を呼び続けます。

そこで、queue に「5 回受け取られても削除されなかったメッセージは、別の queue によける」という規則（redrive policy）を付けます。よける先が dead-letter queue（DLQ）です。5 という数は、Lambda のドキュメントが勧める下限です。

worker は、読めないメッセージを黙って捨てません。わざと失敗として報告して、DLQ まで行かせます。捨ててしまえば、何かがおかしいことに誰も気づけないからです。DLQ は、人が見るための場所です。

DLQ の保持期間は 14 日、元の queue は 4 日にしました。標準 queue では、メッセージの期限は最初に queue に入った時刻から数えます。DLQ に移っても数え直されません。DLQ の保持期間が元の queue と同じだと、移ってきたメッセージは、見る前に消えてしまいます。

## 2 回届いても、結果は 1 つ

<!-- section: 08.idempotency -->

ここからが本題です。守ることを、先に 1 文で書きます。

**1 つの object key に対して、検査の記録は高々 1 つで、それは worker が処理した中でいちばん新しい作成イベントのものである。同じイベントがもう一度届いても、古いイベントが後から届いても、2 つの worker が同時に同じイベントを持っても、変わらない。**

「SQS を使っているから、1 回しか処理されない」とは言えません。前の節のとおりです。1 回分の結果しか残らないようにするのは、worker の側の仕事です。

### 「同じ仕事」を、何で見分けるか

2 回目の配送を見分けるには、「これは前に見た仕事だ」と言える値が要ります。冪等性の鍵（idempotency key）です。

すぐ思いつくのは、SQS のメッセージ ID です。でも、これは使えません。メッセージ ID は「配送」の名前であって、「仕事」の名前ではないからです。

- S3 が同じイベントを 2 回送ったら、SQS には別々のメッセージとして入る。ID は 2 つ
- DLQ から元の queue に戻したメッセージは、新しいメッセージとして扱われて、新しい ID が付く

どちらも、中身は同じ仕事です。鍵は、仕事の中身から取らなければいけません。

この章の鍵は、object key と sequencer の組です。sequencer は、S3 が作成と削除のイベントに付ける 16 進の文字列で、同じ key のイベントどうしなら、大きいほうが後に起きたものです。AWS のブログ記事によると、重複して届いた通知は、同じ sequencer を持っています。

<<< @/examples/08-async/src/sequencer.ts{sequencer}

sequencer は、長さが揃っていないことがあります。公式ドキュメントは、比べる前に短いほうの左を 0 で埋めるように、と書いています。この関数は、すべてを同じ長さの大文字に揃えます。揃えておくと、ふつうの文字列の比較がそのまま順序の比較になります。DynamoDB の条件式ができる比較は、それだけです。

### 「このイベントの bytes」を読む

worker がイベントを受け取ってから object を読むまでの間に、object は置き換えられているかもしれません。同じ key に、別の bytes が入っている。それを読んで「このイベントの結果」として記録すると、記録と中身がずれます。

<<< @/examples/08-async/src/object-reader.ts{port}

<<< @/examples/08-async/src/s3-object-reader.ts{read}

イベントには、そのとき置かれた object の ETag が入っています。`GetObject` に `If-Match` でその ETag を付けると、S3 は、いまの object がそれと同じときだけ中身を返します。違えば 412 です。「いま、この key にあるもの」ではなく、「このイベントが言っている、あの bytes」を読めます。

412 が返ったら、worker は何もしません。置き換えた側の作成イベントが別にあって、そちらが処理するからです。404（もう無い）のときも同じです。

`Range` は、読む量の上限です。アップロードの上限（5 MB）より多くは読みません。この key に、form を通らずに大きな object が置かれたとしても、関数のメモリを使い切らないためです。

### 手順と、その順序

<<< @/examples/08-async/src/worker.ts{handle-event}

作成イベント 1 つの処理は、4 つの手順です。どこで止まっても困らない順に並べてあります。

```text
one create event (key K, sequencer S, ETag E)         if the worker stops right after this step
  1. GetObject K, If-Match E                           nothing has changed
  2. judge the bytes (no request to anything)          nothing has changed
  3. PutItem INSPECTION#K, only if absent or older     the record is written; a retry finds it and writes nothing
  4. DeleteObjectTagging K, if ATTACHMENT#K exists     everything is done
  (Lambda deletes the message)                         the message comes back; steps 1 to 4 run again and change nothing

never, in any order of deliveries:
  two records for K, or a record from an older event replacing one from a newer event
```

1 と 2 は、読むだけです。何度やっても、何も変わりません。書き込みは 3 が最初で、それには条件が付いています。

<<< @/examples/08-async/src/dynamodb-inspection-repository.ts{put-if-newer}

「この key の記録がまだ無いか、あっても sequencer がこれより小さいときだけ書く」。[05章](/ja/chapters/05-dynamodb.md)の楽観ロックと同じで、DynamoDB は条件の検査と書き込みを 1 つの手順として実行します。2 つの worker が同じイベントを同時に持っていても、両方が検査を通ることはありません。古いイベントが後から来ても、新しい記録を上書きできません。

条件で弾かれたとき、worker は失敗を返しません。「もう済んでいる」は、成功です。ここで失敗を返すと、メッセージは queue に戻って、5 回弾かれて、DLQ に入ります。何も壊れていないのに。

記録は、07章と同じ table の、同じ持ち主の partition に置いています。

<<< @/examples/08-async/src/dynamodb-inspection-repository.ts{keys}

### 「記録がある」を、飛ばす理由にしない

手順 4 は、07章の穴を閉じるためのものです。

思い出しておきましょう。presigned な form は、期限（5 分）までは何度でも使えます。完了した後に同じ form をもう一度送ると、S3 は object を置き換えて、`upload-state=pending` の tag をもう一度付けます。添付の記録はあるのに、object は 1 日後に lifecycle rule に消される。

でも、置き換えは「作成」です。S3 はイベントを送ってきます。worker は、検査を記録したあとで、その key に添付の記録があるかを見ます。あれば、tag を外します。数秒後には、元どおりです。

さて、この手順 4 の位置に、落とし穴があります。3 の直後、4 の前に worker が落ちたとします。メッセージは戻ってきます。2 回目の worker は、3 で「もう記録がある」と知ります。

ここで `return` してしまうと、tag は永遠に外れません。1 回目は 4 にたどり着かず、2 回目は 4 を飛ばしたからです。

なので、worker は 3 の結果がどちらでも、4 に進みます。4 は、何度やっても結果が同じ操作（tag を外す）なので、やり直して困ることはありません。「処理済みの印がある」ことと、「処理がすべて終わっている」ことは、別です。印を書いた後に続きがあるなら、印を見て続きを飛ばしてはいけません。

別のやり方もあります。印を、すべてが終わった後に書くこと。あるいは、印と残りの書き込みを 1 つの transaction に入れること。後者は、全部が同じ DynamoDB の table への書き込みなら使えます。この章の 4 は S3 への操作なので、使えません。

### 順序を決めて、壊しにいく

テストは、メッセージが届く順序と、worker が止まる場所を 1 つずつ固定して、そのあとの記録を見ます。メッセージを直接 worker の関数に渡しているので、queue も、時計も、乱数も要りません。

| 注入すること | 結果 |
| --- | --- |
| 同じメッセージを 2 回渡す | 2 回目は何も書かない。記録は時刻まで同じ |
| 同じイベントを、別の ID の 2 つのメッセージで渡す | 記録は 1 つ |
| worker A が書く直前で止まっている間に、同じメッセージを worker B に渡す | B が書く。A は再開しても何も書かず、失敗も返さない |
| 置き換えの後、新しいイベント、古いイベントの順に渡す | 古いほうは 412 で何もしない。記録は新しいほう |
| 同じ bytes で置き換えた後、新しいイベント、古いイベントの順に渡す | 古いほうは読めるが、条件で弾かれる |
| 削除のイベントを、作成のイベントより先に渡す | 記録は残らない |
| 削除、再作成の後、再作成のイベント、削除のイベントの順に渡す | 遅れてきた削除は、新しい記録を消さない |
| 記録の書き込みを失敗させる | 記録なし。再配送で 1 つできる |
| 記録を書いた後、tag を外すところで失敗させる | 記録あり、tag は付いたまま。再配送で tag が外れる |

3 行目は、visibility timeout が切れて二重に実行される場合です。テスト用の細工で、worker A の書き込みを「合図があるまで待つ」ようにして、その間に B を最後まで走らせています。

削除のイベントも扱っているのは、記録を残さないためです。object が消えたら、検査の記録も消します。ここでも sequencer が効きます。7 行目を見てください。遅れてきた削除のイベントを素直に実行すると、その後に置かれた object の記録を消してしまいます。「この削除より古い記録だけを消す」という条件が、それを防いでいます。

コードのほうをわざと 2 か所壊して（手順 4 を「書けたときだけ」にする、同じ sequencer でも書けるようにする）、上の表のテストが 4 つ落ちることも確かめました。

### 残っている穴

閉じていないところを、書いておきます。

検査の記録が、object のないまま残る経路が 2 つあります。1 つは、worker A が作成イベントの手順 3 の直前にいるとき、worker B が同じ key の削除イベントを処理し終えた場合。B が見たときには記録がまだ無いので、何も消しません。そのあと A が書きます。もう 1 つは、lifecycle rule による削除です。この通知（`LifecycleExpiration:Delete`）に sequencer が入るかどうかを、確かめられていません。入っていなければ、worker は何もしません。順序がわからない削除で記録を消すより、古い記録が残るほうを選びました。

どちらも、利用者には見えません。検査の記録は、添付の記録がなければ誰にも読まれないからです。困るのは、table に小さな行が残ることだけです。閉じるには、削除のときに記録を消すかわりに、sequencer を持った「消えた」という印（tombstone）を同じ条件で書いて、DynamoDB の TTL で片付けます。この章では実装していません。

それから、05章が記録していた「作成の再試行でノートが 2 件できる」問題。同じ形の問題です。呼び出し側が「同じ依頼である」ことを示す値（`Idempotency-Key` のようなヘッダー）を送って、サーバーがそれを鍵に条件付きで書けば直ります。考え方はこの節と同じですが、この章では直していません。

## 時計で動かす掃除

<!-- section: 08.housekeeping -->

イベントで動く worker は、速いです。でも、イベントが来なければ動きません。通知が 1 分遅れることもあれば、メッセージが DLQ に入ったまま誰にも気づかれないこともあります。

なので、イベントを待たない処理を、もう 1 つ持ちます。bucket と table の「いまの中身」を見比べて、ずれていたら直す。突き合わせ（reconciliation）と呼ばれるやり方です。イベントは「早く直す」ための合図で、「必ず直る」を受け持つのは突き合わせのほうです。

<<< @/examples/08-async/src/housekeeping.ts{housekeeping}

掃除の関数は、3 つのことをします。

1 つ目は、07章の掃除（`sweep`）そのものです。添付の記録もノートもない object を消します。07章の関数を、変えずに呼んでいます。

2 つ目は、検査で「だめ」と判定された添付を消すこと。順序は 07章の削除と同じで、記録が先、object が後です。worker が判定した時点ですぐ消さないのは、わざとです。アップロードされたばかりの object には、完了のリクエストがまだ来るかもしれません。07章は、その衝突を「1 時間より新しい object には触らない」という時間の区切りで避けていました。消す処理はすべて、その区切りの向こう側に置きます。

ここで、判定が「いまの object」のものかを確かめています。判定の時刻が、object の更新時刻より前なら、その判定は置き換えられる前の bytes についてのものです。使いません。

3 つ目は、添付されている画像の pending の tag を、もう一度外すこと。worker の手順 4 と同じことを、イベントに頼らずにやります。lifecycle rule が pending の object を消すのは、早くても作成の 1 日後です。1 時間ごとに動く掃除は、それまでに 20 回以上、同じ object を通ります。

手順 4 だけでは、ごく狭い隙間が残ります。完了の処理が tag を外してから添付の記録を書くまでの間に form が再送されて、しかもその通知を、記録が書かれる前に worker が処理した場合です。3 つ目の仕事は、その隙間もふさぎます。

### 何度動いても、重なっても

掃除は、時刻も入力も受け取りません。何を消すかは、毎回 bucket と table から読みます。だから、2 回続けて動いても、2 つが同時に動いても、途中で止まっても、行き着く状態は同じです。テストは、その 3 つを確かめています。途中で止まった場合（記録を消して、object を消す前に落ちる）は、次の回に 07章の掃除が「記録のない object」として拾います。

<<< @/examples/08-async/src/housekeeping-lambda.ts{handler}

これを 1 時間ごとに起動するのが、EventBridge Scheduler です。公式ドキュメントによると、Scheduler は target への配送を「少なくとも 1 回」保証します。ここでも、2 回届くことはありえます。掃除が重なっても困らない作りなのは、そのためでもあります。

Scheduler は、Lambda 関数を非同期に呼びます。非同期の呼び出しでは、関数が失敗すると Lambda が自分で 2 回までやり直します（[15章](/ja/chapters/15-email.md)でもう一度出てきます）。掃除では、これを 0 回にしました。失敗した回をやり直さなくても、1 時間後に次の回が動くからです。

手元から、何が消されるかを先に見ることもできます。07章の `uploads:sweep` と同じ使い方です。

```bash
vp run async:housekeeping
vp run async:housekeeping --delete
```

こちらは、あなたの認証情報で動きます。デプロイされた関数は、自分の role で動きます。

1 つ、先に言っておくことがあります。この掃除は、動くたびに bucket の全部の object を見ます。置いてある枚数に比例して、時間も料金もかかります。数字は「お金の話」に書きました。

## 手元で動かす

<!-- section: 08.local -->

`examples/08-async/.env.example` を、同じ場所に `.env` という名前でコピーします。

<<< @/examples/08-async/.env.example

ターミナルを 2 つ使います。画面は 07章のものです。

```bash
vp run dev:async
vp run dev:uploads:web
```

<http://localhost:5173> を開いて、サインインして、ノートに画像を付けてください。API のターミナルに、worker のログが 1 行流れます。`"status":"recorded"` と `"verdict":"ok"` が入っているはずです。queue と記録の様子は、ここで見られます。

```bash
curl -s http://localhost:8787/local/queue
curl -s -X POST http://localhost:8787/local/queue/redrive
curl -s -X POST http://localhost:8787/local/housekeeping
```

`.env` の `LOCAL_QUEUE_DUPLICATE` を `true` にすると、すべてのイベントが 2 つのメッセージとして届きます。ログには `recorded` と `duplicate` が 1 行ずつ出て、記録は 1 つのままです。

Docker も、AWS の認証情報も要りません。

### queue の代わり

<<< @/examples/08-async/src/local-queue.ts{queue}

SQS の代わりは、小さな class です。worker が生き延びなければならない規則を 3 つだけ持っています。受け取ったメッセージは消えずに隠される。時間内に削除されなければ戻ってくる。決めた回数を超えたら、よけられる。

<<< @/examples/08-async/src/local-queue.ts{deliver}

こちらは event source mapping の代わりです。まとめて受け取って、worker を呼んで、失敗として名前の挙がらなかったメッセージだけを削除します。

### bucket の代わり

<<< @/examples/08-async/src/local-bucket.ts{local-bucket}

07章のメモリ上の実装を継承して、2 つ足しました。object が置かれたとき、消されたときに、S3 のイベントと同じ形の JSON を作ること。そして、ETag を指定した読み取りに答えること。

<<< @/examples/08-async/src/local.ts{local}

<<< @/examples/08-async/src/dev.ts{dev}

worker は、Lambda で動くのと同じ関数です。違うのは、まわりに立っているものだけです。

これは SQS や S3 の模擬ではありません。再現しないものを挙げておきます。

- SQS の配送そのもの。重複や順序の入れ替わりは、テストがわざと起こすもので、勝手には起きない
- S3 の通知の遅れと、sequencer の実際の形
- event source mapping の動き。同時実行、batch の作られ方、throttle されたときの再試行
- IAM。queue policy、関数の role、Scheduler の role
- EventBridge Scheduler。手元では、掃除は `curl` で呼んだときだけ動く
- lifecycle rule。手元では、pending の object はいつまでも残る

### テスト

```bash
vp run test:unit
```

テストは、開発サーバーと同じ部品を、時計と ID を固定して組み立てています。queue を通す必要がないテストは、メッセージを worker の関数に直接渡します。

## AWS にのせる準備

<!-- section: 08.infra -->

### queue と、その入口

<<< @/examples/08-async/infra/lib/async-stack.ts{queues}

<<< @/examples/08-async/infra/lib/async-stack.ts{queue-policy}

queue policy は、queue に付ける権限の文書です。この queue にメッセージを入れてよいのは、S3 だけ。それも、この bucket のことで、このアカウントの中から来たものだけです。`aws:SourceArn` と `aws:SourceAccount` の 2 つの条件は、公式ドキュメントの例と同じです。条件がないと、S3 というサービスを経由すれば、他人の bucket からでもこの queue にメッセージを入れられることになります。

DLQ のほうには、`Allow` が 1 つもありません。どの queue がこの DLQ を使えるかは、redrive allow policy という別の設定で決まります。既定は「すべての queue に許す」で、この章は既定のままです。

### bucket の名前を決める理由

<<< @/examples/08-async/infra/lib/async-stack.ts{bucket-name}

<<< @/examples/08-async/infra/lib/async-stack.ts{notification}

ここは、少しややこしいところです。

S3 は、通知の設定を受け取った時点で、送り先の queue に本当に送れるかを確かめます。なので、queue policy は bucket より先に存在していなければいけません。ところが queue policy には、bucket の ARN が書いてあります。bucket の名前を自動で付けていると、ARN は bucket ができるまで決まりません。bucket は policy を待ち、policy は bucket を待つ。CloudFormation のドキュメントも、この循環に名前を挙げて注意しています。

CDK の `bucket.addEventNotification` は、これを custom resource で解決します。bucket と policy を両方作った後で、通知の設定だけを別の Lambda 関数に書かせるやり方です。この章は、それを使いません。関数が 1 つ増えて、その関数には bucket の設定を書き換える権限が要り、通知の設定が template から見えなくなるからです。

かわりに、bucket の名前を決め打ちにしました。名前が決まっていれば、ARN は bucket を参照せずに書けます。循環は起きません。

手放したものもあります。bucket の名前は、世界中の AWS アカウントで重複できません。アカウント ID を含めているので、ぶつかる可能性は低いですが、ゼロではありません。そして、名前を決めた bucket は、作り直しが必要な変更（リージョンの移動など）がやりにくくなります。

別の選択肢は、S3 の通知を EventBridge に送って、EventBridge の rule から queue に入れることです。bucket の側は「EventBridge に送る」と書くだけなので、循環がありません。イベントの形と、途中に挟まるサービスが変わります。この章では試していません。

通知するのは、`u/` で始まる key の、作成と削除だけです。

### worker と、その呼ばれ方

<<< @/examples/08-async/infra/lib/async-stack.ts{worker}

worker の role は、API の関数の role とは別です。queue から読む 3 つの操作、`u/` の object を読むことと tag を外すこと、table の 3 つの操作。object を消す権限はありません。消すのは掃除の仕事です。

queue を読みにいくのは、あなたのコードではなく Lambda です。そのとき使われるのが、この関数の role です。AWS が用意している管理ポリシー（`AWSLambdaSQSQueueExecutionRole`）も同じ 3 つの操作を許しますが、対象が「すべての queue」になります。ここでは、対象を 1 つの queue にしています。

<<< @/examples/08-async/src/worker-lambda.ts{handler}

<<< @/examples/08-async/src/env.ts{env}

<<< @/examples/08-async/infra/lib/async-stack.ts{mapping}

event source mapping は、「Lambda がこの queue を読んで、この関数に渡す」という設定です。決めることが 3 つあります。

`batchSize` は 10。1 回の呼び出しで渡されるメッセージの最大数です。

`maxConcurrency` は 2。この queue のために同時に動く worker の数の上限です。設定できる最小の値です。何も設定しないと、Lambda はメッセージが溜まっているかぎり worker を増やします。ドキュメントによると、5 つから始めて、1 分ごとに最大 300 ずつ、1,250 まで。worker が増えれば、worker が書き込む先（DynamoDB）や読む先（S3）へのリクエストも同じだけ増えます。

`reportBatchItemFailures` は、さっきの partial batch response を有効にします。ドキュメントは、これを指定して初めて、関数が一部の成功を返せるようになると説明しています。付け忘れたら、worker が返した一覧は使われないはずです。

関数の同時実行数を抑える方法には、もう 1 つ、関数に付ける reserved concurrency があります。ドキュメントは、この 2 つは別の設定だと念を押しています。reserved concurrency のほうが小さいと、Lambda は queue から受け取ったメッセージを関数に渡せず、throttle されます。そのメッセージは、処理されていないのに、受け取られた回数が 1 つ増えて queue に戻ります。

### 掃除と schedule

<<< @/examples/08-async/infra/lib/async-stack.ts{housekeeping}

掃除の role は、3 つ目の role です。object の一覧と削除、tag を外すこと、table の読み取りと削除。queue には触れません。

timeout は 15 分。Lambda の上限です。この関数は、bucket の object を 1 つずつ順に見るので、枚数が増えると時間がかかります。

<<< @/examples/08-async/infra/lib/async-stack.ts{schedule}

EventBridge Scheduler は、決めた時刻や間隔で、AWS の API を 1 つ呼んでくれるサービスです。呼ぶときに使う権限が、schedule の実行 role です。関数の実行 role とは別物で、「Scheduler が、あなたの代わりに関数を呼ぶ」ための role です。

この role にできるのは、掃除の関数を呼ぶことだけです。そして、この role を使えるのは、このアカウントの default の schedule group に属する schedule だけ。公式ドキュメントは、条件に書く ARN を個々の schedule ではなく schedule group にするように、と指定しています。

`retryPolicy` は、Scheduler が関数を呼ぶこと自体に失敗したときの再試行です。3 回まで、15 分以内。それでだめなら、その回はあきらめます。次の回が 1 時間後に来るからです。

### テストが見ていること

テストは、template に対して次を確かめます。synth は、ファイルの先頭で 1 回だけです。

- queue policy の `Allow` が 1 つだけで、principal が S3、action が `sqs:SendMessage`、条件が bucket の ARN とアカウントである
- queue policy が bucket のリソースを参照していない。bucket は queue policy の後に作られる
- 通知の設定が template に直接書かれていて、`Custom::` で始まるリソースが 1 つもない
- visibility timeout が worker の timeout の 6 倍で、DLQ の保持期間が元の queue より長い
- event source mapping が、batch 10、同時実行 2、`ReportBatchItemFailures` である
- worker と掃除の role の action が、上に書いたものちょうどで、`*` がない
- schedule の role を使えるのが Scheduler だけで、できるのが掃除の関数の呼び出しだけである

使っているリソースの種類は、07章の 19 種類に 5 種類を足した 24 種類です。足した 5 つ（`AWS::SQS::Queue`、`AWS::SQS::QueuePolicy`、`AWS::Lambda::EventSourceMapping`、`AWS::Lambda::EventInvokeConfig`、`AWS::Scheduler::Schedule`）は、固定した版の cdkd がどれも専用の実装を持っていることを、`v0.296.28` のタグのソースで確かめました。`AWS::S3::Bucket` の実装が `BucketName` と `NotificationConfiguration` を扱うことも、同じソースで確かめています。

## デプロイして確かめる

<!-- section: 08.deploy -->

ここから先は、実行していません。手順とタスクを用意したところまでです。

```bash
vp run async:infra:diff
vp run async:infra:deploy
vp run async:smoke
```

`async:smoke` は、あなたの認証情報で bucket に小さな PNG を直接置いて、worker の記録が table に現れるのを待ちます。続けて、同じ key を画像でないもので置き換えて、記録が「だめ」に変わり、sequencer が大きくなることを確かめます。最後に object を消して、記録が消えるのを待ちます。S3、SQS、Lambda、DynamoDB を 1 周する確認です。待つのは、それぞれ最大 90 秒です。

ブラウザからも使うなら、07章と同じ手順です。

```bash
vp run async:user:create you@example.com
vp run async:publish
vp run async:smoke:web
```

サインインして得た access token を環境変数 `AIH_ACCESS_TOKEN` に入れて `async:smoke` を実行すると、form でのアップロードも確かめます。完了した後に同じ form をもう一度送って、pending の tag が外れるのを待ちます。この章の「まだ」のうち、いちばん大事なもの（POST のイベントに sequencer が入るか）は、ここでわかります。

schedule は、作られるとすぐに 1 回目を起動します。開始日を指定していない rate の schedule は、そう動くとドキュメントにあります。

drift の検査は、これまでと同じです。

```bash
vp run async:infra:drift
```

## 溜まったとき、落ちたとき

<!-- section: 08.operate -->

### queue が伸びる

アップロードが急に増えて、worker が追いつかなくなったら、どうなるでしょう。

何も失敗しません。メッセージが queue に溜まるだけです。worker は同時に 2 つまでしか動かないので、DynamoDB や S3 へのリクエストが急に増えることもありません。遅れは、「検査の結果が出るのが遅くなる」という形で現れます。これが backpressure です。queue は、流量の差を待ち行列の長さとして引き受けてくれます。

ただし、引き受けられるのは保持期間までです。この章の queue は、メッセージを 4 日保持します。4 日たっても処理されなかったメッセージは、消えます。DLQ にも行きません。見るべき数字は、queue の長さよりも、いちばん古いメッセージの年齢（CloudWatch の `ApproximateAgeOfOldestMessage`）です。アラームは 19章の予定です。

### DLQ を見る

```bash
vp run async:queue
vp run async:logs
```

`async:queue` は、2 つの queue に溜まっているおよその件数と、DLQ の先頭 10 件までの中身を表示します。メッセージは動かしません。visibility timeout を 0 にして受け取っているので、見た後もそのまま見えています（受信回数だけは増えます）。

DLQ にメッセージがあったら、まず worker のログで、その key の `message failed` の行を探してください。理由が書いてあります。

- 理由が一時的なもの（DynamoDB や S3 の一時的なエラー、デプロイ直後の権限の反映待ち）で、もう直っている
- 理由がコードや設定の誤りで、まだ直っていない
- メッセージそのものが読めない

戻してよいのは、1 つ目だけです。2 つ目は、直してから。3 つ目は、戻しても同じことが起きるだけです。

```bash
vp run async:queue --redrive
```

DLQ のメッセージを、元の queue に戻します（redrive）。公式ドキュメントによると、戻されたメッセージは新しいメッセージとして扱われて、新しい ID が付き、保持期間も数え直されます。redrive の途中でメッセージを選んだり書き換えたりはできません。全部が戻ります。

戻したメッセージが、すでに処理済みのイベントだったとしても、何も起きません。そのために、ここまでやってきました。

## Queues から来た人へ

Cloudflare にも、同じ役割の部品があります。公式ドキュメントで確かめた範囲で並べます。

| | Cloudflare | この章 |
| --- | --- | --- |
| 配送の保証 | Queues は既定で at-least-once。まれに 2 回以上届く | SQS の標準 queue も at-least-once |
| batch | 既定で最大 10 件、または 5 秒 | 最大 10 件。待ち時間は既定で 0 |
| 一部だけ失敗 | メッセージごとに `ack()` と `retry()` を呼ぶ | 失敗した ID を `batchItemFailures` で返す |
| 再試行の上限 | `max_retries`、既定で 3 | queue の `maxReceiveCount`。この章は 5 |
| DLQ | consumer の設定に書く。無ければ、上限に達したメッセージは消える | queue の redrive policy に書く。無ければ、保持期間まで戻り続ける |
| bucket のイベント | R2 の event notification が Queues に送る | S3 の event notification が SQS に送る |
| 定期実行 | Workers の Cron Triggers | EventBridge Scheduler |

いちばん違うのは、consumer の書き方です。Queues では、Worker の `queue()` handler がメッセージを受け取って、`ack()` か `retry()` を呼びます。この章では、Lambda が queue を読んで関数を呼び、関数は失敗した ID の一覧を返します。queue と関数の間に event source mapping という設定が挟まっていて、batch の大きさや同時実行の上限は、そこに書きます。

冪等性の話は、どちらでも同じです。Cloudflare のドキュメントも、重複が困るなら一意な ID を鍵にするように、と書いています。

R2 の通知のメッセージの例には、object の key、大きさ、ETag、時刻はありますが、S3 の sequencer に当たる欄は見当たりませんでした。同じ key への操作の順序を R2 でどう決めるかは、確認していません。Cron Triggers の配送の保証も、読んだページには書かれていませんでした。

## お金の話

金額は USD、東京リージョン、税別です。計算の入力と単価は[料金の計算](/ja/reference/pricing.md)にあります。

新しく出てくる単価は 2 つです。SQS の標準 queue は、リクエスト 100 万件あたり USD 0.40。送るのも、受け取るのも、消すのも、1 リクエストです。毎月 100 万件までは無料で、アカウントの全部の queue で共有です。EventBridge Scheduler は、月 1,400 万回の起動までが USD 0 で、その先が 100 万回あたり USD 1.25。1 時間に 1 回なら、月 730 回です。

例は 2 つに分けます。07章の例（月 10,000 枚のアップロード）に上乗せされる分です。

まず、イベントで動く部分。月に作成が 10,000 回、削除が 1,000 回あったとします。

| 対象 | 定価 |
| --- | --- |
| SQS のリクエスト（33,000 件） | 0.01 |
| worker（Lambda 11,000 回、平均 200 ミリ秒） | 0.01 |
| S3 の GetObject（10,000 件） | 0.00 |
| DynamoDB（書き込み 11,000、読み取り 10,000） | 0.01 |
| ログ | 0.01 |
| 小計 | **0.04** |

4 セントです。毎月の無料枠を引くと 0.01 になります。アップロード 1 枚あたりの費用は、07章のデータ転送と比べると、誤差です。

次に、時計で動く部分。bucket に 10,000 枚の画像が置いてあって、掃除が 1 時間ごとに動く場合です。

| 対象 | 定価 |
| --- | --- |
| Scheduler の起動（730 回） | 0.00 |
| 掃除の関数（730 回、1 回 200 秒と仮定） | 0.49 |
| S3 の LIST（14,600 件） | 0.07 |
| DynamoDB の読み取り（2,920 万 unit） | 4.16 |
| 小計 | **4.72** |

こちらは 4 ドル 72 セントで、ほとんどが DynamoDB の読み取りです。掃除は、動くたびに 10,000 枚すべてについて、table を 4 回ずつ読みます。それを月に 730 回。無料枠を引いた後は 4.23 です。

**イベントで動く処理の費用は、起きたことの数に比例します。突き合わせの費用は、置いてあるものの数と、動かす回数の積に比例します。** 画像が 10 倍になれば、掃除の費用も 10 倍です。しかも、1 回 200 秒という実行時間は仮定で、計測していません。枚数が増えれば、関数の timeout（15 分）にも当たります。間隔を 6 時間にすれば、費用は 6 分の 1 です。そのかわり、「だめ」な画像が消えるまでの時間が延びます。

誰も使わない月はどうでしょう。bucket が空なら、掃除は一覧を読んで終わるので、月 USD 0.01 です。ただし、これに入っていないものが 1 つあります。Lambda は、空の queue も読みにいきます（long polling）。その `ReceiveMessage` は、SQS のリクエストとして数えられます。どれくらいの頻度で読みにいくのかは、公式ドキュメントに数字がなく、見積もれませんでした。0 ではありません。月 100 万件の無料枠に収まるかどうかも、確かめていません。

stack を消すと、queue も、関数も、schedule も消えて、この章のぶんの料金は止まります。

## ハマりどころ

| こうなったら | ここを見る |
| --- | --- |
| `dev:async` が `LOCAL_AUTH_SECRET` や `NOTES_STORE` と言って止まる | `examples/08-async/.env` はありますか。`.env.example` をコピーしてください |
| デプロイで、bucket の作成が `Unable to validate the following destination configurations` で失敗する | queue policy が bucket より先に作られていますか。policy の `aws:SourceArn` が bucket の ARN と一致していますか |
| デプロイで、bucket の名前がすでに使われていると言われる | `aih-async-uploads-<アカウント ID>` という bucket が、どこかに残っていませんか |
| デプロイ直後に、DLQ に 1 件ある | S3 の test event を失敗にしていませんか。この章の worker は受け取って何もしません |
| 画像を置いても、記録ができない | `vp run async:queue` で、メッセージが queue に入っているかを見ます。入っていなければ S3 の通知、入ったままなら event source mapping か worker です |
| worker のログに `carries no eTag or no sequencer` | 作成のイベントに sequencer がありません。章末のメモの「まだ確かめていないこと」を見てください |
| worker のログに 403 があり、メッセージが DLQ に入る | worker の role に `s3:ListBucket` がないと、消えた object の `GetObject` は 404 ではなく 403 になります |
| 成功したはずのメッセージが、何度も処理される | worker が返す `batchItemFailures` の形は合っていますか。batch にない ID や空の ID があると、全部が失敗の扱いになります |
| 失敗したはずのメッセージが、消えている | event source mapping に `ReportBatchItemFailures` はありますか。無ければ、関数が返した一覧は使われないはずです |
| DLQ に、中身の正しいメッセージが溜まる | worker が「もう済んでいる」を失敗として返していませんか |
| 掃除の関数が timeout する | object が多すぎます。「お金の話」と「本番にするなら」を見てください |

## 本番にするなら

- **DLQ にアラームを付ける。** DLQ は、誰かが見なければ、ただのゴミ箱です。`ApproximateNumberOfMessagesVisible` が 0 でなくなったら知らせます。元の queue には、いちばん古いメッセージの年齢のアラームを付けます（19章の予定）
- **検査が済むまで、画像を見せない。** この章の API は、検査の結果を見ていません。「だめ」な画像も、掃除が消すまでは一覧に出ます。添付の一覧で検査の記録を見て、`ok` のものだけに URL を付けます
- **掃除を、枚数に比例させない。** 全部を見るのをやめて、新しい object だけを見る。あるいは、S3 Inventory（bucket の中身の一覧を、S3 が定期的にファイルに書き出す機能）を入力にします。この章では、どちらも試していません
- **sequencer を確かめる。** POST のイベントと lifecycle のイベントの形を実機で見てから、worker の前提を決め直します
- **検査の記録の残り方を閉じる。** 「残っている穴」に書いた tombstone と TTL です
- **queue を KMS の鍵で暗号化するか決める。** この章は SQS が管理する鍵です。自分で管理する鍵にするなら、S3 がその鍵を使えるように、鍵の policy に S3 を足す必要があります
- **bucket の名前の付け方を決める。** 決め打ちの名前は、この章の都合です。custom resource を受け入れるか、EventBridge を挟むか、名前の規則を組織で決めるか
- **作成の API を冪等にする。** 05章から残っている宿題です

## 片付け

<!-- section: 08.cleanup -->

```bash
vp run async:empty --yes
vp run async:unpublish --yes
vp run async:infra:destroy
```

07章と同じで、2 つの bucket を先に空にします。`async:empty` で画像を消すと、消した数だけ削除のイベントが queue に入り、worker が検査の記録を消していきます。stack をすぐ消すなら、それを待つ必要はありません。table ごと消えます。

`async:infra:destroy` で、queue、DLQ、2 つの関数、schedule、そして 07章の一式（bucket、table、user pool、API、distribution）が消えます。queue に残っていたメッセージも消えます。元には戻せません。

残るのは、cdkd の bootstrap で作った保存場所（02章）と、そこに置かれたデプロイ用のファイルだけです。

::: details この章の検証メモ

**手元で確かめたこと。** worker のテスト（同じメッセージの再配送、別の ID の同じイベント、2 つの worker の同時実行、古い作成イベント、先に届いた削除、遅れてきた削除、記録の前と後での中断、form の再送の修復、画像でないものの判定）。queue のまわりのテスト（batch の一部の失敗、DLQ への移動、関数が例外を投げた場合、S3 の test event、この章のものでない key、DLQ からの戻し）。掃除のテスト（「だめ」な添付の削除、古い判定を使わないこと、tag の外し直し、dry run、2 回の実行、同時の実行、途中での中断）。画像の種類と大きさの読み取り（`sips` と `cwebp` が書いた実ファイル）。イベントの JSON の解釈と sequencer の比較。DynamoDB と S3 へのリクエストの形。インフラの assertion。型検査と synth。それから、worker の条件を 2 か所わざと壊して、テストが 4 つ落ちることを確かめました。`dev:async` を起動して、スクリプトから HTTP で次を確かめました。サインイン、ノートの作成、form でのアップロード、worker の記録（`ok`、1×1）、完了、同じ form で HTML を送り直すと記録が `rejected` に変わること、掃除の dry run、削除で記録が消えること。

**まだ確かめていないこと。** AWS に対しては、何も実行していません。`async:infra:diff`、`async:infra:deploy`、`async:smoke`、`async:queue`、`async:logs`、`async:housekeeping`、`async:publish`、`async:smoke:web`、`async:user:create`、`async:infra:drift`、`async:empty`、`async:unpublish`、`async:infra:destroy` のどれもです。したがって、次は実物で確かめていません。form（POST Object）で作られた object のイベントと、lifecycle rule による削除のイベントに sequencer が入ること（ドキュメントは「PUT と DELETE のリクエストでだけ使われる」と書いています）。bucket の名前を決めて循環を避けた template が、cdkd で通ること。S3 が通知の設定時に queue を検証すること。SQS が管理する鍵で暗号化した queue に S3 が送れること（S3 のドキュメントは、自分で管理する KMS の鍵の場合だけを説明しています）。`If-Match` に引用符つきの ETag を渡して、置き換えられた object に 412 が返ること。event source mapping と partial batch response の実際の動き。Scheduler が関数を起動すること。DynamoDB 用と S3 用の実装は、リクエストの形をテストで固定しただけで、実物には送っていません。Lambda が空の queue を読みにいく頻度と、掃除の実行時間は、計測していません。画像の形式のうち、JPEG の仕様書（ITU-T T.81）は読み直していません。実際の encoder が書いたファイルで動作を確かめただけです。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 画像の中身を見る | `examples/08-async/src/inspect.ts`、`src/inspection.ts`、`test/inspect.test.ts`、`test/fixtures.ts` | `test:unit` |
| 「1 回だけ届く」とは、誰も言っていない | `examples/08-async/src/events.ts`、`src/worker.ts`、`test/events.test.ts`、`test/queue.test.ts` | `test:unit` |
| 2 回届いても、結果は 1 つ | `examples/08-async/src/worker.ts`、`src/sequencer.ts`、`src/object-reader.ts`、`src/s3-object-reader.ts`、`src/dynamodb-inspection-repository.ts`、`test/worker.test.ts`、`test/adapters.test.ts`、`test/harness.ts` | `test:unit` |
| 時計で動かす掃除 | `examples/08-async/src/housekeeping.ts`、`src/housekeeping-lambda.ts`、`test/housekeeping.test.ts`、`scripts/housekeeping.ts` | `test:unit`、`async:housekeeping` |
| 手元で動かす | `examples/08-async/src/dev.ts`、`src/local.ts`、`src/local-queue.ts`、`src/local-bucket.ts`、`.env.example` | `dev:async`、`dev:uploads:web`、`test:unit` |
| AWS にのせる準備 | `examples/08-async/infra/lib/async-stack.ts`、`infra/bin/app.ts`、`infra/test/async-stack.test.ts`、`src/worker-lambda.ts`、`src/env.ts`、`cdk.json` | `async:infra:synth`、`test:unit` |
| デプロイして確かめる | `examples/08-async/scripts/smoke.ts`、`scripts/user.ts`、`scripts/write-config.ts`、`tools/src/site/`、`tools/src/infra/` | `async:infra:diff`、`async:infra:deploy`、`async:smoke`、`async:user:create`、`async:publish`、`async:smoke:web`、`async:infra:drift` |
| 溜まったとき、落ちたとき | `examples/08-async/scripts/queue.ts`、`scripts/logs.ts` | `async:queue`、`async:logs` |
| 片付け | `examples/08-async/scripts/empty-uploads.ts`、`scripts/user.ts`、`tools/src/site/unpublish.ts` | `async:empty`、`async:unpublish`、`async:infra:destroy`、`async:user:delete` |
| お金の話 | `data/pricing/` | `test:unit` |

**一次情報**（確認日はすべて 2026-10-12）

- [What is Amazon SQS?](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html)、[Amazon SQS standard queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues.html)、[Amazon SQS at-least-once delivery](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues-at-least-once-delivery.html)、[Amazon SQS visibility timeout](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html)、[Amazon SQS message quotas](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/quotas-messages.html)
- [Using dead-letter queues in Amazon SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)、[Learn how to configure a dead-letter queue redrive in Amazon SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-configure-dead-letter-queue-redrive.html)、[StartMessageMoveTask](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_StartMessageMoveTask.html)、[Creating alarms for dead-letter queues using Amazon CloudWatch](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/dead-letter-queues-alarms-cloudwatch.html)
- [Using Lambda with Amazon SQS](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html)、[Creating and configuring an Amazon SQS event source mapping](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html)、[Configuring scaling behavior for SQS event source mappings](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-scaling.html)、[Handling errors for an SQS event source in Lambda](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html)、[Lambda parameters for Amazon SQS event source mappings](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-parameters.html)、[AWSLambdaSQSQueueExecutionRole](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AWSLambdaSQSQueueExecutionRole.html)
- [Amazon S3 Event Notifications](https://docs.aws.amazon.com/AmazonS3/latest/userguide/EventNotifications.html)、[Event notification types and destinations](https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-event-types-and-destinations.html)、[Event message structure](https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-content-structure.html)、[Granting permissions to publish event notification messages to a destination](https://docs.aws.amazon.com/AmazonS3/latest/userguide/grant-destinations-permissions-to-s3.html)、[Using Amazon SQS, Amazon SNS, and Lambda](https://docs.aws.amazon.com/AmazonS3/latest/userguide/how-to-enable-disable-notification-intro.html)
- [AWS::S3::Bucket NotificationConfiguration](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-s3-bucket-notificationconfiguration.html)
- [How to retrieve or copy objects based on metadata with conditional reads](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-reads.html)、[GetObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html)
- [Manage event ordering and duplicate events with Amazon S3 Event Notifications](https://aws.amazon.com/blogs/storage/manage-event-ordering-and-duplicate-events-with-amazon-s3-event-notifications/)（AWS Storage Blog。S3 のユーザーガイドが参照している記事）
- [What is Amazon EventBridge Scheduler?](https://docs.aws.amazon.com/scheduler/latest/UserGuide/what-is-scheduler.html)、[Using templated targets](https://docs.aws.amazon.com/scheduler/latest/UserGuide/managing-targets-templated.html)、[Setting up Amazon EventBridge Scheduler](https://docs.aws.amazon.com/scheduler/latest/UserGuide/setting-up.html)、[Confused deputy prevention](https://docs.aws.amazon.com/scheduler/latest/UserGuide/cross-service-confused-deputy-prevention.html)、[RetryPolicy](https://docs.aws.amazon.com/scheduler/latest/APIReference/API_RetryPolicy.html)、[Schedule types](https://docs.aws.amazon.com/scheduler/latest/UserGuide/schedule-types.html)、[Invoke a Lambda function on a schedule](https://docs.aws.amazon.com/lambda/latest/dg/with-eventbridge-scheduler.html)
- [Supported data types and naming rules in Amazon DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.NamingRulesDataTypes.html)
- [Amazon SQS pricing](https://aws.amazon.com/sqs/pricing/)、[Amazon EventBridge pricing](https://aws.amazon.com/eventbridge/pricing/)、AWS Price List bulk API: [SQS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSQueueService/current/ap-northeast-1/index.json)、[EventBridge](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSEvents/current/ap-northeast-1/index.json)
- [WebP Container Specification](https://developers.google.com/speed/webp/docs/riff_container)、[GIF89a Specification](https://www.w3.org/Graphics/GIF/spec-gif89a.txt)
- Cloudflare: [Queues: Delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)、[Queues: Batching, Retries and Delays](https://developers.cloudflare.com/queues/configuration/batching-retries/)、[Queues: Dead Letter Queues](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/)、[R2: Event notifications](https://developers.cloudflare.com/r2/buckets/event-notifications/)、[Workers: Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [cdkd v0.296.28 の register-providers.ts](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts)、[@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)、[aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0)

:::
