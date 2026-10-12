---
title: "15 Email: 手元で動かす"
---

# 15 Email: 手元で動かす

## 手元で動かす

<!-- section: 15.local -->

[前のページ](/ja/chapters/15-email.md)で、メールの組み立てと、記録を先に取る送信を作りました。このページでは、その API を手元で動かし、送った後に SES から届く知らせの扱いを足します。AWS にはまだ何も作りません。

`examples/15-email/.env.example` を、同じ場所に `.env` という名前でコピーします。

<<< @/examples/15-email/.env.example

```bash
vp run dev:mail
```

開発サーバーが <http://localhost:8787> で立ち上がります。別のターミナルから、通知を 1 件依頼します。

```bash
curl -s -X POST http://localhost:8787/share-notifications -H 'content-type: application/json' \
  -d '{"notificationId":"share-1","to":"you@example.com","sharedBy":"Aiko","noteId":"note-1","noteTitle":"Trip plan"}'
```

`"status":"accepted"` とメッセージ ID が返ります。ステータスコードを 202 にしているのは、この応答が「受け付けた」という意味で、「届いた」という意味ではないからです。

同じコマンドをもう一度実行すると、今度は `"status":"duplicate"` が返ります。送られたメールは、次のコマンドで見られます。

```bash
curl -s http://localhost:8787/dev/outbox
```

入っているのは 1 通だけです。改行入りの題名も試せます。

```bash
curl -s -X POST http://localhost:8787/share-notifications -H 'content-type: application/json' \
  -d '{"notificationId":"share-2","to":"you@example.com","sharedBy":"Aiko","noteId":"note-1","noteTitle":"Trip plan\r\nBcc: attacker@example.com"}'
```

`issues` に `noteTitle` が入った 400 が返ります。

開発サーバーのコードは次のとおりです。

<<< @/examples/15-email/src/dev.ts{dev}

`/dev/` で始まる 2 つのルートは、開発サーバーにしかありません。AWS にしか無いもの、つまり受信箱と、SES からの知らせの代わりを務めます。Lambda にのせるアプリには含まれません。

開発サーバーは、`MAIL_MODE=aws` では起動しないようにしてあります。起動できてしまうと、手元の開発サーバーが、あなた自身の認証情報で本物のメールを送ることになるからです。

手元で再現しないものは、04章と同じもの（API Gateway、Lambda の制限、IAM）に加えて、次の 4 つです。

- SES: 送信元の確認、サンドボックスの制限、スロットリング、実際の配達
- 署名の確認: 手元の API は、誰が呼んでも通します
- DynamoDB: 手元の記録はメモリの `Map` で、サーバーを止めれば消えます
- SNS: イベントの重複や遅れは起きません。次の節で、手で起こします

## 届かなかったメールの後始末

<!-- section: 15.events -->

SES は、送った後に起きたことをイベントとして知らせます。この章で受け取るのは、次の 3 種類です。

- `Delivery`: 相手のメールサーバーが受け取った。受信箱に入ったかどうか、読まれたかどうかまではわかりません
- `Bounce`: 届かずに戻ってきた。宛先が存在しないなどの恒久的なもの（`Permanent`）と、受信箱がいっぱいなどの一時的なもの（`Transient`）があります
- `Complaint`: 受信者が迷惑メールとして報告した

存在しない宛先や、受け取りたくない人に送り続けると、送信元としての評判が落ち、正しい宛先にも届きにくくなります。[デプロイのページ](/ja/chapters/15-email/deploy.md)で扱う production access の申請でも、bounce と complaint を処理する仕組みがあることを確認されます。

### イベントは外から来るデータ

イベントは JSON で届きます。形を決めるのは SES で、こちらの型とは関係がないので、入口で検証します。

<<< @/examples/15-email/src/events.ts{schema}

スキーマに書いたのは、このコードが実際に使う項目だけです。SES が送ってくる項目はもっと多く、今後も増えるかもしれないので、知らない項目は無視し、使う項目が欠けていたら拒否します。

イベントを受けて何をするかは、純粋関数で決めます。

<<< @/examples/15-email/src/events.ts{plan}

今後の送信を止めるのは、恒久的な bounce と complaint だけです。一時的な bounce では止めません。受信箱がいっぱいでも、明日には空いているかもしれないからです。

どの通知のイベントかは、送るときに付けたタグ（`notification_id`）でたどります。SES のメッセージ ID を使わないのは、応答を失ったとき、こちらはメッセージ ID を知らないからです。SES のドキュメントも、イベントと自分の処理を結びつけるにはタグを使うよう勧めています。

テーブルに書き込むのは、次の関数です。

<<< @/examples/15-email/src/events.ts{handle}

失敗は、2 通りに分けて扱います。読めないイベントは、何度やり直しても読めないので、エラーをログに書いて捨てます。テーブルへの書き込みに失敗したときは、例外を投げます。SNS は関数を非同期で呼び出しているので、関数がエラーを返すと、Lambda が同じイベントでもう一度実行します（既定では、あと 2 回まで）。

読めないイベントを捨てる以上、SES がイベントの形を変えたときには bounce を取りこぼします。このエラーログは見張っておく必要があります（アラームの組み立て方は [19章](/ja/chapters/19-observability.md)）。

### 2 回届く、順番が入れ替わる

Lambda の非同期の呼び出しは「少なくとも 1 回」で、関数がエラーを返していなくても、同じイベントが 2 回届くことがあります。届く順番も、起きた順番どおりとは限りません。

そのため、書き込みは何度実行しても同じ結果になるようにしてあります。送信停止の記録は同じキーへの上書きなので、2 回書いても 1 件です。状態については、進めてよい向きを決めています。

<<< @/examples/15-email/src/store.ts{transitions}

右側の配列が、その状態へ進めてよい元の状態です。たとえば `sent` に進めるのは、`claimed` からだけです。

この規則が働くのは、たとえば次の場合です。送信の関数が SES にメールを渡し、`sent` と書こうとしています。その書き込みより先に、もう 1 つの関数に Delivery のイベントが届いて `delivered` と書きます。遅れて来た `sent` の書き込みは条件に合わないので、何も変えません。`delivered` が `sent` に巻き戻ることはありません。

<<< @/examples/15-email/src/dynamodb-store.ts{advance}

イベントの扱いは、手元でも試せます。開発サーバーを動かしたまま、前の節で送った `share-1` に Delivery のイベントを流します。

```bash
curl -s -X POST http://localhost:8787/dev/ses-events --data-binary @examples/15-email/test/fixtures/delivery.json
curl -s http://localhost:8787/share-notifications/share-1
```

状態が `delivered` になります。続けて bounce のイベントを流します。このフィクスチャの宛先は `recipient@example.com` です。

```bash
curl -s -X POST http://localhost:8787/dev/ses-events --data-binary @examples/15-email/test/fixtures/bounce.json
curl -s -X POST http://localhost:8787/share-notifications -H 'content-type: application/json' \
  -d '{"notificationId":"share-3","to":"recipient@example.com","sharedBy":"Aiko","noteId":"note-1","noteTitle":"Trip plan"}'
```

2 つ目の応答は `"status":"suppressed"` で、この宛先にはもう送りません。

フィクスチャは、SES のドキュメントにある例をもとに作ったもので、実際のアカウントで受け取ったイベントではありません。

### SES も一覧を持っている

SES 自身も、送信停止の一覧を持っています。account-level suppression list と呼ばれるもので、恒久的な bounce や complaint を出した宛先を、SES が自分で入れます。2019 年 11 月 25 日より後に SES を使い始めたアカウントでは、既定で有効です。この章のスタックは、configuration set の側でも明示的に有効にしています。

それでも自分のテーブルに一覧を持つ理由は、3 つあります。

- 一覧にある宛先に送ると、SES はメールを受け取ったうえで、送りません。送信 API は成功を返すので、呼び出し側には `accepted` に見え、後から bounce のイベント（`OnAccountSuppressionList`）が来ます。自分の一覧を先に見れば、その場で「送りません」と答えられます
- サンドボックスの間は、SES の一覧を API で操作できません。宛先を足すことも、まとめて入れることもできません
- 止めた理由と時刻を、自分のデータとして持てます。利用者に「このアドレスには届きませんでした」と見せるなら、このデータが要ります

2 つの一覧は連動しません。SES の一覧はアカウントとリージョンごとのもので、自分のテーブルはこのスタックのものです。間違って止めた宛先を戻すときは、両方から消します。

```bash
aws sesv2 delete-suppressed-destination --email-address recipient@example.com --region ap-northeast-1
aws dynamodb delete-item --table-name <TableName> --region ap-northeast-1 \
  --key '{"pk":{"S":"SUPPRESSION#recipient@example.com"}}'
```

Gmail は、complaint の情報を SES に渡しません。Gmail の利用者が「迷惑メール」を押しても、イベントは届かず、宛先はどちらの一覧にも入りません。complaint が 0 件でも、受け取った人が迷惑に思っていないとは言えません。
