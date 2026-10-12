---
title: "07 File Upload: しくみと実装"
---

# 07 File Upload: しくみと実装

## 2 つの置き場所、1 つの順序

<!-- section: 07.finish -->

画像は S3 に、「どのノートに、どの画像が付いているか」は DynamoDB にあります。そして、この 2 つへの書き込みを 1 つの transaction にまとめる方法は、ありません。

05章の楽観ロックは、1 つの table の中の話でした。条件つきの書き込みが、検査と更新を 1 つの手順にしてくれた。今度は相手が 2 つのサービスです。どちらかに書いた直後に関数が落ちれば、片方だけが書かれた状態が残ります。

これは防げません。できるのは、どちらの「片方だけ」を許すかを選ぶことです。

```text
finish (step 3)                        if the function stops right after this step
  a. HeadObject: is it there?          nothing changed
  b. DeleteObjectTagging (S3)          object without a record   <- allowed; cleaned up later
  c. PutItem ATTACHMENT#... (DynamoDB) done

remove
  a. DeleteItem ATTACHMENT#... (DynamoDB)   object without a record   <- allowed; cleaned up later
  b. DeleteObject (S3)                      done

never, at any step:                    a record whose object is missing or about to expire
```

守る invariant は、この 1 文です。

**添付の記録があるなら、その object は存在していて、自動削除の対象から外れている。**

逆は許します。記録のない object です。誰にも見えないし、利用者の画面は壊れません。困るのは保存料金だけで、あとから掃除できます。

反対に、object のない記録は、利用者に見えます。ノートを開くと、壊れた画像が出る。なので、こちらは起こさないと決めます。

決めたら、順序は自動的に決まります。足すときは object が先、記録が後。消すときは記録が先、object が後。いつ止まっても、記録が指す先は必ずある。

### 記録

<<< @/examples/07-uploads/api/src/attachment-repository.ts{interface}

<<< @/examples/07-uploads/api/src/dynamodb-attachment-repository.ts{keys}

記録は、06章と同じ table の、同じ持ち主の partition に置きます。sort key の接頭辞を変えているので、ノートの一覧（`NOTE#` で始まるものを取る）には混ざりません。

「アップロード中」を表す行は作りません。許可証を出した時点では、どこにも何も書かない。使われなかった許可証は、跡を残しません。

### 完了

<<< @/examples/07-uploads/api/src/attachments.ts{finish}

ブラウザが「送りました」と言ってきても、信じません。`HeadObject` で、S3 に本当にあるかを聞きます。大きさと種類も、S3 が答えた値を記録します。

<<< @/examples/07-uploads/api/src/s3-object-store.ts{head}

<<< @/examples/07-uploads/api/src/s3-object-store.ts{mark-attached}

アップロードされた object には、`upload-state=pending` という tag が付いています。bucket には「この tag が付いたまま 1 日たった object を消す」という規則があって、完了の処理がこの tag を外します。外した後で、記録を書きます。

この処理は、2 回呼んでも結果が同じです。記録がもうあれば、それを返すだけ。記録の書き込みは条件つきなので、2 つの完了が同時に走っても、記録は 1 つです。route を `PUT` にしたのは、そのためです。

<<< @/examples/07-uploads/api/src/attachments.ts{timing}

完了を受け付けるのは、object が bucket に届いてから 15 分以内です。この期限は、あとで出てくる掃除と、完了の処理が、同じ object を同時に触らないためにあります。

### ブラウザの側

<<< @/examples/07-uploads/api/src/client.ts{send}

<<< @/examples/07-uploads/api/src/client.ts{client}

S3 への POST には、access token を付けません。付けても S3 は読まないし、アプリの token を別のサービスに送る理由もありません。form の中の署名が、許可のすべてです。

### 途中で止めてみる

テストは、決まった場所で処理を止めて、2 つの置き場所を両方見ます。メモリ上の実装に「次の 1 回だけ失敗する」細工をして、順序を固定しています。

| 止める場所 | S3 | DynamoDB | その後 |
| --- | --- | --- | --- |
| 送った。完了を呼ばない | object（pending） | なし | 1 日後に lifecycle rule が消す |
| tag を外した。記録の書き込みが失敗 | object（tag なし） | なし | もう一度完了を呼ぶと、記録が 1 つできる。呼ばれなければ掃除が消す |
| tag を外すのに失敗 | object（pending） | なし | もう一度完了を呼ぶと成功する |
| 完了した。応答が届かない | object（tag なし） | 記録 | もう一度呼んでも、同じ記録が返る |
| 削除で記録を消した。object の削除が失敗 | object（tag なし） | なし | 利用者には成功を返す。掃除が消す |
| ノートを消した。添付の後始末が失敗 | object（tag なし） | 記録 | ノートがないので API からは届かない。掃除が両方消す |

どの行でも、「記録があるのに object がない」は起きていません。

<<< @/examples/07-uploads/api/src/attachments.ts{remove}

<<< @/examples/07-uploads/api/src/attachments.ts{cascade}

ノートの削除は、06章の service を包んで足しました。06章のコードは変えていません。ノートを先に消すのは、ノートがなくなれば、その添付には API のどの route からも届かなくなるからです。残りは片付けの問題になります。

## 残ったものを片付ける

<!-- section: 07.orphans -->

孤立した object には、2 種類あります。

1 つ目は、送られたのに完了されなかったもの。いちばんよく起きるのはこれでしょう。タブを閉じた、通信が切れた。これは S3 自身に消してもらいます。

<<< @/examples/07-uploads/api/src/object-store.ts{tags}

lifecycle rule は、条件に合う object を、作成から一定の日数の後に S3 が自分で消してくれる設定です。この章の規則は「`upload-state=pending` の tag が付いた object を、1 日後に消す」。コードを 1 行も動かさずに済みます。

公式ドキュメントによると、tag を条件にした規則は 1 日に 1 回評価されて、削除は非同期に実行されます。実行の時点で tag がもう付いていなければ、削除は行われません。期限と実際の削除の間には遅れがありえます。つまり「きっかり 24 時間後」ではなく、「1 日たってから、そのうち」です。

2 つ目は、tag を外した後に孤立したもの。表の 2 行目、5 行目、6 行目です。tag がないので、lifecycle rule は拾いません。S3 は table の中身を知らないので、拾いようがありません。bucket と table を突き合わせる処理が要ります。

<<< @/examples/07-uploads/api/src/sweep.ts{sweep}

掃除は、bucket の object を順に見て、記録かノートのどちらかがなければ消します。消す順序は、利用者の削除と同じ。記録が先、object が後です。

1 時間より新しい object には触りません。完了の期限は 15 分でした。1 時間たった object は、もう完了の途中ではありえません。関数の時計と S3 の時計が少しずれていても、余裕があります。時間で区切るこの手は、2 つの処理の間に lock を置けないときの、よくあるやり方です。

知らない形の key は、報告するだけで消しません。このアプリが書いたものではないからです。

掃除は、あなたの認証情報で動くタスクです。関数ではありません。何を消すかを先に見られます。

```bash
vp run uploads:sweep
vp run uploads:sweep --delete
```

定期的に自動で動かすなら、scheduler が要ります（[08章](/ja/chapters/08-async.md)で足します）。

### この設計に残る穴

1 つ、閉じていない穴があります。隠さずに書いておきます。

presigned な form は、期限までは何度でも使えます。利用者が画像を送って、完了して、そのあと 5 分以内に同じ form をもう一度送ったら、どうなるでしょう。S3 は object を置き換えて、form に書かれた tag をもう一度付けます。記録はあるのに、object は pending に戻る。1 日後に lifecycle rule が消して、記録だけが残ります。invariant が破れます。

壊せるのは自分の添付だけで、他人のものには届きません。でも、破れは破れです。この動きを再現するテストを、わざと 1 つ置いてあります。

閉じ方は 2 つ考えられます。1 つは presigned PUT に替えて、`If-None-Match` で「同じ key への 2 回目の書き込み」を S3 に拒否させること。公式ドキュメントは、このヘッダーを使える操作に `PutObject` を挙げていて、POST Object は挙げていません。代わりに、大きさの範囲を S3 に守らせる確かな方法を手放します。もう 1 つは、許可証の期限が切れた後で tag をもう一度外す処理を足すこと。どちらも、この章では実装していません。

それから、掃除が見つけられないものもあります。object のない記録です。誰かが bucket の object を手で消すと、できます。見つけるには table の側から調べる必要があって、この章の掃除はそれをしません。

## 画像を見せる

<!-- section: 07.view -->

bucket は公開しません。では、`<img>` はどうやって画像を読むのでしょう。

<<< @/examples/07-uploads/api/src/attachments.ts{list}

<<< @/examples/07-uploads/api/src/s3-object-store.ts{presign-view}

添付の一覧を返すとき、1 枚ごとに、5 分だけ有効な presigned GET の URL を作って付けます。これも関数の中の計算で、S3 へのリクエストは発生しません。

一覧の route は、ノートが呼び出した人のものかを確かめます。でも、返した URL そのものは、誰が使っても通ります。access token は要りません。チャットに貼れば、貼られた人も 5 分間は見られます。ブラウザの履歴にも、proxy のログにも残ります。

公式ドキュメントは、presigned URL を bearer token と呼んで、相応に守るよう勧めています。この章が選んだ守り方は、期限を短くすることだけです。5 分たつと画像が読めなくなるので、画面は読み込みに失敗したら一覧を取り直します。

アプリの認可をリクエストのたびに効かせたいなら、別の構成になります。CloudFront を前に置いて、署名つきの cookie か URL を使う方法です。章のアウトラインでは CloudFront と OAC を通す案でした。でも OAC だけでは、URL を知っている人なら誰でも読めてしまいます。利用者ごとに分けるには署名の仕組みが別に要るので、この章では presigned GET にしました。

### 期限より先に切れることがある

presigned URL の期限は、指定した時間です。ただし、それより先に切れる場合があります。

公式ドキュメントには、こうあります。一時的な認証情報で作った presigned URL は、その認証情報が失効すると、指定した期限が後であっても無効になる。

<<< @/examples/07-uploads/api/src/lambda.ts{handler}

Lambda は、実行 role から得た access key を、session token と一緒に環境変数で関数に渡します。session token が付くのは、一時的な認証情報です。なので、この章の URL と form は、すべてこの規則の対象です。その認証情報がどれくらいの長さで入れ替わるのかは、公式ドキュメントで確認できませんでした。presigned URL のページに EC2 や ECS の目安は載っていますが、Lambda の数字はありません。

この章の期限は 5 分なので、影響は小さいはずです。それでも、認証情報が切れる直前に作った URL は、5 分もたずに切れることになります。「7 日間有効な共有リンク」のようなものを Lambda から作っても、7 日はもちません。長い期限が要るなら、別の仕組みを考えてください。

06章で見た「無効にしても、しばらく通る」と、ちょうど逆向きの話です。あちらは、止めたいのに期限まで通る。こちらは、通したいのに期限の前に止まる。どちらも、検証する側が手元の情報だけで判断することから来ています。
