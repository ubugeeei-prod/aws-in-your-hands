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

## 手元で動かす

<!-- section: 15.local -->

`examples/15-email/.env.example` を、同じ場所に `.env` という名前でコピーします。

<<< @/examples/15-email/.env.example

```bash
vp run dev:mail
```

<http://localhost:8787> で立ち上がります。別のターミナルから、通知を 1 件依頼してみましょう。

```bash
curl -s -X POST http://localhost:8787/share-notifications -H 'content-type: application/json' \
  -d '{"notificationId":"share-1","to":"you@example.com","sharedBy":"Aiko","noteId":"note-1","noteTitle":"Trip plan"}'
```

`"status":"accepted"` と message ID が返ります。状態コードは 202 です。「受け付けた」であって「届いた」ではない、という意味を込めています。

同じコマンドを、もう一度実行してください。今度は `"status":"duplicate"` です。送られたメールを見てみます。

```bash
curl -s http://localhost:8787/dev/outbox
```

1 通だけ入っています。改行入りの題名も試せます。

```bash
curl -s -X POST http://localhost:8787/share-notifications -H 'content-type: application/json' \
  -d '{"notificationId":"share-2","to":"you@example.com","sharedBy":"Aiko","noteId":"note-1","noteTitle":"Trip plan\r\nBcc: attacker@example.com"}'
```

`issues` に `noteTitle` が入った 400 が返ります。

開発サーバーの中身はこうです。

<<< @/examples/15-email/src/dev.ts{dev}

`/dev/` で始まる 2 つの route は、開発サーバーにしかありません。AWS にしか無いもの、つまり受信箱と、SES からの知らせの代役です。Lambda にのせるアプリには含まれません。

`MAIL_MODE=aws` では起動しないようにしてあります。起動できてしまうと、手元の開発サーバーが、あなた自身の認証情報で本物のメールを送ります。

再現しないものは、04章と同じ（API Gateway、Lambda の制限、IAM）に加えて、こうです。

- SES: 送信元の確認、sandbox の制限、流量制限、実際の配達
- 署名の確認: 手元の API は、誰が呼んでも通します
- DynamoDB: 手元の記録はメモリの `Map` で、止めれば消えます
- SNS: イベントの重複や遅れは起きません。次の節で、手で起こします

## 届かなかったメールの後始末

<!-- section: 15.events -->

SES は、送った後に起きたことをイベントとして知らせてくれます。この章で受け取るのは 3 種類です。

- `Delivery`: 相手のメールサーバーが受け取った。受信箱に入ったかどうか、読まれたかどうかまではわかりません
- `Bounce`: 届かずに戻ってきた。宛先が存在しないなどの恒久的なもの（`Permanent`）と、受信箱がいっぱいなどの一時的なもの（`Transient`）があります
- `Complaint`: 受信者が迷惑メールと報告した

存在しない宛先や、嫌がっている人に送り続けると、送信元としての評判が落ちて、ちゃんとした宛先にも届きにくくなります。production access の申請（後で出てきます）でも、bounce と complaint を処理する仕組みがあることを確認されます。

### イベントは外から来るデータ

イベントは JSON で届きます。形は SES が決めるもので、こちらの型とは関係ありません。なので、入口で検証します。

<<< @/examples/15-email/src/events.ts{schema}

schema に書いたのは、このコードが実際に使う項目だけです。SES が送ってくる項目はもっと多く、これからも増えるかもしれません。知らない項目は無視して、使う項目が欠けていたら拒否します。

イベントから「何をするか」を決めるところは、純粋関数です。

<<< @/examples/15-email/src/events.ts{plan}

送信を止めるのは、恒久的な bounce と、complaint だけ。一時的な bounce では止めません。明日には受信箱が空いているかもしれないので。

どの通知のイベントかは、送るときに付けたタグ（`notification_id`）でたどります。SES の message ID は使いません。応答を失ったとき、こちらは message ID を知らないからです。SES のドキュメントも、イベントと自分の処理を結びつけるにはタグを使うよう勧めています。

実際に書き込むのは、こちらです。

<<< @/examples/15-email/src/events.ts{handle}

失敗の扱いを 2 つに分けています。読めないイベントは、エラーをログに書いて捨てます。何度やり直しても読めないものは読めないので。table への書き込みに失敗したときは、例外を投げます。SNS は関数を非同期で呼び出していて、関数がエラーを返すと、Lambda が同じイベントでもう一度実行してくれます（既定では、あと 2 回まで）。

読めないイベントを捨てるということは、形が変わったら bounce を取りこぼす、ということでもあります。このエラーログは見張るべきものです（アラームの組み立て方は [19章](/ja/chapters/19-observability.md)）。

### 2 回届く、順番が入れ替わる

Lambda の非同期の呼び出しは「少なくとも 1 回」です。関数がエラーを返していなくても、同じイベントが 2 回届くことがあります。届く順番も、起きた順番とは限りません。

だから、書き込みは何度やっても同じ結果になるようにしてあります。送信停止の記録は同じ key への上書きなので、2 回書いても 1 件です。状態のほうは、進める向きを決めています。

<<< @/examples/15-email/src/store.ts{transitions}

右側が「どの状態からなら進めてよいか」。たとえば `sent` に進めるのは `claimed` からだけです。

これが効くのは、こんなときです。送信の関数が SES にメールを渡して、`sent` と書こうとする。その一瞬の間に、もう 1 つの関数に delivery のイベントが届いて、先に `delivered` と書く。遅れて来た `sent` の書き込みは、条件に合わないので何もしません。`delivered` が `sent` に巻き戻ることはありません。

<<< @/examples/15-email/src/dynamodb-store.ts{advance}

手元でも試せます。開発サーバーを動かしたまま、さっきの `share-1` に delivery のイベントを流してみましょう。

```bash
curl -s -X POST http://localhost:8787/dev/ses-events --data-binary @examples/15-email/test/fixtures/delivery.json
curl -s http://localhost:8787/share-notifications/share-1
```

状態が `delivered` になります。続けて bounce を流します。この fixture の宛先は `recipient@example.com` です。

```bash
curl -s -X POST http://localhost:8787/dev/ses-events --data-binary @examples/15-email/test/fixtures/bounce.json
curl -s -X POST http://localhost:8787/share-notifications -H 'content-type: application/json' \
  -d '{"notificationId":"share-3","to":"recipient@example.com","sharedBy":"Aiko","noteId":"note-1","noteTitle":"Trip plan"}'
```

2 つ目の応答は `"status":"suppressed"` です。もうこの宛先には送りません。

fixture は、SES のドキュメントにある例をもとに作ったものです。実際のアカウントで受け取ったイベントではありません。

### SES も一覧を持っている

実は、SES 自身も送信停止の一覧を持っています。account-level suppression list です。恒久的な bounce や complaint を出した宛先を、SES が自分で入れてくれます。2019 年 11 月 25 日より後に SES を使い始めたアカウントでは、既定で有効です。この章の stack は、configuration set の側でも明示的に有効にしています。

では、なぜ自分の table にも持つのか。理由は 3 つあります。

- 一覧にある宛先に送ると、SES は受け取ったうえで、送りません。送信 API は成功を返します。呼び出し側には `accepted` に見えて、後から bounce のイベント（`OnAccountSuppressionList`）が来ます。自分の一覧を先に見れば、その場で「送りません」と答えられます
- sandbox の間は、SES の一覧を API で操作できません。宛先を足すことも、まとめて入れることもできません
- 止めた理由と時刻を、自分のデータとして持てます。利用者に「このアドレスには届きませんでした」と見せるなら、これが要ります

2 つの一覧は、連動しません。SES の一覧は、アカウントとリージョンごと。自分の table は、この stack のものです。間違って止めた宛先を戻すときは、両方から消します。

```bash
aws sesv2 delete-suppressed-destination --email-address recipient@example.com --region ap-northeast-1
aws dynamodb delete-item --table-name <TableName> --region ap-northeast-1 \
  --key '{"pk":{"S":"SUPPRESSION#recipient@example.com"}}'
```

もう 1 つ知っておいてください。Gmail は、complaint の情報を SES に渡しません。Gmail の利用者が「迷惑メール」を押しても、イベントは届かず、どちらの一覧にも入りません。complaint が 0 件だからといって、嫌がられていないとは言えないんです。

## AWS にのせる準備

<!-- section: 15.infra -->

CDK の stack を、部品ごとに見ていきます。

### 記録の置き場所

<<< @/examples/15-email/infra/lib/email-stack.ts{table}

table は 1 つで、通知の記録と送信停止の一覧の両方を入れます。key の先頭（`NOTIFICATION#`、`SUPPRESSION#`）で区別します。どちらも key を指定して 1 件読むだけなので、これで足ります。

### configuration set とイベントの届け先

<<< @/examples/15-email/infra/lib/email-stack.ts{configuration-set}

configuration set は、送信時に名前で指定する設定のまとまりです。イベントの届け先は、ここにぶら下がります。送るときに configuration set を指定し忘れると、イベントは 1 件も届きません。

`addEventDestination` は、topic の側に「SES が、この configuration set のイベントに限って publish してよい」という policy も足してくれます。テストは、topic に publish できるのが SES だけであることを見ています。

### 送信元

<<< @/examples/15-email/infra/lib/email-stack.ts{identity}

identity は、SES に「これは自分のものだ」と確認してもらった送信元です。メールアドレス 1 つか、ドメインまるごと。

ここは誤解しやすいので、はっきり書いておきます。**stack がやるのは、確認の開始までです。** アドレスなら、そのアドレスに確認のメールが届くので、中のリンクを踏みます。ドメインなら、DNS にレコードを置きます。どちらも人の手でやる作業で、デプロイが成功しても、確認が済むまでメールは送れません。

### 送る関数の権限

<<< @/examples/15-email/infra/lib/email-stack.ts{send-role}

`ses:SendEmail` を許すだけだと、アカウント内のどの identity からでも送れてしまいます。ここでは 3 つ絞っています。使える identity はこの 1 つ。通す configuration set もこの 1 つ。そして、送信元として名乗れるアドレスは `fromAddress` だけ。ドメインを確認すると、そのドメインのどのアドレスでも名乗れるようになるので、最後の条件が効いてきます。

正直に言うと、この policy で `SendEmail` が実際に通ることは、まだ確かめていません。許可が足りなければ、最初の送信が `AccessDenied` で失敗します。そのときはエラーに出る resource の ARN を見てください。

### イベントを記録する関数の権限

<<< @/examples/15-email/infra/lib/email-stack.ts{events-role}

こちらの関数は、メールを送れません。table を読むこともできません。できるのは書くことだけです。外から届いたデータを処理する関数なので、持たせる権限は少ないほうが安心です。

### 入口

<<< @/examples/15-email/infra/lib/email-stack.ts{api}

`HttpIamAuthorizer` を付けた route は、署名の無いリクエストを API Gateway が拒否します。関数は起動しません。テストは、3 つの route すべてが `AWS_IAM` であることを見ています。

### cdkd とこの stack

この stack は、SES のリソースを 3 種類使います（`AWS::SES::EmailIdentity`、`AWS::SES::ConfigurationSet`、`AWS::SES::ConfigurationSetEventDestination`）。固定している版の cdkd（0.296.28）のソースを読むと、この 3 つには専用の実装がありません。専用の実装が無い種類は、Cloud Control API という AWS の汎用の API を通して作られます。SNS、DynamoDB、Lambda、IAM、API Gateway、ログのほうは、専用の実装があります。

Cloud Control API を通す経路は、この本ではまだ一度も動かせていません。

```bash
vp run mail:infra:synth
```

synth は手元だけで動きます。AWS には問い合わせません。

## sandbox と identity

<!-- section: 15.identity -->

デプロイの前に、SES の最初の関門を知っておきましょう。

新しいアカウントの SES は、sandbox という状態から始まります。リージョンごとの状態で、東京で出ても、別のリージョンでは sandbox のままです。sandbox の間は、こう制限されます。

- 送れる宛先は、確認済みのアドレスとドメイン、それに SES の mailbox simulator だけ
- 24 時間に 200 通まで
- 1 秒に 1 通まで

「確認済みの宛先にしか送れない」のが、いちばん大きな制限です。知らない人には送れません。裏を返すと、独自ドメインが無くても、自分のアドレスを確認すれば、自分宛てには送れます。この章を試すだけなら、それで足ります。

送信元をどう確認するかは、2 通りあります。

| | メールアドレスを確認する | ドメインを確認する |
| --- | --- | --- |
| 必要なもの | 受信できるアドレス | DNS を編集できるドメイン |
| 確認の方法 | 届いたメールのリンクを踏む（リンクは 24 時間有効） | DKIM の CNAME レコードを 3 つ置く（検出まで最大 72 時間） |
| 送信元にできるもの | そのアドレスだけ | そのドメインのすべてのアドレス |
| 向いている場面 | この章を試す | 本番 |

フリーメールのアドレスを送信元にして、sandbox の外で使うのはやめておきましょう。そのドメインの DNS はあなたのものではないので、次の節の SPF、DKIM、DMARC を設定できません。

### デプロイして、確認する

自分のアドレスで試すなら、こうです。

```bash
vp run mail:infra:diff -c fromAddress=you@your-domain.example
vp run mail:infra:deploy -c fromAddress=you@your-domain.example
```

`fromAddress` を渡さないと、`notes@example.com` という、誰のものでもないアドレスで stack が作られます。synth を通すための既定値なので、デプロイのときは必ず渡してください。

デプロイが終わると、`no-reply-aws@amazon.com` から確認のメールが届きます。リンクを踏んでください。済んだかどうかは、こう確かめます。

```bash
aws sesv2 get-email-identity --email-identity you@your-domain.example --region ap-northeast-1
aws sesv2 get-account --region ap-northeast-1
```

1 つ目の `VerifiedForSendingStatus` が `true` なら、確認済みです。アドレスは大文字と小文字を区別するので、確認したとおりの綴りで使います。

2 つ目の `ProductionAccessEnabled` が `false` なら、sandbox の中です。`SendQuota` に、24 時間の上限と、直近 24 時間に送った数が出ます。

## デプロイした API で送る

<!-- section: 15.deploy -->

確認が済んだら、送ってみましょう。このタスクは本物のメールを送ります。料金もかかります（1 通 USD 0.0001）。

```bash
vp run mail:send --to you@your-domain.example
```

同じ `notificationId` で 2 回依頼して、2 回目が `duplicate` になることを確かめるタスクです。受信箱に届くのは 1 通のはずです。

IAM の認可が付いた API なので、ふつうの `fetch` では呼べません。タスクは、あなたの認証情報でリクエストに署名しています。

<<< @/examples/15-email/scripts/signed-fetch.ts{signed-fetch}

送った通知がどうなったかは、こう見ます。

```bash
vp run mail:status --id <notificationId>
vp run mail:logs --events --follow
```

しばらくすると、`sent` が `delivered` に変わるはずです。

### bounce と complaint を起こしてみる

自分のアドレスでは、bounce も complaint も起こせません。そのために、SES は mailbox simulator という宛先を用意しています。sandbox の中でも使えます。

```bash
vp run mail:send --to success@simulator.amazonses.com
vp run mail:send --to bounce@simulator.amazonses.com
vp run mail:send --to complaint@simulator.amazonses.com
```

`bounce@` は恒久的な bounce を、`complaint@` は complaint を返します。イベントが届くと、この章の関数がその宛先を table に入れるので、同じ宛先への 2 回目の `mail:send` は `suppressed` になります。もう一度試すときは、`bounce+1@simulator.amazonses.com` のように、`+` の後ろにラベルを付けた宛先を使います。

simulator 宛てのメールは、1 日の送信数の上限にも、bounce や complaint の割合にも数えられません。料金は、ふつうのメールと同じだけかかります。

drift の検査は、ほかの章と同じです。

```bash
vp run mail:infra:drift
```

正直に言うと、この節と前の節のコマンドは、まだ一度も実際の AWS で通せていません。イベントが fixture と同じ形で届くか、`sent` から `delivered` へ進むまでどのくらいかかるか、わかったら追記します。

## 独自ドメインで送る: SPF、DKIM、DMARC

<!-- section: 15.dns -->

知らない人に送るなら、ドメインが要ります。受け取る側のメールサーバーは、「このメールは、本当にこのドメインの持ち主が送ったのか」を確かめようとします。確かめられないメールは、迷惑メールに振り分けられるか、受け取りを拒否されます。

確かめる仕組みは 3 つあって、どれも DNS にレコードを置くことで働きます。

**SPF** は、「このドメインの名前で送ってよいサーバー」の一覧です。ただし、見るのは受信者に見える From ではなく、封筒の差出人（MAIL FROM）のドメインです。SES は何も設定しなければ、MAIL FROM に `amazonses.com` のサブドメインを使います。SPF は通りますが、それは `amazonses.com` についての話で、あなたのドメインとは結びつきません。

**DKIM** は、メールに電子署名を付ける仕組みです。検証用の公開鍵を DNS に置きます。SES の Easy DKIM を使うと、鍵は SES が作って、署名も SES が付けます。あなたが置くのは、鍵の場所を指す CNAME レコード 3 つです。SES は、この 3 つが見つかったことを、ドメインの確認としても使います。

**DMARC** は、上の 2 つを From のドメインに結びつけます。「From のドメインが、SPF か DKIM のどちらかで確かめられること」を求めて、どちらも失敗したメールをどう扱ってほしいかを、ドメインの持ち主が宣言します。

SES で送る場合、いちばん手数が少ないのは DKIM です。From のドメインに Easy DKIM を設定すれば、DMARC は DKIM の側で通ります。SPF の側でも通したいなら、MAIL FROM を自分のドメインのサブドメイン（たとえば `bounce.your-domain.example`）にします。

ドメインで stack を作るには、こうします。

```bash
vp run mail:infra:deploy -c fromAddress=notes@your-domain.example -c senderIdentity=your-domain.example
```

MAIL FROM も自分のドメインにするなら、`-c mailFromDomain=bounce.your-domain.example` を足します。

置くべきレコードは、このタスクが表示します。

```bash
vp run mail:dns --report dmarc@your-domain.example
```

レコードを組み立てているのは、この関数です。

<<< @/examples/15-email/src/dns.ts{dns}

タスクがやるのは、表示までです。DNS にレコードを作る作業は、自動化していません。Route 53 でも、ほかの DNS サービスでも、管理画面や CLI で、表示されたとおりの名前と値を入れてください。置くものをまとめると、こうなります。

| 何のため | 種類 | 名前 | 値 |
| --- | --- | --- | --- |
| DKIM（ドメインの確認も兼ねる） | CNAME × 3 | SES が発行した `<token>._domainkey.<ドメイン>` | SES が発行した値 |
| MAIL FROM（任意） | MX × 1 | `bounce.<ドメイン>` | `10 feedback-smtp.ap-northeast-1.amazonses.com` |
| SPF（MAIL FROM を設定した場合） | TXT | `bounce.<ドメイン>` | `"v=spf1 include:amazonses.com ~all"` |
| DMARC | TXT | `_dmarc.<ドメイン>` | `"v=DMARC1; p=none; rua=mailto:<報告の宛先>"` |

注意が 3 つあります。

- DKIM のレコードの名前には `_domainkey` という、アンダースコアで始まる部分があります。DNS サービスによっては、ドメイン名を自動で後ろに足します。二重にならないよう、表示された名前と見比べてください
- MAIL FROM のドメインに置く MX レコードは、ちょうど 1 つ。そのサブドメインは、メールの送信にも受信にも使っていないものにします
- DMARC は `p=none`（何もせず、報告だけ受け取る）から始めます。報告を見て、正しいメールがちゃんと通っていることを確かめてから、`quarantine`、`reject` と強めます。いきなり `reject` にすると、設定を間違えていたときに、自分のメールが全部拒否されます

もう DMARC のレコードがあるドメインなら、上書きせず、いまの方針を先に確かめてください。

```bash
dig TXT _dmarc.your-domain.example
aws sesv2 get-email-identity --email-identity your-domain.example --region ap-northeast-1
```

2 つ目の `DkimAttributes.Status` が `SUCCESS` になれば、DKIM の確認は済んでいます。DNS の変更が行き渡るまで、最大 72 時間かかることがあります。

Route 53 を使っている場合、SES のコンソールには、DKIM のレコードを自動で作る機能があります。この章の stack は、その機能を使いません。置くレコードを、自分の目で一度見ておいてほしいからです。

## sandbox を出る

<!-- section: 15.production -->

確認済みの宛先以外に送るには、production access を申請します。AWS のサポートが人の目で審査する申請で、stack では出せません。申請したからといって、必ず通るとも限りません。

コンソールでは、SES の Account dashboard から「Request production access」を選びます。入力するのは、これだけです。

- **メールの種類**: Transactional（利用者の操作をきっかけに 1 人ずつ送るもの）か Marketing（まとめて送る宣伝）。共有の通知は Transactional です
- **Web サイトの URL**: 送る内容を理解してもらうためのもの
- **追加の連絡先**: アカウントについての連絡を受け取るアドレス。4 つまで
- **連絡の言語**: English か Japanese
- **同意**: 明示的に希望した人にだけ送ること、bounce と complaint を処理する仕組みがあること

最後の項目が、この章で作ったものです。

同じ申請を、CLI からも出せます。

```bash
aws sesv2 put-account-details --region ap-northeast-1 \
  --production-access-enabled \
  --mail-type TRANSACTIONAL \
  --website-url https://your-domain.example \
  --additional-contact-email-addresses you@your-domain.example \
  --contact-language JA
```

公式ドキュメントによると、最初の返信は 24 時間以内に来ます。追加の情報を求められたら、もっとかかります。審査中は、申請の内容を直せません。

ドキュメントは、申請の前にドメインを確認しておくことを勧めています。結果は、さっきのコマンドで見ます。

```bash
aws sesv2 get-account --region ap-northeast-1
```

`ProductionAccessEnabled` が `true` になれば、sandbox の外です。外に出ても、送信元の identity の確認は要ります。1 日の上限と 1 秒あたりの上限は、`SendQuota` に出ます。

### Cognito のメールも、ここにつながる

06章で、Cognito の既定のメール送信は少量向けだ、と書きました。公式ドキュメントも、既定の設定の 1 日の上限は、ふつうの本番の量に足りないとしています。利用者が増えたら、user pool の設定で、あなたのアカウントの SES の identity から送るように切り替えます。

そのために要るのが、この章の 2 つです。確認済みの identity と、sandbox の外に出ていること。sandbox の中のままだと、Cognito は利用者にメールを送れません。

## Workers から来た人へ

<!-- section: 15.cloudflare -->

Cloudflare には Email Service があって、Worker から binding でメールを送れます。設定に `send_email` を書いて、`env.EMAIL.send(...)` を呼ぶ形です。公式ドキュメントによると、送信の機能は beta で、Workers Paid プランが要ります。

AWS の側は、この章で見たとおり部品が多めです。identity、configuration set、topic、関数、role、table。binding は無く、SDK で呼んで、権限は IAM で絞ります。

正直に言うと、比べられるのはここまでです。Cloudflare 側は概要のページを読んだだけで、ドメインの登録や DNS の設定、bounce の受け取り方、上限、料金は確かめていません。

1 つだけ、どちらを使っても変わらないことがあります。この章の中心だった「記録が先か、送信が先か」です。送信の API が同じ依頼を見分けてくれないかぎり、重複を防ぐ記録は自分で持つことになります。

## お金の話

金額は USD、東京リージョン、従量課金、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

**1 通も送らない月は 0 です。** SES の identity と configuration set、SNS の topic、関数、API は、置いてあるだけでは料金がかかりません。table に残る記録の保存料は、10 MB なら 0 です（DynamoDB の保存は、最初の 25 GB が USD 0 の段階です）。

送ると、こうなります。月 1 万通、宛先は 1 通につき 1 つ、添付なし。重複の依頼が 1,000 件あって、1 通につきイベントが 1 件届く、という仮定です。

| 対象 | 数量 | 定価 | 毎月の無料枠の適用後 |
| --- | --- | --- | --- |
| SES の送信 | 10,000 通 | 1.00 | 1.00（無料枠は確認できず、引いていない） |
| API Gateway HTTP API のリクエスト | 11,000 件 | 0.01 | 0.01（同上） |
| Lambda（リクエストと実行時間） | 21,000 件、950 GB 秒 | 0.02 | 0 |
| SNS（publish と Lambda への配送） | 各 10,000 件 | 0 | 0 |
| DynamoDB（書き込み、読み取り、保存） | 31,000 WRU、6,500 RRU | 0.02 | 0.02 |
| CloudWatch Logs | 0.01 GB | 0.01 | 0 |
| 小計 | | **1.06** | **1.04** |

ほとんどが SES の送信料金です。1 通 USD 0.0001、つまり 1,000 通で USD 0.10。料金ページによると、宛先 1 つごとに数えます。添付があれば、1 GB あたり USD 0.12 が加わります。

SNS が 0 なのは、価格表で、最初の 100 万リクエストが USD 0 の段階になっていて、Lambda への配送は無料だからです。

SES の無料枠は、不明としています。料金ページにあるのは、新しく AWS を使い始めた人向けの credits の説明（最大 USD 200、アカウント作成から 12 か月以内に使う）で、「毎月何通まで無料」という記述は見つかりませんでした。あなたのアカウントに当てはまる条件は、Billing のコンソールで確かめてください。

この表に入っていないものもあります。インターネットへのデータ転送、専用 IP（1 つにつき月 USD 24.95）、Virtual Deliverability Manager。どれも、この章の構成では使っていません。関数の実行時間（送信 300 ミリ秒、イベント 50 ミリ秒）も仮定で、実測ではありません。

stack を消せば、この章のぶんの料金は止まります。

## ハマりどころ

| こうなったら | ここを見る |
| --- | --- |
| `dev:mail` が `Invalid environment` で止まる | `examples/15-email/.env` はありますか。`MAIL_MODE=local` になっていますか |
| `mail:send` が、この本のエラーの形（`error.code`）ではない応答で失敗する | API Gateway が、関数を呼ぶ前に拒否しています。`vp run account:whoami` で、いまの認証情報が stack と同じアカウントのものか確認。API を呼ぶには `execute-api` の権限が要ります |
| `send_rejected` が返る | SES が断りました。`vp run mail:logs` で `reason` を見ます。identity が未確認、sandbox で未確認の宛先に送った、流量制限、のどれかが多いはず |
| ログの `reason` が権限のエラー（`AccessDenied` など） | 送信 role の policy が足りません。エラーに出る resource の ARN と、stack の policy を見比べてください |
| `send_unknown` が返る | SES から答えが返りませんでした。同じ `notificationId` では、もう送られません。`mail:status` で状態を確かめ、`delivered` に進まなければ、新しい `notificationId` で送り直すかどうかを判断します |
| 送れているのに、状態が `sent` のまま | イベントが届いていません。`vp run mail:logs --events` を確認。送信時に configuration set を指定していますか |
| イベントの関数のログに `unreadable SES event dropped` | SES のイベントが、schema と合っていません。`problem` に出る項目を、`src/events.ts` と見比べてください |
| 確認のメールが届かない | 迷惑メールのフォルダを確認。リンクは 24 時間で切れます。切れたら、SES のコンソールから再送します |
| ドメインが 72 時間たっても確認されない | CNAME の名前に、ドメインが二重に付いていませんか。`dig CNAME <表示された名前>` で確かめます |
| simulator 宛ての 2 回目が `suppressed` になる | 1 回目の bounce で、この章の table に入りました。`+` のラベルを付けた宛先を使うか、table から消します |

`send_rejected` と `send_unknown` は、どちらも状態コードは 502 です。違いは「同じ依頼をもう一度出したら、送られるか」。`code` で見分けてください。

## 本番にするなら

- **呼べる相手を絞る。** IAM の認可は、「`execute-api` の権限を持つ誰か」までしか絞りません。その権限を、通知を送る処理の role にだけ持たせます
- **API の前に queue を置く。** 呼ぶ側を SES の遅さから切り離して、流量制限に当たったら待ってやり直せます（[08章](/ja/chapters/08-async.md)）
- **イベントの取りこぼしに備える。** 関数が 3 回とも失敗したイベントは、Lambda が捨てます。関数に dead-letter queue か、失敗時の送り先（on-failure destination）を付けて、取っておけるようにします（dead-letter queue の考え方は [08章](/ja/chapters/08-async.md)。あちらは SQS の queue に付けています）
- **bounce と complaint の数を見張る。** 送信元としての評判に問題があると、SES はアカウントを審査中にしたり（`PROBATION`）、送信を止めたり（`SHUTDOWN`）します。いまの状態は `aws sesv2 get-account` の `EnforcementStatus` に出ます。読めなかったイベントのログと一緒に、アラームにします（アラームの組み立て方は [19章](/ja/chapters/19-observability.md)）
- **`claimed` のまま動かない記録を拾う。** 一定の時間たっても進まない記録を一覧にして、送り直すかどうかを決める運用が要ります
- **table を守る。** `removalPolicy` を `RETAIN` にして、point-in-time recovery を有効にします。送信停止の一覧を失うと、bounce した宛先にまた送ることになります
- **topic を暗号化する。** イベントには宛先のメールアドレスが入っています。この章の topic は、転送中の暗号化（HTTPS）を強制しているだけです。保存時の暗号化に要る設定は、確かめていません
- **DMARC を強める。** `p=none` は出発点です
- **配信停止の手段を用意する。** 宣伝のメールを送るなら、受け取る人が自分で止められる仕組みが要ります。この章の通知は対象外ですが、同じ仕組みで別の種類のメールを送り始めるときは、先に考えてください
- **反映の経路を AWS CDK CLI と CloudFormation にする。** 02章で話したとおりです

## 片付け

<!-- section: 15.cleanup -->

```bash
vp run mail:infra:destroy
```

identity、configuration set、topic、2 つの関数と role、API、table、log group が消えます。table の中の記録と、送信停止の一覧も一緒です。

残るものが 3 つあります。

- **SES の account-level suppression list に入った宛先。** アカウントとリージョンのもので、stack とは関係なく残ります。`aws sesv2 list-suppressed-destinations --region ap-northeast-1` で見られます
- **production access と送信の上限。** アカウントの状態なので、stack を消しても変わりません
- **DNS に置いたレコード。** 自分で消します。DKIM の CNAME を残しておいても害はありませんが、もう使わない MAIL FROM の MX と SPF は消しておきましょう

cdkd の bootstrap で作った保存場所（02章）と、そこに置かれたデプロイ用のファイルも残ります。

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト（メールの組み立てとヘッダー injection の拒否、記録を先に取る送信、8 か所の障害注入、同時の依頼、SES イベントの検証と重複・順序の入れ替わり、DynamoDB と SES に送るリクエストの検査、インフラの assertion）。型検査。synth（esbuild の bundle 込み、25 リソース）。`dev:mail` を起動して、本文の `curl` を実行。署名付きのリクエストを作る部品が `Authorization` ヘッダーを付けることを、偽の認証情報と手元のサーバーで確認。

**まだ確かめていないこと。** この章は、SES を一度も呼んでいません。`mail:infra:deploy`、`mail:send`、`mail:status`、`mail:dns`、`mail:logs`、`mail:infra:drift`、`mail:infra:destroy` と、本文の `aws sesv2` のコマンドは、実際の AWS では動かしていません。とくに次の点は、実環境での確認待ちです。

- 送信 role の policy（identity と configuration set の 2 つの resource、`ses:FromAddress` の条件）で `SendEmail` が通ること。sandbox の間、宛先の identity にも権限が要るという話を見かけますが、一次情報では確認できていません
- ドメインだけを確認した状態で、そのドメインのアドレスから configuration set を指定して送れること。公式ドキュメントに、ドメインから確認を引き継いだアドレスは「configuration set と一緒に使う」ことができない、と読める記述があります。stack は、configuration set を identity の既定にもしています
- 実際のイベントが、fixture と同じ形であること。SNS から関数への配送。configuration set の suppression の動き
- DynamoDB の条件付き書き込みが、同時の依頼を 1 つだけ通すこと。確かめたのは、送っている条件式と、メモリの実装が同じ規則に従うことだけです
- cdkd が、SES の 3 種類のリソースを Cloud Control API 経由で作り、drift を検出し、消せること
- 改行を含む件名や宛先を、SES がどう扱うか
- production access の申請の画面と、審査にかかる時間。本文の項目は、公式ドキュメントの記述です

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| まずメールを組み立てる | `examples/15-email/src/contract.ts`、`src/message.ts`、`test/message.test.ts` | `test:unit` |
| 送る部品は差し替えられるようにする | `examples/15-email/src/mailer.ts`、`src/ses-mailer.ts`、`src/compose.ts`、`test/ses-mailer.test.ts` | `test:unit` |
| 記録が先か、送信が先か | `examples/15-email/src/notify.ts`、`src/store.ts`、`src/memory-store.ts`、`src/dynamodb-store.ts`、`test/dynamodb-store.test.ts` | `test:unit` |
| 壊して確かめる | `examples/15-email/test/notify.test.ts`、`test/setup.ts` | `test:unit` |
| 手元で動かす | `examples/15-email/src/dev.ts`、`src/app.ts`、`src/env.ts`、`test/app.test.ts`、`test/env.test.ts`、`.env.example` | `dev:mail`、`test:unit` |
| 届かなかったメールの後始末 | `examples/15-email/src/events.ts`、`src/events-lambda.ts`、`test/events.test.ts`、`test/fixtures/` | `test:unit`、`dev:mail` |
| AWS にのせる準備 | `examples/15-email/infra/lib/email-stack.ts`、`infra/bin/app.ts`、`infra/test/email-stack.test.ts`、`cdk.json` | `mail:infra:synth`、`test:unit` |
| sandbox と identity | `examples/15-email/infra/lib/email-stack.ts`、`infra/bin/app.ts` | `mail:infra:diff`、`mail:infra:deploy` |
| デプロイした API で送る | `examples/15-email/scripts/send.ts`、`scripts/status.ts`、`scripts/signed-fetch.ts`、`scripts/logs.ts`、`src/lambda.ts` | `mail:send`、`mail:status`、`mail:logs`、`mail:infra:drift` |
| 独自ドメインで送る | `examples/15-email/src/dns.ts`、`scripts/dns.ts`、`test/dns.test.ts` | `mail:dns`、`test:unit` |
| 片付け | `tools/src/infra/` | `mail:infra:destroy` |
| お金の話 | `data/pricing/`、`tools/src/pricing/calc.test.ts` | `test:unit` |

**一次情報**（確認日はすべて 2026-10-11）

- [Request production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html)
- [Using the Amazon SES account-level suppression list](https://docs.aws.amazon.com/ses/latest/dg/sending-email-suppression-list.html)
- [How email sending works in Amazon SES](https://docs.aws.amazon.com/ses/latest/dg/send-email-concepts-process.html)
- SES API v2: [SendEmail](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html)、[MessageTag](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_MessageTag.html)、[GetAccount](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_GetAccount.html)、[GetEmailIdentity](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_GetEmailIdentity.html)
- [Monitor email sending using Amazon SES event publishing](https://docs.aws.amazon.com/ses/latest/dg/monitor-using-event-publishing.html)、[イベントの内容](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-contents.html)、[イベントの例](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-examples.html)、[SNS の event destination](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-add-event-destination-sns.html)
- [Creating and verifying identities](https://docs.aws.amazon.com/ses/latest/dg/creating-identities.html)、[Easy DKIM](https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-dkim-easy.html)、[Using a custom MAIL FROM domain](https://docs.aws.amazon.com/ses/latest/dg/mail-from.html)、[DMARC](https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-dmarc.html)
- [Mailbox simulator](https://docs.aws.amazon.com/ses/latest/dg/send-an-email-from-console.html)
- [AWS Service Reference: SES](https://servicereference.us-east-1.amazonaws.com/v1/ses/ses.json)
- [Amazon SES pricing](https://aws.amazon.com/ses/pricing/)
- AWS Price List bulk API: [SES](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonSES/current/ap-northeast-1/index.json)、[SNS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonSNS/current/ap-northeast-1/index.json)
- [Invoking Lambda functions with Amazon SNS notifications](https://docs.aws.amazon.com/lambda/latest/dg/with-sns.html)、[How Lambda handles errors and retries with asynchronous invocation](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-error-handling.html)、[Amazon SNS message delivery retries](https://docs.aws.amazon.com/sns/latest/dg/sns-message-delivery-retries.html)
- [AWS SDKs and Tools: Retry behavior](https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html)
- [IAM authorization for HTTP APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-access-control-iam.html)
- [Using time to live (TTL) in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html)
- [Email settings for Amazon Cognito user pools](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-email.html)
- [Cloudflare Email Service](https://developers.cloudflare.com/email-service/)（概要のページのみ）
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)、[aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0)

:::
