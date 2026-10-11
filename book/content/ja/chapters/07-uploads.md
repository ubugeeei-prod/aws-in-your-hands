---
title: "07 画像をアップロードする: presigned URL と S3"
revision: 1
---

# 07 画像をアップロードする: presigned URL と S3

サインインできて、自分のノートだけを読み書きできるようになりました。次は、ノートに画像を付けます。

この章では、ブラウザが画像を S3 に直接送ります。API は画像を一度も受け取りません。API がやるのは、「この人は、この場所に、この種類の、この大きさまでの画像を 1 枚置いてよい」という許可証を出すことだけです。

前提は [06章](/ja/chapters/06-auth.md)です。コードは `examples/07-uploads/` にあります。ノートの保存は 05章、サインインと認可は 06章のコードをそのまま import して使うので、この章で書くのは添付で増えるところだけです。

## 全体像

<!-- section: 07.architecture -->

```text
Browser (SPA)
  |  1. POST /notes/{id}/attachments   Authorization: Bearer <access token>
  |       body: { contentType }           -> 201 { attachmentId, upload: { url, fields }, ... }
  v
API Gateway HTTP API -> Lambda function
  |     note is looked up under the caller's sub; key = u/<sub>/<note id>/<attachment id>
  |     signs a POST policy with the execution role's credentials (no request to S3)
  |
Browser
  |  2. POST https://<bucket>.s3.ap-northeast-1.amazonaws.com/   (multipart/form-data, no access token)
  |       fields..., file                 -> 204, or 4xx when the policy is not met
  v
S3 bucket (Block Public Access on)        object tagged upload-state=pending
  ^
  |  3. PUT /notes/{id}/attachments/{attachmentId}   Authorization: Bearer <access token>
  |       Lambda: HeadObject -> DeleteObjectTagging -> DynamoDB PutItem (ATTACHMENT#...)
  |
  |  4. GET /notes/{id}/attachments       -> [{ id, size, url (presigned GET, 5 min) }]
Browser
  |  5. <img src="presigned GET URL">     (no access token)
  v
S3 bucket
```

新しく出てくるのは、アップロード用の bucket が 1 つ。それと、06章の table に増える「添付の記録」です。

### なぜ API を通さないのか

画像を API に送って、Lambda から S3 に書く。素直に考えるとそうなりますよね。でも、やりません。

Lambda を通すと、画像の大きさのぶんだけ関数が動いて、メモリを使います。それに、Lambda が 1 回の呼び出しで受け取れるのは 6 MB までです。画像を運ぶのは S3 の得意なことなので、S3 に直接やってもらいます。

そのかわり、困ることが 1 つ出てきます。S3 は、06章の access token を知りません。ブラウザが S3 に直接話しかけるとき、「この人は誰で、何をしてよいか」を、どうやって S3 に伝えるか。その答えが presigned URL です。

### 3 回に分かれる

図の 1、2、3 を見てください。添付は、3 つの別々のリクエストでできています。許可をもらう、S3 に送る、送ったと伝える。

1 つの操作に見えるものが 3 つに分かれると、途中で止まることがあります。2 まで終わって 3 が届かない。3 の途中で関数が落ちる。この章の後半は、ほとんどその話です。

## 許可証を作る

<!-- section: 07.permit -->

まず、決めごとから。

<<< @/examples/07-uploads/api/src/contract.ts{limits}

<<< @/examples/07-uploads/api/src/contract.ts{upload}

呼び出す側が決められるのは、画像の種類だけです。置き場所も、上限の大きさも、リクエストには書けません。書いても無視されます。

### presigned URL が渡すもの

presigned URL は、署名を URL に含めた、期限つきの URL です。S3 へのリクエストは、ふつう AWS の認証情報で署名します。presigned URL は、その署名を先に済ませて、URL に埋め込んだもの。受け取った人は、AWS の認証情報を持っていなくても、その 1 つの操作を実行できます。

公式ドキュメントに、大事なことが 3 つ書いてあります。

- presigned URL が使う権限は、URL を作った principal のもの。その principal にできないことは、URL にもできない
- presigned URL は bearer token である。持っている人なら誰でも使える
- 期限までは、何度でも使える

この章で URL を作るのは Lambda 関数です。つまり、関数の実行 role に許した範囲が、API が配る許可証すべての外枠になります。role の権限を絞る理由が、1 つ増えました。

### 大きさと種類は、どこで守れる？

ブラウザのコードで大きさを確かめても、守ったことにはなりません。確認を飛ばして S3 に直接送れば済むからです。API も画像を見ないので、守れません。守れるのは、画像を受け取る S3 だけです。

S3 に守らせる方法は 2 つあります。

| | presigned PUT | presigned POST（この章） |
| --- | --- | --- |
| 形 | 署名つきの URL に `PUT` で送る | 署名つきの policy を form に入れて `POST` で送る |
| 種類 | `Content-Type` を署名に含めると、同じ値でしか送れない | policy の条件で一致を要求できる |
| 大きさ | 範囲を指定する仕組みはない | `content-length-range` で最小と最大を指定できる |
| 上書きの禁止 | `If-None-Match` が使える操作に `PutObject` がある | その一覧に POST Object はない |

選んだのは POST です。「5 MB まで」を S3 自身に拒否させる方法が、公式ドキュメントにはっきり書いてあるのがこちらだからです。POST policy は、アップロードが満たすべき条件を並べた文書で、`content-length-range` は「アップロードされる内容の、許される最小と最大の大きさ」と説明されています。

PUT でも、API が先に大きさを聞いて、`Content-Length` を署名に含めれば、その大きさでしか送れなくなるはずです。ただ、公式ドキュメントにあるのは「送るつもりのヘッダーはすべて署名するとよい」という一般的な勧めまでで、`Content-Length` についての記述は確認できませんでした。確かめられていないものを、守りの柱にはしません。

POST を選んだ代わりに手放したものもあります。表の最後の行です。これは「残ったものを片付ける」でもう一度出てきます。

<<< @/examples/07-uploads/api/src/s3-object-store.ts{presign-upload}

`createPresignedPost` は、S3 にリクエストを送りません。関数の中で計算して署名するだけです。S3 が policy を確かめるのは、あとでブラウザの POST が届いたときです。

`Fields` に入れた値は、それぞれ「完全に一致すること」という条件になります。key、`Content-Type`、tag。それに大きさの範囲と期限（5 分）。ブラウザに選ばせるものは残していません。`starts-with` のような、幅のある条件は 1 つも使っていないことを、テストで確かめています。

正直に言うと、ここは実物の S3 で通せていません。とくに、tag を form で送ること。POST Object のドキュメントには `tagging` という欄があります。でも、POST policy の条件の表に `tagging` という名前は載っていません。「form の欄は、すべて条件に書かなければならない」という規則があるので、SDK が作る `{"tagging": "..."}` という条件で通るはずだ、と読みました。確かめる手順は、章末のメモにあります。

### S3 が見ないもの

S3 が確かめるのは、form に書かれた `Content-Type` が policy と一致することです。ファイルの中身が本当に PNG かどうかは見ません。`image/png` と名乗る HTML も置けます。

この章でやっている対策は 2 つです。許す種類を 4 つの画像形式に絞ること（SVG は script を含められるので外しました）。それから、画像をアプリとは別の origin（S3 のドメイン）から配ること。中身を検査したいなら、アップロードの後で動く処理が要ります（08章の予定）。

## key は API が決める

<!-- section: 07.keys -->

object key は、bucket の中で object を指す名前です。`/` を含められますが、フォルダーがあるわけではありません。

<<< @/examples/07-uploads/api/src/keys.ts{keys}

key は `u/<持ち主>/<ノートの ID>/<添付の ID>` です。3 つの部分は、すべてサーバーが決めます。持ち主は検証済みの token の `sub`。ノートの ID は、その持ち主の下で実在を確かめたもの。添付の ID は、時刻と乱数から作ります。

ファイル名は key に入れません。利用者が打った文字列を key に入れると、`../` や `/` で他人の場所を指せないか、毎回心配することになります。入れなければ、心配の対象がありません。

<<< @/examples/07-uploads/api/src/attachments.ts{request-upload}

06章の考え方の続きです。「このノートは、この人のものか」を確かめる if 文はありません。ノートを、呼び出した人の `sub` の下で探すだけ。他人のノートは見つからないので、404 です。403 を返さないのも 06章と同じ理由で、ノートの ID が使われているかどうかを教えないためです。

<<< @/examples/07-uploads/api/src/app.ts{routes}

route は、06章のアプリにそのまま足しています。サインインを確かめる middleware は 06章のものが先に登録されているので、足した 4 つの route も、token なしでは 401 です。

テストは、こう壊しにいきます。

- Bob が Alice のノートに許可を求めると、存在しないノートと同じ 404 が返る
- Bob が query、ヘッダー、body のすべてに Alice の名前と Alice の key を書いても、返ってくる key は `u/bob/` で始まる
- Bob は、Alice の添付の ID を知っていても、完了も、一覧も、削除もできない
- key の部品に `/`、`..`、空文字が入ると、key を組み立てる関数が例外を投げる

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

定期的に自動で動かすなら、scheduler が要ります（08章の予定）。

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

## 手元で動かす

<!-- section: 07.local -->

`examples/07-uploads/.env.example` を、同じ場所に `.env` という名前でコピーします。

<<< @/examples/07-uploads/.env.example

ターミナルを 2 つ使います。

```bash
vp run dev:uploads:api
vp run dev:uploads:web
```

<http://localhost:5173> を開いて、サインインして、ノートを作って開きます。「Images」の下でファイルを選ぶと、画像が付きます。別のブラウザで `bob` としてサインインしても、Alice のノートも画像も見えません。

Docker も、AWS の認証情報も、bucket も要りません。

### S3 の代わり

<<< @/examples/07-uploads/api/src/object-store.ts{port}

アプリは、「bytes を置く場所」をこの interface として受け取ります。AWS 上では S3、手元ではメモリ上の実装です。

<<< @/examples/07-uploads/api/src/local-store-http.ts{local-store}

<<< @/examples/07-uploads/api/src/dev.ts{dev}

手元の実装は、開発サーバーの中に form の受け口を持っています。許可証には、開発用の秘密で署名した小さな policy を入れてあって、違う key、違う種類、大きすぎるファイル、期限切れを拒否します。

これは S3 の模擬ではありません。アプリの順序と認可を動かすための代わりです。再現しないものを挙げておきます。

- POST policy の実際の評価。S3 が何を、どんな応答で拒否するか
- bucket の CORS。手元では開発サーバーが自分で CORS のヘッダーを返す
- IAM。実行 role の権限が足りているか
- lifecycle rule。手元では、pending の object はいつまでも残る
- 認証情報の失効で URL が早く切れること

S3 互換のサーバーをコンテナで動かせば、もう少し本物に近づけます。そのためには Docker が要ります。Docker の daemon は Nix の shell に含まれません。この章は、そういうタスクを用意していません。執筆した環境では daemon が動いていなかったので、試してもいません。

### 画面

SPA は、06章の `web/` を土台にしています。サインイン、設定の読み込み、route の解釈は、06章のファイルをそのまま import しています。足したのは、ノートの編集画面の下に出る画像の欄だけです。

<<< @/examples/07-uploads/web/src/check-file.ts{check-file}

ファイルを選んだら、種類と大きさをブラウザの側でも確かめます。これは親切であって、守りではありません。確認を通らないファイルを直接送っても、S3 が拒否します（手元では、メモリ上の実装が拒否します）。

## AWS にのせる準備

<!-- section: 07.infra -->

stack（`AihUploads`）は、06章の stack に、bucket を 1 つ、権限を 2 つ、route を 4 つ足したものです。

### bucket

<<< @/examples/07-uploads/infra/lib/uploads-stack.ts{uploads-bucket}

Block Public Access は、4 つの設定を全部有効にしています。ACL でも bucket policy でも、この bucket の object は公開できません。presigned URL は「公開」ではなく、role が署名したリクエストなので、この設定の下でも使えます。

CORS は、origin を 2 つ（デプロイした SPA と、手元の開発サーバー）、method を `POST` だけにしています。ブラウザの JavaScript が、別の origin への POST の結果を読むために要ります。`<img>` で画像を表示するのに CORS の規則は要らないので、`GET` は入れていません。

lifecycle rule は 2 つ。1 つは、さっきの pending の掃除です。もう 1 つは、未完了の multipart upload の中止。multipart upload は、大きな object を分割して送る仕組みで、完了も中止もされなかった part は、保存されたまま料金がかかり続けます。この章のアプリは multipart upload を始めません。それでも入れてあるのは、公式ドキュメントがこの規則を勧めているのと、あとで大きなファイルに対応したときに忘れないためです。

`removalPolicy` は `DESTROY` です。stack を消すと、空にした bucket が消えます。

### 関数にできること

<<< @/examples/07-uploads/infra/lib/uploads-stack.ts{uploads-role}

関数に許すのは、`u/` で始まる key への 5 つの操作です。`s3:PutObject` と `s3:PutObjectTagging` は、関数自身は呼びません。ブラウザのアップロードが、関数の署名を使って実行します。署名した role に権限がなければ、許可証は使えません。

`s3:ListBucket` は、一覧のためではありません。公式ドキュメントによると、存在しない key への `HeadObject` は、呼び出し側にこの権限があれば 404、なければ 403 を返します。403 では、「まだ送られていない」と「権限がない」の区別がつきません。

<<< @/examples/07-uploads/infra/lib/uploads-stack.ts{routes}

テストは、template に対して次を確かめます。

- 2 つの bucket がどちらも、Block Public Access の 4 つの設定を有効にしている
- アップロード用の bucket の policy に、`Allow` が 1 つもない
- CORS の規則が 1 つで、method が `POST` だけ、`*` を含まない
- lifecycle rule が、pending の tag と multipart upload の 2 つである
- 関数の S3 の権限が、上の 6 つの操作だけで、`*` の action も `*` の resource もない
- `/health` 以外のすべての route に、足した 4 つも含めて、JWT authorizer と scope が付いている

使っているリソースの種類は、06章と同じ 19 種類です。アップロード用の bucket は、新しい種類を足しません。固定した版の cdkd は、`AWS::S3::Bucket` に専用の実装を持っていて、lifecycle と CORS の設定を扱うコードがあることを、パッケージの中で確かめました。専用の実装がない 3 種類（`AWS::CloudFront::Function`、`AWS::Cognito::UserPoolClient`、`AWS::Cognito::UserPoolDomain`）は、06章と同じです。

## デプロイする

<!-- section: 07.deploy -->

ここから先は、実行していません。手順とタスクを用意したところまでです。

```bash
vp run uploads:infra:diff
vp run uploads:infra:deploy
vp run uploads:user:create you@example.com
vp run uploads:publish
vp run uploads:smoke:web
vp run uploads:smoke:api
```

流れは 06章と同じです。違うのは `uploads:smoke:api` で、環境変数 `AIH_ACCESS_TOKEN` に access token を入れて実行すると、本物の bucket に対して次を試します。

- 大きすぎるファイル、違う `Content-Type`、違う key の 3 つを、S3 が拒否すること
- 小さな PNG が送れて、完了できて、一覧に出ること
- 返ってきた URL が、token なしで画像を返すこと
- 削除すると、同じ URL が画像を返さなくなること

この章の「まだ」は、ほとんどこのタスクで確かめられます。token を入れなかった場合は、token なしのリクエストが拒否されることだけを確かめて、「アップロードの経路は確かめていない」と表示します。

06章の stack（`AihNotesApp`）とは、別の stack です。user pool も table も別なので、両方をデプロイすると、利用者もノートも別々になります。

drift の検査は、これまでと同じです。

```bash
vp run uploads:infra:drift
```

## R2 から来た人へ

Cloudflare R2 にも presigned URL があります。R2 の公式ドキュメントによると、対応する操作は `GET`、`HEAD`、`PUT`、`DELETE` で、HTML form による POST のアップロードには、いまのところ対応していません。つまり、この章の `content-length-range` を使うやり方は、R2 にはそのまま持っていけません。同じドキュメントは、presigned URL が S3 API のドメインでだけ動いて、custom domain では使えないこと、bearer token として扱うべきことも書いています。

Workers から R2 を使うなら、presigned URL を使わずに、binding で Worker の中から読み書きする構成も多いと思います。その場合、画像は Worker を通ります。この章が避けた「関数を通す」やり方ですが、Worker と Lambda では、通したときの制約も料金も違います。そちらの制約と料金は、確認していません。

## お金の話

金額は USD、東京リージョン、税別です。計算の入力と単価は[料金の計算](/ja/reference/pricing.md)にあります。

S3 でかかるのは、3 つです。保存している量（最初の 50 TB まで、1 GB あたり月 USD 0.025）。リクエストの数（PUT、POST、LIST は 1,000 件あたり USD 0.0047、GET などは 10,000 件あたり USD 0.0037）。そして、S3 からインターネットへ出ていくデータの量（最初の 10 TB まで、1 GB あたり USD 0.114）。インターネットから S3 へ入るデータは、USD 0 です。

例を 1 つ。月に 10,000 枚、1 枚 1 MB の画像がアップロードされて、画像が 100,000 回表示される場合です。06章のアプリの料金に上乗せされる分だけを数えます。

| 対象 | 定価 |
| --- | --- |
| S3 の保存（10 GB） | 0.25 |
| S3 のリクエスト（POST 10,000、HEAD 10,000、GET 100,000） | 0.09 |
| S3 からのデータ転送（約 97.7 GB） | 11.13 |
| API の側（API Gateway、Lambda、ログ、DynamoDB の 120,000 リクエスト分） | 0.29 |
| 小計 | **11.76** |

見てのとおり、ほとんどがデータ転送です。画像は、置くより配るほうにお金がかかります。この計算は、ブラウザの cache がまったく効かないと仮定しています。presigned URL は毎回違うので、同じ画像でも URL が変わると、ブラウザは読み直します。表示が多いアプリでは、CloudFront を前に置く構成を検討してください。

毎月の無料枠を引いた後の小計は 11.67 です。ただ、引いているのは Lambda とログの無料枠で、これは 06章の利用分と共有です。06章の例のように月 100 万リクエストを使っていれば、Lambda の無料枠はもう残っていません。データ転送の単価には「無料枠を超えた分」という説明が付いていますが、その無料枠の大きさは確認できていないので、何も引いていません。S3 の無料枠も同じ扱いです。

tag の保存にも料金がありますが、tag が付いているのは完了するまでの間だけなので、計算に入れていません。tag を外すリクエストは、公式ドキュメントによると請求されません。

**誰も使わない月でも、置いてある画像の保存料金はかかります。** 10 GB なら月 USD 0.25 です。孤立した object も同じ単価で数えられます。掃除が要るのは、このためです。

stack を消すと、bucket も中の画像も消えます。残るものは「片付け」に書いたとおりです。

## ハマりどころ

| こうなったら | ここを見る |
| --- | --- |
| `dev:uploads:api` が `UPLOADS_STORE` と言って止まる | `examples/07-uploads/.env` はありますか。`.env.example` をコピーしてください |
| 画面に「The upload was refused (HTTP 403)」と出る | 許可証をもらってから 5 分以上たっていませんか。もう一度ファイルを選んでください |
| S3 への POST が 403 を返す | form の欄の値が policy と違うと、条件を満たしません。SDK が返した `fields` をそのまま、`file` の欄を最後にして送っていますか。S3 が実際に返す応答の中身は、まだ確かめていません |
| S3 への POST が、ブラウザのコンソールでは CORS のエラーになる | SPA の origin が、bucket の CORS の `AllowedOrigins` と完全に一致していますか。まず `curl` で状態コードを見てください |
| 完了の呼び出しが 409 `upload_missing` を返す | S3 への POST は 204 を返しましたか。返していなければ、object はありません |
| 完了の呼び出しが 500 を返し、ログに 403 がある | 実行 role に `s3:ListBucket` がないと、存在しない key への `HeadObject` は 403 になります |
| 完了の呼び出しが 409 `upload_rejected` を返す | 送ってから 15 分以上たっています。もう一度送ってください |
| 画像がしばらくすると表示されなくなる | URL の期限（5 分）です。画面は一覧を取り直します。直らなければ、object が消えています |
| S3 が `ExpiredToken` を返す | URL に署名した認証情報が失効しています。一覧を取り直すと、新しい認証情報で署名した URL が返ります |

## 本番にするなら

- **同じ form の再送を閉じる。** 「この設計に残る穴」のとおりです
- **掃除を定期的に動かす。** 手で実行するタスクのままでは、いつか忘れます（08章の予定）
- **中身を確かめる。** S3 は、ファイルが本当に画像かどうかを見ません。アップロードの後で検査する処理を足します
- **配り方を見直す。** 表示が多いなら CloudFront を前に置きます。データ転送の料金と、cache の効き方が変わります
- **bucket を守る。** `removalPolicy` を `RETAIN` にして、versioning を検討します。versioning を有効にすると、lifecycle rule の動きも変わります
- **利用者ごとの上限を決める。** この章の上限は、ノート 1 つに 10 枚だけです。利用者 1 人が作れるノートの数には上限がありません
- **手元の origin を外す。** bucket の CORS と API の CORS から `http://localhost:5173` を消します
- **アクセスの記録を取る。** presigned URL が誰に使われたかは、API のログには残りません。S3 の側の記録が要ります（19章の予定）

## 片付け

<!-- section: 07.cleanup -->

```bash
vp run uploads:empty --yes
vp run uploads:unpublish --yes
vp run uploads:infra:destroy
```

固定した版の cdkd は、空でない bucket を消しません。先に 2 つの bucket を空にします。`uploads:empty` はアップロードされた画像を、`uploads:unpublish` は SPA のファイルを消します。どちらも、`--yes` を付けなければ、数を数えるだけです。

`uploads:infra:destroy` で、bucket、table、user pool、関数、API、distribution が消えます。画像も、ノートも、利用者も、元には戻せません。

残るのは、cdkd の bootstrap で作った保存場所（02章）と、そこに置かれたデプロイ用のファイルだけです。

::: details この章の検証メモ

**手元で確かめたこと。** API のテスト（認可、許可証の中身、完了、期限、上限）、途中で止めるテスト（上の表の 6 行と、掃除、同じ form の再送）、key の組み立て、SDK が作る POST policy と presigned GET の中身（偽の認証情報で署名しただけで、S3 には送っていません）、DynamoDB へのリクエストの形、インフラの assertion、型検査、SPA のビルド、synth。それから、`dev:uploads:api` と `dev:uploads:web` を起動して、ブラウザを自動操作して次を確かめました。サインイン、ノートの作成、ファイルを選んで画像が表示されること、別の利用者からの許可・一覧・完了が 404 になること、大きすぎるファイル・違う種類・違う key が拒否されること、完了を 2 回呼んでも同じ結果になること、削除とノートの削除の後に画像の URL が読めなくなること。

**まだ確かめていないこと。** AWS に対しては、何も実行していません。`uploads:infra:deploy`、`uploads:user:create`、`uploads:publish`、`uploads:smoke:web`、`uploads:smoke:api`、`uploads:sweep`、`uploads:infra:drift`、`uploads:empty`、`uploads:unpublish`、`uploads:infra:destroy` のどれもです。したがって、次は実物の S3 で確かめていません。`tagging` の欄を含む presigned POST を S3 が受け付けること。`content-length-range` と `Content-Type` の条件で S3 が拒否すること、そのときの応答。ブラウザからの POST が bucket の CORS の規則で通ること。POST の直後の `HeadObject` が object を見つけること（強い整合性の説明は PUT と DELETE を名指ししていて、POST Object は名指ししていません）。lifecycle rule が pending の object を消すこと。`DeleteObjectTagging` の後は消されないこと。DynamoDB 用の実装（`dynamodb-attachment-repository.ts`）は、リクエストの形をテストで固定しただけで、DynamoDB Local にも実物にも送っていません。実行 role の認証情報の寿命は、公式ドキュメントで確認できませんでした。S3 互換のローカル実装は使っていません（Docker の daemon が動いていませんでした）。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 許可証を作る | `examples/07-uploads/api/src/contract.ts`、`api/src/object-store.ts`、`api/src/s3-object-store.ts`、`api/test/s3-object-store.test.ts` | `test:unit` |
| key は API が決める | `examples/07-uploads/api/src/keys.ts`、`api/src/attachments.ts`、`api/src/app.ts`、`api/test/keys.test.ts`、`api/test/app.test.ts` | `test:unit` |
| 2 つの置き場所、1 つの順序 | `examples/07-uploads/api/src/attachments.ts`、`api/src/attachment-repository.ts`、`api/src/dynamodb-attachment-repository.ts`、`api/src/client.ts`、`api/test/partial-failure.test.ts`、`api/test/harness.ts` | `test:unit` |
| 残ったものを片付ける | `examples/07-uploads/api/src/sweep.ts`、`scripts/sweep.ts`、`infra/lib/uploads-stack.ts` | `test:unit`、`uploads:sweep` |
| 画像を見せる | `examples/07-uploads/api/src/s3-object-store.ts`、`api/src/attachments.ts`、`api/src/lambda.ts` | `test:unit` |
| 手元で動かす | `examples/07-uploads/api/src/dev.ts`、`api/src/memory-object-store.ts`、`api/src/local-store-http.ts`、`api/src/compose.ts`、`api/src/env.ts`、`.env.example`、`web/` | `dev:uploads:api`、`dev:uploads:web`、`typecheck:uploads:web`、`lint:uploads:web`、`build:uploads:web` |
| AWS にのせる準備 | `examples/07-uploads/infra/lib/uploads-stack.ts`、`infra/bin/app.ts`、`infra/test/uploads-stack.test.ts`、`cdk.json` | `uploads:infra:synth`、`test:unit` |
| デプロイする | `examples/07-uploads/scripts/write-config.ts`、`scripts/user.ts`、`scripts/smoke.ts`、`tools/src/site/`、`tools/src/infra/` | `uploads:infra:diff`、`uploads:infra:deploy`、`uploads:user:create`、`uploads:publish`、`uploads:smoke:web`、`uploads:smoke:api`、`uploads:infra:drift` |
| 片付け | `examples/07-uploads/scripts/empty-uploads.ts`、`scripts/user.ts`、`tools/src/site/unpublish.ts` | `uploads:empty`、`uploads:unpublish`、`uploads:infra:destroy`、`uploads:user:delete` |
| お金の話 | `data/pricing/` | `test:unit` |

**一次情報**（確認日はすべて 2026-10-11）

- [Download and upload objects with presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)、[Uploading objects with presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html)
- [POST Policy](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sigv4-HTTPPOSTConstructPolicy.html)、[POST Object](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/RESTObjectPOST.html)、[Authenticating Requests: Using Query Parameters](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sigv4-query-string-auth.html)。この 3 つは、確認日の時点で `/AmazonS3/latest/API/` の下の以前の URL が目次へ redirect されたので、`/developerguide/` の下で読みました
- [How to prevent object overwrites with conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)
- [HeadObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html)
- [Working with Lambda environment variables](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html)、[Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)
- [Expiring objects](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-expire-general-considerations.html)、[Configuring a bucket lifecycle configuration to delete incomplete multipart uploads](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpu-abort-incomplete-mpu-lifecycle-config.html)、[Tagging your objects](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-tagging.html)
- [Using cross-origin resource sharing (CORS)](https://docs.aws.amazon.com/AmazonS3/latest/userguide/cors.html)、[Elements of a CORS configuration](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ManageCorsUsing.html)、[Blocking public access to your Amazon S3 storage](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html)
- [What is Amazon S3?](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html)（強い整合性）
- AWS Price List bulk API: [S3](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ap-northeast-1/index.json)、[Data Transfer](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/ap-northeast-1/index.json)
- [@aws-sdk/s3-presigned-post 3.1149.0](https://www.npmjs.com/package/@aws-sdk/s3-presigned-post/v/3.1149.0)（型定義とソース）
- [Cloudflare R2: Presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)

:::
