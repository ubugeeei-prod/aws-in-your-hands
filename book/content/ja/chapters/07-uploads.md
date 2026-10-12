---
title: "07 File Upload: presigned URL と S3"
revision: 1
---

# 07 File Upload: presigned URL と S3

サインインできて、自分のノートだけを読み書きできるようになりました。次は、ノートに画像を付けます。

この章では、ブラウザが画像を S3 に直接送ります。API は画像を一度も受け取りません。API がやるのは、「この人は、この場所に、この種類の、この大きさまでの画像を 1 枚置いてよい」という許可証を出すことだけです。

前提は [06章](/ja/chapters/06-auth.md)です。コードは `examples/07-uploads/` にあります。ノートの保存は 05章、サインインと認可は 06章のコードをそのまま import して使うので、この章で書くのは添付で増えるところだけです。

## 全体像

<!-- section: 07.architecture -->

```figure
caption: ブラウザは API から許可をもらい、画像は S3 に直接送り、S3 から直接読む
type: sequence
actor browser: Browser | SPA
actor api: API Gateway + Lambda | Authorization: Bearer <access token>
actor s3: S3 bucket | Block Public Access on
note browser: body: { contentType }
step browser -> api: 1. POST /notes/{id}/attachments
step api -> api: 呼び出し元の sub の下でノートを探す
step api -> api: key = u/<sub>/<note id>/<attachment id>
step api -> api: role の認証情報で POST policy に署名
step api --> browser: 201 attachmentId, upload: url, fields
step browser -> s3: 2. POST fields, file (token なし)
step s3 --> browser: 204。policy を満たさなければ 4xx
note s3: tag: upload-state=pending
step browser -> api: 3. PUT .../attachments/{attachmentId}
step api -> s3: HeadObject
step api -> s3: DeleteObjectTagging
step api -> api: DynamoDB PutItem (ATTACHMENT#...)
step browser -> api: 4. GET /notes/{id}/attachments
step api --> browser: id, size, url (presigned GET, 5 min)
step browser -> s3: 5. img src = presigned GET (token なし)
mark s3
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

この章でやっている対策は 2 つです。許す種類を 4 つの画像形式に絞ること（SVG は script を含められるので外しました）。それから、画像をアプリとは別の origin（S3 のドメイン）から配ること。中身を検査したいなら、アップロードの後で動く処理が要ります（[08章](/ja/chapters/08-async.md)で足します）。

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
