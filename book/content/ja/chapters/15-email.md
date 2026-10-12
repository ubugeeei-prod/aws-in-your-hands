---
title: "15 Email: SES"
revision: 1
---

# 15 Email: SES

04章で API を作りました。この章では、その隣に「ノートを共有しました」という通知メールを 1 通送る API を足します。送るのは Amazon SES です。

メールは、送って終わりにならないのがやっかいなところです。宛先が存在しなかった、迷惑メールと報告された、送れたのかどうか自分でもわからない。この章では、そこまで面倒を見ます。手元で動かすぶんには、AWS のアカウントも、本物のメールアドレスも要りません。

先に 3 つだけ。

- 前提は [04章](/ja/chapters/04-http-api.md)です。記録の置き場所に DynamoDB を使いますが、必要なことはこの章で説明します（詳しくは [05章](/ja/chapters/05-dynamodb.md)）
- アウトラインでは [08章](/ja/chapters/08-async.md)の queue の先に置く予定でした。実際には、この章だけで動くレシピにしてあります。queue とのつなぎ方は、途中で案内します
- AWS で動かすと、本物のメールが飛びます。送信元の確認、DNS の設定、送信制限の解除の申請は、人が手でやる作業です。この章は手順とコマンドを用意しますが、代わりにやってはくれません

コードは `examples/15-email/` にあります。

## 全体像

<!-- section: 15.architecture -->

```figure
caption: 送る流れは API から SES へ下り、結果は SNS を通って同じ table に戻る
node caller: Caller | 別の backend、または vp run mail:send
node api: API Gateway HTTP API | ap-northeast-1、どの route も IAM 認可
node fn: Lambda "ApiHandler"
node ses: SES | identity: 自分の address か domain
node table: DynamoDB table "Mail" | NOTIFICATION#<id>, SUPPRESSION#<address>
node sns: SNS topic "MailEvents" | Delivery / Bounce / Complaint
node recipient: 相手のメールサーバー
node events: Lambda "EventsHandler"
edge caller -> api: HTTPS、SigV4 で署名
edge api -> fn: POST, GET /share-notifications; GET /health
edge fn -> ses: 2. SendEmail（宛先 1 件、tag notification_id）
edge fn -> table: 1. claim（条件付き書き込み）、3. sent にする
edge ses -> recipient
edge ses --> sns: あとから、configuration set を通って
edge sns -> events
edge events -> table: suppress、状態を進める
mark ses
```

上半分が送る流れ、下半分が結果を受け取る流れです。

呼ぶ側は、通知に自分で名前（`notificationId`）を付けて API に依頼します。関数は、まず DynamoDB に「この通知は自分が送る」と記録し、それから SES に渡します。SES は受け取ったメールを、相手のメールサーバーへ届けにいきます。

届いたか、戻ってきたか（bounce）、迷惑メールと報告されたか（complaint）は、後から SES が教えてくれます。その知らせは SNS の topic を通って、もう 1 つの関数に届きます。この関数が、もう送らない宛先の一覧（suppression list）と、通知ごとの状態を table に書きます。

table が、この構成の状態の持ち主です。04章で見たとおり、関数のメモリには何も置けません。

### 入口を開けっぱなしにしない

04章の API は、URL を知っていれば誰でも呼べました。メールを送る API でそれをやると、知らない誰かに好きな宛先へメールを送らせる踏み台になります。

なので、この章の route にはすべて IAM の認可を付けています。呼ぶには、AWS の認証情報でリクエストに署名（SigV4）する必要があります。ブラウザから呼ぶ想定はなく、CORS も設定しません。通知を送るのは、ノートを共有した処理、つまり別のバックエンドだからです。

[06章](/ja/chapters/06-auth.md)の JWT authorizer を使う手もあります。ただ、その場合は「サインインした人なら誰でも、好きな宛先に送れる」にならないよう、宛先を決めるのはサーバー側にしてください。

### 別の形にするなら

- **API を挟まず、queue から送る。** 共有の処理が queue にメッセージを入れ、関数がそれを取り出して送る形です。呼ぶ側は SES の遅さや失敗を待たずに済みます。queue と worker の作り方は [08章](/ja/chapters/08-async.md)にあります。この章の `sendShareNotification` は、そのまま queue の先に置けるように書いてあります
- **イベントを SNS から直接 Lambda に渡さず、queue を挟む。** 処理に失敗したイベントを取っておけます。これも 08章の話です
- **SES を使わない。** 送信元の評判の管理や、送信制限の解除の申請を自分でやりたくないなら、メール送信の SaaS のほうが楽な場面はあります。SES は安くて AWS の権限と一緒に管理できるかわりに、この章の後半のような作業が付いてきます

## まずメールを組み立てる

<!-- section: 15.message -->

AWS の話に入る前に、メールそのものを作ります。依頼の形はこうです。

<<< @/examples/15-email/src/contract.ts{request}

宛先は 1 つだけ。リンク先の URL は受け取りません。受け取るのはノートの ID で、URL はサーバーが自分の設定から組み立てます。呼ぶ側が URL を渡せると、この API は「あなたのドメインから届く、好きなリンク入りのメール」を作る道具になってしまうので。

### ヘッダーに改行を入れさせない

メールは、`Subject: ...` や `To: ...` のようなヘッダーが 1 行ずつ並んだ後に本文が続く、テキストの形式です。ということは、件名に入れる文字列に改行が混ざっていると、そこから先が「次のヘッダー」として読まれるおそれがあります。

ノートの題名が `Trip plan\r\nBcc: attacker@example.com` だったら、どうなるでしょう。題名を付けるのは利用者です。これがヘッダー injection です。

<<< @/examples/15-email/src/contract.ts{header-safe}

題名と名前は、改行と制御文字を含んでいたら拒否します。黙って取り除くことはしません。そういう入力が来たこと自体、呼ぶ側に知らせたいからです。宛先は「アドレス 1 つ」として読めるものだけを通します。カンマ区切りの一覧も、`名前 <アドレス>` の形も通りません。

組み立てるのは純粋関数です。

<<< @/examples/15-email/src/message.ts{build}

入口の schema で確かめた値を、ここでもう一度確かめています。この関数を、schema を通さずに呼ぶコードが将来書かれても、改行はヘッダーまで届きません。

正直に言うと、SES がこの改行をどう扱うかは確かめていません。この章の送り方（後で出てくる `Simple` 形式）では、ヘッダーを組み立てるのは SES で、自分では 1 行も書きません。それでも、送る前に自分の側で拒否しておけば、SES の挙動に頼らずに済みます。

HTML の本文には、もう 1 つ別の穴があります。題名に `<script>` や `<a href=...>` が入っていたら、そのまま HTML として解釈されます。

<<< @/examples/15-email/src/message.ts{escape}

利用者が書いた文字列は、HTML に入れる前に必ずここを通します。テストは、改行入りの題名、宛先の一覧、`<script>` 入りの名前を、それぞれ投げ込んで確かめています。

## 送る部品は差し替えられるようにする

<!-- section: 15.adapters -->

04章でノートの保存先を interface にしたのと同じことを、メールの送信でもやります。

<<< @/examples/15-email/src/mailer.ts{mailer}

結果が 3 通りあるのが大事なところです。

- `accepted`: 送信サービスが受け取った
- `rejected`: 送信サービスが断った。何も送られていない
- 例外: どうなったか、わからない

3 つ目を、ほかの 2 つと混ぜません。この区別が、あとで効いてきます。

手元で使うのは、何も送らない実装です。

<<< @/examples/15-email/src/mailer.ts{outbox}

送ったつもりのメールが配列に溜まるだけ。開発サーバーとテストは、これを使います。

SES を呼ぶ実装はこちら。

<<< @/examples/15-email/src/ses-mailer.ts{ses}

使っているのは SES API v2 の `SendEmail` です。`Simple` 形式なので、件名と本文を渡せば、メールの形に組み立てるのは SES がやってくれます。

エラーの読み分けを見てください。SES が 4xx で答えたら、リクエストを読んだうえで断ったということなので `rejected`。それ以外（timeout、接続の切断、5xx）は、SES が受け取ったのかどうか、こちらからはわかりません。だから、そのまま例外として投げます。

どちらの実装を使うかは、環境変数で決まります。

<<< @/examples/15-email/src/compose.ts{adapters}

`maxAttempts: 1` に注目です。AWS SDK は、何も言わなければ timeout や 5xx のときに自動で再試行します（既定は合計 3 回）。ふだんは助かる機能ですが、メールの送信では困ります。1 回目が実は届いていたら、SDK の再試行が 2 通目を送ってしまう。しかも、こちらの記録には何も残りません。再試行するかどうかは、次の節の仕組みに決めさせます。

## 記録が先か、送信が先か

<!-- section: 15.order -->

ここがこの章の中心です。

SES の `SendEmail` には、「同じ依頼なら 2 回目は無視して」と伝える仕組み（idempotency token）がありません。同じ内容を 2 回送れば、2 通届きます。

そして、送信 API が成功を返すことと、メールが届くことは、別の出来事です。成功は「SES が受け取った」という意味でしかありません。逆に、応答が返ってこなかったからといって、送られていないとも限りません。SES の公式ドキュメントにも、送信のリクエストがエラーを返したのに、メールは受け付けられていた、ということがまれにあると書かれています。

応答を失った呼び出し側は、ふつう再試行します。そのとき何が起きるかは、記録と送信のどちらを先にやるかで決まります。

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
step ses --x fn: t2 応答が失われる（timeout）
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
step fn -> table: t1 share-1 を claim
note table: 書かれた
step fn -> ses: t2 SendEmail
note ses: SES が受け取る
step ses --x fn: t3 応答が失われる（timeout）
step caller -> fn: t4 share-1 を再試行
step fn -x table: t5 claim はすでにある
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
step fn -> table: t1 share-1 を claim
note table: 書かれた
note fn: t2 SendEmail の前に止まる
step caller -> fn: t3 share-1 を再試行
step fn -x table: t4 claim はすでにある
note fn: 何も送らない
note ses: 1 通も届かない
```

送信を先にすると、失敗したときに 2 通届くことがあります。記録を先にすると、失敗したときに 1 通も届かないことがあります。両方を同時に防ぐ方法はありません。記録と送信は別々のサービスへの別々の呼び出しで、その間で処理が止まることを、誰も防げないからです。

この章は、**記録を先にします**。守りたい invariant はこれです。

> 同じ `notificationId` で、メールが 2 通以上送られることはない。

共有の通知は、届かなければ共有した本人が「見てくれた？」と声をかければ済みます。同じ通知が 2 通、3 通と届くほうが、受け取る側には迷惑です。繰り返し届くメールは complaint を呼び、complaint は送信元としての評判を落とします。パスワードの再設定のように「届かないと先に進めない」メールなら、逆の選択もありえます。その場合は、重複に気づける文面にするなどの工夫が要ります。

<<< @/examples/15-email/src/notify.ts{notify}

手順 1 の `claim` が、冪等性の鍵です。「この通知は自分が送る」という記録を、送る前に取ります。取れなかったら、誰かがもう取っているので、何も送りません。

### 先取りは 1 つの操作でやる

「記録があるか読んで、無ければ書く」を 2 つの操作に分けると、同時に来た 2 つの依頼が、どちらも「無い」と読んで、どちらも書いてしまいます。

DynamoDB には、書き込みに条件を付ける機能があります。条件の確認と書き込みが 1 つの操作として行われるので、同時に来ても、通るのは 1 つだけです。

<<< @/examples/15-email/src/dynamodb-store.ts{claim}

条件は「まだ記録が無い」、または「前回は断られていて、同じメールである」。後ろの条件は、すぐ後で説明します。

### 通知の状態

記録は、状態を 1 つ持ちます。

```figure
caption: 通知の状態は claim で始まり、SES の答えと、あとから届く event で進む
node none: (none)
node claimed: claimed | 応答なし: claimed のまま（自動の再試行はない）
node sent: sent
node rejected: rejected
node delivered: delivered
node complained: complained
edge none -> claimed: claim
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

`mailer` の 3 通りの結果が、ここで分かれます。

受け取られた（`accepted`）とき。`sent` にして、SES が返した message ID を書きます。この書き込みに失敗しても、呼び出し側には成功を返します。メールはもう出ているので、ここで失敗を返すと、呼び出し側は「送れなかった」と受け取ってしまいます。

断られた（`rejected`）とき。`rejected` にします。何も送られていないので、同じ依頼をもう一度出せば、先取りし直して送れます。送信の流量制限に当たったときが、これです。

わからない（例外）とき。何もしません。記録は `claimed` のまま残り、それが再送を止めます。関数が途中で落ちたときや、Lambda の timeout で打ち切られたときも、同じ形になります。

最後のが、記録を先にした代償です。`claimed` のまま動かない記録は、「送れたかもしれないし、送れていないかもしれない」通知です。この章のコードは、それを自動では再送しません。あとで delivery のイベントが届けば `delivered` に進むので、送れていたことはわかります。届かなければ、人が見て判断します。

`rejected` にも、小さな穴が残っています。さっきの「エラーを返したのに受け付けていた」が起きると、やり直しで 2 通目が出ます。delivery のイベントが先に届けば、記録は `delivered` に進んで、やり直しは止まります。届く前のやり直しは止められません。ここまで塞ぐには、エラーをすべて「わからない」として扱い、自動ではやり直さない、という選択になります。

### 同じ名前で、違うメール

同じ `notificationId` なのに、宛先や題名が違う依頼が来たら、それは再試行ではなくバグです。記録にはメールの内容の hash を一緒に持たせていて、違っていたら 409 を返します。黙って「送信済み」と答えると、送られていないメールが送られたことになってしまいます。

### 記録はいつまで持つか

先取りの記録を永遠に持つと、table は増え続けます。記録には期限（既定で 30 日後）を書いてあって、過ぎたものは DynamoDB の TTL という機能が消します。消えた後に同じ `notificationId` が来れば、新しい通知として送られます。「同じ通知」と見なす期間は 30 日、ということです。

期限を過ぎた記録がすぐ消えるわけではありません。公式ドキュメントによると、消えるのはたいてい数日以内で、それまでは読めます。この章の用途では、長く残るぶんには困りません。

## 壊して確かめる

<!-- section: 15.faults -->

invariant を書いたら、壊しにいきます。

```bash
vp run test:unit
```

処理が止まりうる場所を、全部並べます。宛先の確認、先取り、送信、送信後の記録。それぞれについて、「実行される前に失敗した」と「実行された後、応答だけが失われた」の 2 通りがあります。

<<< @/examples/15-email/test/setup.ts{faults}

この 8 通りのそれぞれで、1 回目を失敗させて、同じ依頼をあと 2 回出します。最後に、送られたメールを数えます。

<<< @/examples/15-email/test/notify.test.ts{fault-table}

どの行も 1 以下です。2 になる行はありません。

0 の行が 2 つあります。先取りは書かれたのに応答を失った場合と、送信の呼び出しが SES に届く前に失敗した場合。どちらも記録だけが残って、メールは出ていません。さっきの図の「代償」が、数字になって見えています。

比べるために、逆の順序も書いてあります。

<<< @/examples/15-email/test/notify.test.ts{send-first}

送信を先にすると、応答を 1 回失っただけで 2 通になります。このテストは、その 2 を期待値にしています。

ほかに、同じ依頼を 5 つ同時に出して送信が 1 回だけであること、断られた送信はやり直せること、断られたはずの通知に delivery のイベントが届いたら、やり直しても送らないことを確かめています。

ただ、これらのテストが動かしているのはメモリの上の実装です。DynamoDB の条件付き書き込みが、同時に来た依頼を本当に 1 つだけ通すかどうかは、実物では確かめていません。確かめたのは、DynamoDB に送っているリクエストに条件が正しく入っていること、までです。
