---
title: "15 Email: 費用、注意点、片付け"
---

# 15 Email: 費用、注意点、片付け

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

**権限を持った script が loop に入ったら。** この API を呼べるのは、`execute-api` の権限を持つ相手だけです。知らない人は、API Gateway が関数の手前で断ります。なので、心配するのは攻撃よりも、自分の側の暴走です。止めるものは 3 つあります。

- **stage の throttling。** 1 秒に 10 件まで。30 日で、多くて 2,592 万件
- **同じ `notificationId` は 1 通。** 同じ依頼を何回繰り返しても、送るのは 1 回です。ただし、毎回ちがう ID を付けてくる loop には効きません
- **SES の上限。** sandbox の中なら、24 時間に 200 通、1 秒に 1 通、確認済みの宛先だけ。30 日で多くて 6,000 通、USD 0.60 です

sandbox の中で、毎回ちがう ID の依頼が 1 秒に 10 件、30 日続いたとします。ほとんどは SES に断られますが、依頼のたびに API Gateway と関数は動き、table には 2 回書きます（先取りと、断られた記録）。上の表と同じ仮定（関数は 300 ミリ秒、ログは 0.5 KB）で、API Gateway が USD 33.44、Lambda が USD 31.10、DynamoDB が USD 38.91、ログが USD 9.39、SES が USD 0.60。合わせて月 USD 113 ほどです。

sandbox の外では、話が変わります。上限はアカウントの送信の上限（`SendQuota`）になり、その値はこの本ではわかりません。上限が許せば、throttling いっぱいの 2,592 万通で、SES だけで USD 2,592 です。お金より先に、送信元としての評判を失います。sandbox を出る前に、「本番にするなら」の最初の 2 つを済ませてください。

stack を消せば、この章のぶんの料金は止まります。

## ハマりどころ

| こうなったら | ここを見る |
| --- | --- |
| `dev:mail` が `Invalid environment` で止まる | `examples/15-email/.env` はありますか。`MAIL_MODE=local` になっていますか |
| `mail:send` が、この本のエラーの形（`error.code`）ではない応答で失敗する | API Gateway が、関数を呼ぶ前に拒否しています。`vp run account:whoami` で、いまの認証情報が stack と同じアカウントのものか確認。API を呼ぶには `execute-api` の権限が要ります |
| `mail:send` が 429 で失敗する | stage の throttling です。API 全体で 1 秒に 10 件を超えています。呼ぶ側が loop していませんか |
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

- **呼べる相手を絞る。** IAM の認可は、「`execute-api` の権限を持つ誰か」までしか絞りません。その権限を、通知を送る処理の role にだけ持たせます。throttling の 1 秒に 10 件も、実際に要る数まで下げます
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
- stage の throttling が実際に効くこと。確かめたのは、template に値が入っていることと、cdkd 0.296.28 のソースがそれを AWS の API に渡していることだけです。throttling が返す 429 の形と、その課金も確かめていません
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
