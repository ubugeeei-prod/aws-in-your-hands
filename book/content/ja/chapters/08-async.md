---
title: "08 Queue: SQS、DLQ、冪等性、Scheduler"
revision: 1
---

# 08 Queue: SQS、DLQ、冪等性、Scheduler

ノートに画像を付けられるようになりました。ただ、[07章](/ja/chapters/07-uploads.md)は宿題を 3 つ残しています。アップロードされたファイルの中身を、誰も見ていないこと。孤立した object の掃除が、手で実行するタスクのままなこと。そして、完了した後に同じ form をもう一度送ると、添付した画像が 1 日後に消えてしまうこと。

この章では、利用者のリクエストの外で動く処理を 2 つ足して、3 つとも片付けます。1 つは、アップロードのたびに動いて画像の中身を確かめる worker。もう 1 つは、1 時間ごとに動く掃除です。

話の中心は、道具の使い方よりも、その先にあります。queue を通ったメッセージは、2 回届くことがあります。順序が入れ替わることも、処理の途中で worker が落ちることもあります。それでも結果が 1 つになるように作る。この章のほとんどは、その話です。

前提は 07章です。コードは `examples/08-async/` にあります。アップロードの API も画面も 07章のものをそのまま import して使うので、この章で書くのは増えるところだけです。

## 全体像

<!-- section: 08.architecture -->

```figure
caption: S3 のイベントは queue に入り、event source mapping が batch にして Worker に渡す
node browser: Browser
node s3: S3 bucket "Uploads"
node notif: event notification | ObjectCreated:*, ObjectRemoved:Delete, LifecycleExpiration:Delete
node q: SQS queue "UploadEvents" | standard, visibility timeout 180 s, 4 日保持
node esm: Lambda event source mapping | 1 batch は最大 10 件、同時に最大 2 batch
node dlq: SQS queue "DeadLetters" | 14 日保持
node worker: Lambda function "Worker" | timeout 30 s
edge browser -> s3: POST form, DELETE .../attachments/{attachmentId} (07章)
edge s3 -> notif: u/ の下の key
edge notif -> q: 少なくとも 1 回、順序の保証なし、ふつうは数秒以内
edge q -> esm
edge q --> dlq: 5 回受信されて削除されない
edge esm -> worker
mark q
```

```figure
caption: Worker が 1 つのイベントについて S3 と table に対して行う 4 つの手順
type: sequence
actor worker: Worker | Lambda function
actor s3: S3 bucket "Uploads"
actor table: DynamoDB table | ノートの table
step worker -> s3: 1. GetObject, If-Match <event の eTag>
step worker -> worker: 2. 先頭の bytes: type, width, height
step worker -> table: 3. PutItem INSPECTION#... (新しければ)
step worker -> s3: 4. DeleteObjectTagging (ATTACHMENT#... あり)
```

```figure
caption: 1 時間ごとに Scheduler が Housekeeping を呼び、bucket と table を見比べて、どこからも指されていない object と検査に落ちた object を消し、添付済みの画像から pending の tag を外す
node sched: EventBridge Scheduler | "aih-async-housekeeping": rate(1 hour)
node hk: Lambda function "Housekeeping" | timeout 15 min
node s3: S3 bucket
node table: DynamoDB table
edge sched -> hk: "ScheduleRole" を assume し、非同期に invoke
edge hk -> s3: list, delete, tag を外す
edge hk -> table: read
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

```figure
caption: 受け取られたメッセージは隠されるだけで、削除されなければまた見えるようになり、別の worker に渡る
type: sequence
actor a: worker A
actor q: queue "UploadEvents"
actor b: worker B
note q: t0 メッセージ M が見えている
step q -> a: t1 M を受信: 180 秒隠される
note a: M の処理を始める
note a: t2 まだ動いている、または消えた
note q: t1+180 M がまた見える
step q -> b: t3 再び受信 (receive count 2)
note b: M の処理を始める
note q: ...
note q: 5 回受信されて削除されない:
note q: 次の受信で M は "DeadLetters" へ移る
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
