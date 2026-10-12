---
title: "15 Email: SES"
revision: 3
---

# 15 Email: SES

04章で作った API の隣に、「ノートを共有しました」という通知メールを 1 通送る API を足します。送信には Amazon SES を使います。

メールは、送信 API を呼んだだけでは仕事が終わりません。宛先が存在しなかったり、迷惑メールとして報告されたり、送れたのかどうかが送った側にもわからなかったりするからです。この章では、そうした結果を受け取って記録するところまで作ります。手元で動かすだけなら、AWS のアカウントも本物のメールアドレスも要りません。

始める前に、知っておいてほしいことが 3 つあります。

- 前提は [04章](/ja/chapters/04-http-api.md)です。記録の置き場所に DynamoDB を使いますが、必要なことはこの章で説明します（詳しくは [05章](/ja/chapters/05-dynamodb.md)）
- アウトラインでは [08章](/ja/chapters/08-async.md)のキューの先に置く予定でしたが、実際にはこの章だけで動くレシピにしました。キューとつなぐ方法は、関係する箇所で案内します
- AWS で動かすと、本物のメールが送られます。送信元の確認、DNS の設定、送信制限の解除の申請は、人が手で進める作業です。この章は手順とコマンドを用意しますが、作業そのものを代行はしません

コードは `examples/15-email/` にあります。

## 全体像

<!-- section: 15.architecture -->

```figure
caption: 送る流れは API から SES へ下り、結果は SNS を通って同じテーブルに戻る
node caller: Caller | 別のバックエンド、または vp run mail:send
node api: API Gateway HTTP API | ap-northeast-1、どのルートも IAM 認可
node fn: Lambda "ApiHandler"
node ses: SES | identity: 自分のアドレスかドメイン
node table: DynamoDB テーブル "Mail" | NOTIFICATION#<id>, SUPPRESSION#<address>
node sns: SNS トピック "MailEvents" | Delivery / Bounce / Complaint
node recipient: 相手のメールサーバー
node events: Lambda "EventsHandler"
edge caller -> api: HTTPS、SigV4 で署名
edge api -> fn: POST, GET /share-notifications; GET /health
edge fn -> ses: 2. SendEmail（宛先 1 件、タグ notification_id）
edge fn -> table: 1. 先取り（条件付き書き込み）、3. sent にする
edge ses -> recipient
edge ses --> sns: あとから、configuration set を通って
edge sns -> events
edge events -> table: 送信停止の記録、状態を進める
mark ses
```

図には流れが 2 つあります。Caller から API と関数を通って SES へ進むのが送る流れで、SES から SNS を通ってテーブルに戻るのが、結果を受け取る流れです。

呼ぶ側は、通知に自分で名前（`notificationId`）を付けて API に依頼します。関数は、まず DynamoDB に「この通知は自分が送る」と記録してから、メールを SES に渡します。SES は受け取ったメールを、相手のメールサーバーへ届けにいきます。

メールが届いたか、届かずに戻ってきたか（bounce）、迷惑メールとして報告されたか（complaint）は、SES が後から知らせます。知らせは SNS のトピックを通ってもう 1 つの関数に届き、この関数が、今後送らない宛先の一覧（suppression list）と通知ごとの状態をテーブルに書きます。

この構成で状態を持っているのは、テーブルだけです。04章で見たとおり、関数のメモリには何も置けません。

### 入口を開けっぱなしにしない

04章の API は、URL を知っていれば誰でも呼べました。メールを送る API を同じように公開すると、見知らぬ誰かが好きな宛先へメールを送るための踏み台になります。

そこで、この章のルートにはすべて IAM の認可を付けています。呼ぶ側は、AWS の認証情報でリクエストに署名（SigV4）しなければなりません。通知を送るのはノートを共有した処理、つまり別のバックエンドなので、ブラウザから呼ぶ想定はなく、CORS も設定していません。

認可を通った相手にも、歯止めを 1 つ置いています。ステージのスロットリングで、API 全体で 1 秒に 10 件、バーストは 20 件までに抑えます。権限を持ったスクリプトがループに入っても、超えたぶんは API Gateway が 429 で断るので、関数も SES も呼ばれません。

`GET /share-notifications/{id}` は、通知の状態と一緒に宛先のアドレスも返します。ID は呼ぶ側が決めた文字列なので、この API を呼べる相手は、ID を知っているか推測できれば、その通知が誰宛てかを読めます。この章がそうしているのは、API を呼ぶのは通知を送ったバックエンド自身だけ、という前提を置いているからです。呼ぶ側が複数あるなら、宛先を返さないように変えてください。

[06章](/ja/chapters/06-auth.md)の JWT authorizer を使う方法もあります。その場合は、宛先をサーバー側で決めてください。呼ぶ側が宛先を指定できるままだと、サインインした人なら誰でも好きな宛先に送れる API になります。

### 別の形にするなら

- **API を挟まず、キューから送る。** 共有の処理がキューにメッセージを入れ、関数がそれを取り出して送る形です。呼ぶ側は、SES の応答が遅いときや失敗したときに待たされません。キューとワーカーの作り方は [08章](/ja/chapters/08-async.md)にあります。この章の `sendShareNotification` は、そのままキューの先に置けるように書いてあります
- **SNS と関数の間にキューを挟む。** イベントを SNS から直接 Lambda に渡す代わりにキューを通すと、処理に失敗したイベントを取っておけます。これも 08章の内容です
- SES を使わない形もあります。送信元の評判の管理や、送信制限の解除の申請を自分で抱えたくないなら、メール送信の SaaS のほうが楽な場面があります。SES は安く、AWS の権限と一緒に管理できますが、[デプロイのページ](/ja/chapters/15-email/deploy.md)で見る確認と申請の作業が付いてきます

## まずメールを組み立てる

<!-- section: 15.message -->

AWS の話に入る前に、メールそのものを作ります。API が受け取る依頼は、次の形です。

<<< @/examples/15-email/src/contract.ts{request}

宛先は 1 つだけです。リンク先の URL は受け取らず、ノートの ID だけを受け取って、URL はサーバーが自分の設定から組み立てます。呼ぶ側が URL を渡せると、この API は、あなたのドメインから好きなリンク入りのメールを送る道具になってしまうからです。

### ヘッダーに改行を入れさせない

メールは、`Subject: ...` や `To: ...` のようなヘッダーが 1 行ずつ並び、その後に本文が続くテキストです。そのため、件名に入れる文字列に改行が混ざっていると、改行から先が次のヘッダーとして読まれるおそれがあります。

ノートの題名を付けるのは利用者です。題名が `Trip plan\r\nBcc: attacker@example.com` だった場合、そのまま件名に入れると `Bcc` のヘッダーが 1 つ増えます。この攻撃をヘッダーインジェクションと呼びます。

<<< @/examples/15-email/src/contract.ts{header-safe}

題名と名前は、改行か制御文字を含んでいたら拒否します。黙って取り除かないのは、そういう入力が来たことを呼ぶ側に知らせたいからです。宛先は、アドレス 1 つとして読めるものだけを通します。カンマ区切りの一覧も、`名前 <アドレス>` の形も通りません。

メールを組み立てるのは純粋関数です。

<<< @/examples/15-email/src/message.ts{build}

入口のスキーマで確かめた値を、この関数でもう一度確かめています。将来、スキーマを通さずにこの関数を呼ぶコードが書かれても、改行はヘッダーまで届きません。

SES がこの改行をどう扱うかは、確かめていません。この章の送り方（後で出てくる `Simple` 形式）では、ヘッダーを組み立てるのは SES で、こちらのコードは 1 行も書きません。それでも送る前に自分の側で拒否しておけば、SES の挙動に頼らずに済みます。

HTML の本文には、別の穴があります。題名に `<script>` や `<a href=...>` が入っていると、そのまま HTML として解釈されます。

<<< @/examples/15-email/src/message.ts{escape}

利用者が書いた文字列は、HTML に入れる前に必ずこの関数を通します。テストでは、改行入りの題名、宛先の一覧、`<script>` 入りの名前を、それぞれ渡して確かめています。

## 送る部品は差し替えられるようにする

<!-- section: 15.adapters -->

04章でノートの保存先をインターフェースにしたのと同じように、メールの送信もインターフェースにします。

<<< @/examples/15-email/src/mailer.ts{mailer}

送信の結果は 3 通りあります。

- `accepted`: 送信サービスが受け取った
- `rejected`: 送信サービスが断った。何も送られていない
- 例外: どうなったか、わからない

例外を `rejected` と同じに扱わないことが、この設計の要点です。次の節で、再送してよいかどうかをこの区別で決めます。

手元で使うのは、何も送らない実装です。

<<< @/examples/15-email/src/mailer.ts{outbox}

送るはずだったメールは、配列に溜まるだけです。開発サーバーとテストは、この実装を使います。

SES を呼ぶ実装は次のとおりです。

<<< @/examples/15-email/src/ses-mailer.ts{ses}

呼んでいるのは SES API v2 の `SendEmail` です。`Simple` 形式なので、件名と本文を渡せば、メールの形に組み立てる作業は SES が引き受けます。

エラーは 2 つに読み分けています。SES が 4xx で答えたときは、リクエストを読んだうえで断ったということなので、`rejected` にします。それ以外（タイムアウト、接続の切断、5xx）では、SES がメールを受け取ったのかどうかがこちらからはわからないので、例外のまま投げます。

どちらの実装を使うかは、環境変数で決まります。

<<< @/examples/15-email/src/compose.ts{adapters}

`maxAttempts: 1` を指定しているのには理由があります。AWS SDK は、何も指定しなければ、タイムアウトや 5xx のときに自動で再試行します（既定は合計 3 回）。ふだんは助かる機能ですが、メールの送信では、1 回目が実は SES に届いていた場合に SDK の再試行が 2 通目を送ってしまい、しかもこちらの記録には何も残りません。再試行するかどうかは、次の節の仕組みで決めます。

## 記録が先か、送信が先か

<!-- section: 15.order -->

この節が、この章の中心です。

SES の `SendEmail` には、同じ依頼の 2 回目を無視させる仕組み（idempotency token）がありません。同じ内容を 2 回送れば、2 通届きます。

加えて、送信 API が成功を返すことと、メールが届くことは別の出来事です。成功は、SES がメールを受け取ったことしか意味しません。反対に、応答が返ってこなかったからといって、送られていないとも限りません。SES の公式ドキュメントにも、送信のリクエストがエラーを返したのにメールは受け付けられていた、ということがまれにあると書かれています。

応答を失った呼び出し側は、ふつう再試行します。そのとき何が起きるかは、記録と送信のどちらを先にするかで変わります。次の 3 つの図で比べます。

```figure
caption: 送信を先に、記録を後にすると、応答を失ったあとの再試行で 2 通届く
type: sequence
actor caller: Caller
actor fn: Lambda
actor table: DynamoDB | 記録
actor ses: SES
step caller -> fn: share-1 を依頼
step fn -> ses: t1 SendEmail
note ses: SES が受け取る
step ses --x fn: t2 応答が失われる（タイムアウト）
note table: t3 記録は書かれていない
step caller -> fn: t4 share-1 を再試行
step fn -> ses: t5 記録なし、また SendEmail
note ses: 2 通届く
```

```figure
caption: 記録を先に、送信を後にすると（この章）、再試行では何も送られず、届くのは 1 通
type: sequence
actor caller: Caller
actor fn: Lambda
actor table: DynamoDB | 記録
actor ses: SES
step caller -> fn: share-1 を依頼
step fn -> table: t1 share-1 を先取り
note table: 書かれた
step fn -> ses: t2 SendEmail
note ses: SES が受け取る
step ses --x fn: t3 応答が失われる（タイムアウト）
step caller -> fn: t4 share-1 を再試行
step fn -x table: t5 先取りの記録はすでにある
note fn: 何も送らない
note ses: 1 通届く
```

```figure
caption: 記録を先にする代償として、SendEmail の前に関数が止まると 1 通も届かない
type: sequence
actor caller: Caller
actor fn: Lambda
actor table: DynamoDB | 記録
actor ses: SES
step caller -> fn: share-1 を依頼
step fn -> table: t1 share-1 を先取り
note table: 書かれた
note fn: t2 SendEmail の前に止まる
step caller -> fn: t3 share-1 を再試行
step fn -x table: t4 先取りの記録はすでにある
note fn: 何も送らない
note ses: 1 通も届かない
```

送信を先にすると、失敗したときに 2 通届くことがあります。記録を先にすると、失敗したときに 1 通も届かないことがあります。記録と送信は別々のサービスへの別々の呼び出しで、その間で処理が止まることは誰にも防げないので、両方を同時に防ぐ方法はありません。

この章は、**記録を先にします**。守る不変条件は次の 1 文です。

> 同じ `notificationId` で、メールが 2 通以上送られることはない。

共有の通知は、届かなくても、共有した本人が相手に声をかければ済みます。同じ通知が 2 通、3 通と届くほうが、受け取る側には迷惑です。繰り返し届くメールは complaint を招き、complaint は送信元としての評判を落とします。パスワードの再設定のように、届かないと利用者が先に進めないメールなら、送信を先にする選択もありえます。その場合は、重複しても受け取った人が気づける文面にするなどの工夫が要ります。

<<< @/examples/15-email/src/notify.ts{notify}

冪等性を支えているのは、手順 1 の `claim`（先取り）です。「この通知は自分が送る」という記録を、送る前に取ります。取れなかったときは、ほかの依頼がすでに取っているので、何も送りません。

### 先取りは 1 つの操作でやる

記録があるかどうかを読み、無ければ書く、という 2 つの操作に分けると、同時に来た 2 つの依頼がどちらも「無い」と読んで、どちらも書いてしまいます。

DynamoDB は、書き込みに条件を付けられます。条件の確認と書き込みが 1 つの操作として実行されるので、依頼が同時に来ても、通るのは 1 つだけです。

<<< @/examples/15-email/src/dynamodb-store.ts{claim}

条件は「まだ記録が無い」、または「前回は断られていて、同じメールである」です。2 つ目の条件が要る理由は、次の「通知の状態」で説明します。

### 通知の状態

記録は、状態を 1 つ持ちます。

```figure
caption: 通知の状態は先取りで始まり、SES の答えと、あとから届くイベントで進む（ふつうの順序。Delivery と Complaint は、ほかの状態からも進める）
node none: (none)
node claimed: claimed | 応答なし: claimed のまま（自動の再試行はない）
node sent: sent
node rejected: rejected
node delivered: delivered
node complained: complained
edge none -> claimed: 先取り
edge claimed -> sent: SES が受け取る
edge claimed -> rejected: SES が断る
edge rejected -> claimed: 同じ依頼がもう一度
edge sent -> delivered: Delivery
edge delivered -> complained: Complaint
```

```figure
caption: Bounce は、4 つのどの状態にある通知も bounced にする
node claimed: claimed
node rejected: rejected
node sent: sent
node delivered: delivered
node bounced: bounced
edge claimed -> bounced: Bounce
edge rejected -> bounced
edge sent -> bounced
edge delivered -> bounced
```

1 枚目の図に描いたのは、ふつうの順序です。イベントは遅れたり、順番が入れ替わったりして届くので、コードはほかの移り方も受け付けます。Delivery は `claimed`、`rejected`、`sent` のどの状態からでも `delivered` に進めます。Complaint は Bounce と同じで、`claimed`、`rejected`、`sent`、`delivered` のどの状態からでも `complained` に進めます。

`mailer` の 3 通りの結果は、それぞれ別の状態につながります。

SES が受け取った（`accepted`）ときは、状態を `sent` にして、SES が返したメッセージ ID を書きます。この書き込みに失敗しても、呼び出し側には成功を返します。メールはもう出ているので、ここで失敗を返すと、呼び出し側が「送れなかった」と受け取ってしまうからです。

SES が断った（`rejected`）ときは、状態を `rejected` にします。何も送られていないので、同じ依頼をもう一度出せば、先取りし直して送れます。先取りの 2 つ目の条件は、このやり直しを通すためのものです。送信のスロットリングに当たったときが、この場合に当たります。

結果がわからない（例外）ときは、何もしません。記録は `claimed` のまま残り、その記録が再送を止めます。関数が途中で落ちたときや、Lambda のタイムアウトで打ち切られたときも、同じ状態になります。

`claimed` のまま動かない記録が、記録を先にした代償です。この記録は、送れたかもしれないし、送れていないかもしれない通知を表します。この章のコードは、そうした通知を自動では再送しません。あとで Delivery のイベントが届けば状態は `delivered` に進むので、送れていたことがわかります。イベントが届かなければ、人が見て判断します。

`rejected` にも、小さな穴が残っています。SES がエラーを返したのにメールを受け付けていた場合、やり直しで 2 通目が出ます。Delivery のイベントが先に届けば、記録は `delivered` に進んで、やり直しは止まります。イベントが届く前のやり直しは止められません。この穴まで塞ぐには、エラーをすべて「わからない」として扱い、自動ではやり直さないことになります。

### 同じ名前で、違うメール

同じ `notificationId` なのに宛先や題名が違う依頼は、再試行ではなく、呼ぶ側のバグです。記録にはメールの内容のハッシュを一緒に持たせてあり、ハッシュが違えば 409 を返します。黙って「送信済み」と答えると、送られていないメールが送られたことになってしまいます。

### 記録はいつまで持つか

先取りの記録を消さずに持ち続けると、テーブルは増える一方です。そこで、記録には期限（既定で 30 日後）を書いておき、期限を過ぎたものは DynamoDB の TTL に消させます。消えた後に同じ `notificationId` が来れば、新しい通知として送られます。つまり、同じ通知と見なす期間は 30 日です。

期限を過ぎた記録が、すぐに消えるわけではありません。公式ドキュメントによると、消えるのはたいてい数日以内で、それまでは読めます。この章の用途では、記録が長く残っても困りません。

## 壊して確かめる

<!-- section: 15.faults -->

不変条件を書いたら、それを壊そうとするテストを付けます。

```bash
vp run test:unit
```

まず、処理が止まりうる場所をすべて挙げます。宛先の確認、先取り、送信、送信後の記録の 4 か所です。それぞれに、実行される前に失敗した場合と、実行された後に応答だけが失われた場合の 2 通りがあります。

<<< @/examples/15-email/test/setup.ts{faults}

この 8 通りのそれぞれで、1 回目を失敗させてから、同じ依頼をあと 2 回出し、最後に送られたメールを数えます。

<<< @/examples/15-email/test/notify.test.ts{fault-table}

どの行も 1 以下で、2 になる行はありません。

0 の行は 2 つあります。先取りは書かれたのに応答を失った場合と、送信の呼び出しが SES に届く前に失敗した場合です。どちらも記録だけが残り、メールは出ていません。「記録を先にする代償」として 3 つ目のシーケンス図に描いたことが、ここでは数字として表れています。

比べるために、逆の順序のテストも書いてあります。

<<< @/examples/15-email/test/notify.test.ts{send-first}

送信を先にすると、応答を 1 回失っただけで 2 通になります。このテストは、その 2 を期待値にしています。

ほかに、同じ依頼を 5 つ同時に出しても送信が 1 回だけであること、断られた送信はやり直せること、断られたはずの通知に Delivery のイベントが届いた後は、やり直しても送らないことを確かめています。

ただし、これらのテストが動かしているのは、メモリの上の実装です。DynamoDB の条件付き書き込みが、同時に来た依頼を本当に 1 つだけ通すかどうかは、実物では確かめていません。確かめたのは、DynamoDB に送るリクエストに条件が正しく入っていることまでです。
