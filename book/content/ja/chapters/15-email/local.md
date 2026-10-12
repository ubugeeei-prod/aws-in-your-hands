---
title: "15 Email: 手元で動かす"
---

# 15 Email: 手元で動かす

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
