---
title: "15 Email: デプロイ"
---

# 15 Email: デプロイ

## AWS にのせる準備

<!-- section: 15.infra -->

ここからは、[手元で動かした](/ja/chapters/15-email/local.md) API を AWS にのせます。まず CDK のスタックを部品ごとに見て、そのあと SES の送信元の確認、送信、独自ドメインの設定、本番の送信に必要な申請へ進みます。

### 記録の置き場所

<<< @/examples/15-email/infra/lib/email-stack.ts{table}

テーブルは 1 つで、通知の記録と送信停止の一覧の両方を入れ、キーの先頭（`NOTIFICATION#`、`SUPPRESSION#`）で区別します。どちらもキーを指定して 1 件ずつ読むだけなので、テーブルを分ける必要はありません。

### configuration set とイベントの届け先

<<< @/examples/15-email/infra/lib/email-stack.ts{configuration-set}

configuration set は、送信のときに名前で指定する設定のまとまりです。イベントの届け先は configuration set に付くので、送るときに指定し忘れると、イベントは 1 件も届きません。

`addEventDestination` は、SES がこの configuration set のイベントに限って publish してよい、というポリシーもトピックに足します。テストでは、トピックに publish できるのが SES だけであることを確かめています。

### 送信元

<<< @/examples/15-email/infra/lib/email-stack.ts{identity}

identity は、自分のものだと SES に確認してもらった送信元で、メールアドレス 1 つか、ドメイン全体のどちらかです。

**スタックがするのは、確認を始めるところまでです。** アドレスの場合は、そのアドレスに確認のメールが届くので、中のリンクを開きます。ドメインの場合は、DNS にレコードを置きます。どちらも人が手で進める作業で、デプロイが成功しても、確認が済むまでメールは送れません。

### 送る関数の権限

<<< @/examples/15-email/infra/lib/email-stack.ts{send-role}

`ses:SendEmail` を許すだけでは、アカウント内のどの identity からでも送れてしまうので、3 つの条件で絞っています。使える identity はこの 1 つだけで、通す configuration set もこの 1 つだけです。さらに、送信元として名乗れるアドレスを `fromAddress` だけにしています。ドメインを確認すると、そのドメインのどのアドレスでも名乗れるようになるので、この条件が必要になります。

このポリシーで `SendEmail` が実際に通ることは、まだ確かめていません。許可が足りなければ、最初の送信が `AccessDenied` で失敗します。そのときは、エラーに出るリソースの ARN を見てください。

### イベントを記録する関数の権限

<<< @/examples/15-email/infra/lib/email-stack.ts{events-role}

イベントを記録する関数は、メールを送れず、テーブルを読むこともできません。できるのは書き込みだけです。外から届いたデータを処理する関数なので、持たせる権限を少なくしています。

### 入口

<<< @/examples/15-email/infra/lib/email-stack.ts{api}

`HttpIamAuthorizer` を付けたルートでは、署名の無いリクエストを API Gateway が拒否し、関数は起動しません。テストでは、3 つのルートすべてが `AWS_IAM` であることを確かめています。

同じ場所で、ステージにスロットリングも付けています。`defaultRouteSettings` は default ステージのすべてのルートに効く設定で、値は 1 秒に 10 件、バーストは 20 件です。テストは、この値がテンプレートに入っていることも確かめています。固定している版の cdkd のソースを読むと、ステージの実装はこの設定を AWS の API にそのまま渡していました。ただし、確かめたのはソースを読んだところまでで、実際に効くかどうかは、デプロイして確かめるまでわかりません。

### cdkd とこのスタック

このスタックは、SES のリソースを 3 種類使います（`AWS::SES::EmailIdentity`、`AWS::SES::ConfigurationSet`、`AWS::SES::ConfigurationSetEventDestination`）。固定している版の cdkd（0.296.28）のソースを読むと、この 3 種類には専用の実装がありません。専用の実装が無い種類のリソースは、Cloud Control API という AWS の汎用の API を通して作られます。SNS、DynamoDB、Lambda、IAM、API Gateway、ログには、専用の実装があります。

Cloud Control API を通す経路は、この本ではまだ一度も動かせていません。

```bash
vp run mail:infra:synth
```

synth は手元だけで動き、AWS には問い合わせません。

## sandbox と identity

<!-- section: 15.identity -->

デプロイの前に、SES の sandbox を知っておく必要があります。

新しいアカウントの SES は、sandbox という状態から始まります。sandbox はリージョンごとの状態なので、東京で sandbox を出ても、別のリージョンでは sandbox のままです。sandbox の間は、次の制限がかかります。

- 送れる宛先は、確認済みのアドレスとドメイン、それに SES の mailbox simulator だけ
- 24 時間に 200 通まで
- 1 秒に 1 通まで

いちばん影響が大きいのは、確認済みの宛先にしか送れないことで、見知らぬ人には送れません。ただし、独自ドメインが無くても、自分のアドレスを確認すれば自分宛てには送れます。この章を試すだけなら、それで足ります。

送信元を確認する方法は、2 通りあります。

| | メールアドレスを確認する | ドメインを確認する |
| --- | --- | --- |
| 必要なもの | 受信できるアドレス | DNS を編集できるドメイン |
| 確認の方法 | 届いたメールのリンクを開く（リンクは 24 時間有効） | DKIM の CNAME レコードを 3 つ置く（検出まで最大 72 時間） |
| 送信元にできるもの | そのアドレスだけ | そのドメインのすべてのアドレス |
| 向いている場面 | この章を試す | 本番 |

フリーメールのアドレスを送信元にして、sandbox の外で使うのは避けてください。フリーメールのドメインの DNS はあなたのものではないので、「独自ドメインで送る」の節で扱う SPF、DKIM、DMARC を設定できません。

### デプロイして、確認する

自分のアドレスで試すなら、次のように実行します。

```bash
vp run mail:infra:diff -c fromAddress=you@your-domain.example
vp run mail:infra:deploy -c fromAddress=you@your-domain.example
```

`fromAddress` を渡さないと、スタックは `notes@example.com` という、誰のものでもないアドレスで作られます。synth を通すための既定値なので、デプロイのときは必ず渡してください。

デプロイが終わると、`no-reply-aws@amazon.com` から確認のメールが届くので、中のリンクを開きます。確認が済んだかどうかは、次のコマンドでわかります。

```bash
aws sesv2 get-email-identity --email-identity you@your-domain.example --region ap-northeast-1
aws sesv2 get-account --region ap-northeast-1
```

1 つ目のコマンドの `VerifiedForSendingStatus` が `true` なら、確認済みです。アドレスは大文字と小文字を区別するので、確認したとおりの綴りで使います。

2 つ目のコマンドの `ProductionAccessEnabled` が `false` なら、sandbox の中です。`SendQuota` には、24 時間の上限と、直近 24 時間に送った数が出ます。

## デプロイした API で送る

<!-- section: 15.deploy -->

確認が済んだら、メールを送ります。次のタスクは本物のメールを送り、料金もかかります（1 通 USD 0.0001）。

```bash
vp run mail:send --to you@your-domain.example
```

このタスクは、同じ `notificationId` で 2 回依頼して、2 回目が `duplicate` になることを確かめます。受信箱に届くのは 1 通のはずです。

IAM の認可が付いた API は、ふつうの `fetch` では呼べないので、タスクはあなたの認証情報でリクエストに署名しています。

<<< @/examples/15-email/scripts/signed-fetch.ts{signed-fetch}

送った通知がどうなったかは、次のコマンドで見ます。

```bash
vp run mail:status --id <notificationId>
vp run mail:logs --events --follow
```

しばらくすると、`sent` が `delivered` に変わるはずです。

### bounce と complaint を起こしてみる

自分のアドレスでは、bounce も complaint も起こせません。そのために SES が用意している宛先が mailbox simulator で、sandbox の中でも使えます。

```bash
vp run mail:send --to success@simulator.amazonses.com
vp run mail:send --to bounce@simulator.amazonses.com
vp run mail:send --to complaint@simulator.amazonses.com
```

`bounce@` は恒久的な bounce を、`complaint@` は complaint を返します。イベントが届くと、この章の関数がその宛先をテーブルに入れるので、同じ宛先への 2 回目の `mail:send` は `suppressed` になります。もう一度試すときは、`bounce+1@simulator.amazonses.com` のように、`+` の後ろにラベルを付けた宛先を使います。

simulator 宛てのメールは、1 日の送信数の上限にも、bounce や complaint の割合にも数えられません。料金は、ふつうのメールと同じだけかかります。

ドリフトの検査は、ほかの章と同じです。

```bash
vp run mail:infra:drift
```

この節と前の節のコマンドは、まだ一度も実際の AWS で通せていません。イベントがフィクスチャと同じ形で届くか、`sent` から `delivered` へ進むまでどのくらいかかるかは、わかったら追記します。

## 独自ドメインで送る: SPF、DKIM、DMARC

<!-- section: 15.dns -->

見知らぬ人に送るなら、ドメインが要ります。受け取る側のメールサーバーは、そのメールを本当にドメインの持ち主が送ったのかどうかを確かめようとし、確かめられないメールは、迷惑メールに振り分けるか、受け取りを拒否します。

確かめる仕組みは 3 つあり、どれも DNS にレコードを置くことで働きます。

SPF は、そのドメインの名前で送ってよいサーバーの一覧です。ただし、SPF が見るのは受信者に見える From ではなく、封筒の差出人（MAIL FROM）のドメインです。SES は、何も設定しなければ、MAIL FROM に `amazonses.com` のサブドメインを使います。その場合も SPF は通りますが、確かめられたのは `amazonses.com` であって、あなたのドメインとは結びつきません。

DKIM は、メールに電子署名を付ける仕組みで、検証用の公開鍵を DNS に置きます。SES の Easy DKIM を使うと、鍵を作るのも署名を付けるのも SES です。あなたが置くのは、鍵の場所を指す CNAME レコード 3 つだけです。SES は、この 3 つが見つかったことを、ドメインの確認としても使います。

DMARC は、SPF と DKIM を From のドメインに結びつけます。From のドメインが SPF か DKIM のどちらかで確かめられることを求め、どちらも失敗したメールをどう扱ってほしいかを、ドメインの持ち主が宣言します。

SES で送る場合、いちばん手数が少ないのは DKIM です。From のドメインに Easy DKIM を設定すれば、DMARC は DKIM の側で通ります。SPF の側でも通したいなら、MAIL FROM を自分のドメインのサブドメイン（たとえば `bounce.your-domain.example`）にします。

ドメインでスタックを作るには、次のように実行します。

```bash
vp run mail:infra:deploy -c fromAddress=notes@your-domain.example -c senderIdentity=your-domain.example
```

MAIL FROM も自分のドメインにするなら、`-c mailFromDomain=bounce.your-domain.example` を足します。

置くべきレコードは、次のタスクが表示します。

```bash
vp run mail:dns --report dmarc@your-domain.example
```

レコードを組み立てているのは、次の関数です。

<<< @/examples/15-email/src/dns.ts{dns}

タスクがするのは表示までで、DNS にレコードを作る作業は自動化していません。Route 53 でも、ほかの DNS サービスでも、管理画面か CLI で、表示されたとおりの名前と値を入れてください。置くレコードをまとめると、次の表になります。

| 何のため | 種類 | 名前 | 値 |
| --- | --- | --- | --- |
| DKIM（ドメインの確認も兼ねる） | CNAME × 3 | SES が発行した `<token>._domainkey.<ドメイン>` | SES が発行した値 |
| MAIL FROM（任意） | MX × 1 | `bounce.<ドメイン>` | `10 feedback-smtp.ap-northeast-1.amazonses.com` |
| SPF（MAIL FROM を設定した場合） | TXT | `bounce.<ドメイン>` | `"v=spf1 include:amazonses.com ~all"` |
| DMARC | TXT | `_dmarc.<ドメイン>` | `"v=DMARC1; p=none; rua=mailto:<報告の宛先>"` |

レコードを置くときに、気を付けることが 3 つあります。

- DKIM のレコードの名前には、`_domainkey` というアンダースコアで始まる部分があります。DNS サービスによっては、ドメイン名を自動で後ろに足すので、二重にならないよう、表示された名前と見比べてください
- MAIL FROM のドメインに置く MX レコードは、ちょうど 1 つです。そのサブドメインには、メールの送信にも受信にも使っていないものを選びます
- DMARC は `p=none`（何もせず、報告だけ受け取る）から始めます。報告を見て、正しいメールが通っていることを確かめてから、`quarantine`、`reject` の順に強めます。最初から `reject` にすると、設定を間違えていたときに、自分のメールがすべて拒否されます

すでに DMARC のレコードがあるドメインでは、上書きせず、いまの方針を先に確かめてください。

```bash
dig TXT _dmarc.your-domain.example
aws sesv2 get-email-identity --email-identity your-domain.example --region ap-northeast-1
```

2 つ目のコマンドの `DkimAttributes.Status` が `SUCCESS` になれば、DKIM の確認は済んでいます。DNS の変更が行き渡るまで、最大 72 時間かかることがあります。

Route 53 を使っている場合、SES のコンソールには、DKIM のレコードを自動で作る機能があります。この章のスタックがその機能を使わないのは、置くレコードを自分の目で一度見ておいてほしいからです。

## sandbox を出る

<!-- section: 15.production -->

確認済みの宛先以外に送るには、production access を申請します。AWS のサポートが人の目で審査する申請なので、スタックからは出せず、申請しても通るとは限りません。

コンソールでは、SES の Account dashboard から「Request production access」を選びます。入力する項目は、次の 5 つです。

- メールの種類: Transactional（利用者の操作をきっかけに 1 人ずつ送るもの）か Marketing（まとめて送る宣伝）。共有の通知は Transactional です
- Web サイトの URL: 送る内容を審査する側が理解するためのもの
- 追加の連絡先: アカウントについての連絡を受け取るアドレス。4 つまで
- 連絡の言語: English か Japanese
- 同意: 明示的に希望した人にだけ送ること、bounce と complaint を処理する仕組みがあること

最後の項目で求められる仕組みが、この章で作ったものです。

同じ申請を、CLI からも出せます。

```bash
aws sesv2 put-account-details --region ap-northeast-1 \
  --production-access-enabled \
  --mail-type TRANSACTIONAL \
  --website-url https://your-domain.example \
  --additional-contact-email-addresses you@your-domain.example \
  --contact-language JA
```

公式ドキュメントによると、最初の返信は 24 時間以内に来ます。追加の情報を求められた場合は、それより長くかかります。審査中は、申請の内容を直せません。

ドキュメントは、申請の前にドメインを確認しておくことを勧めています。申請の結果は、sandbox の中かどうかを確かめたときと同じコマンドで見ます。

```bash
aws sesv2 get-account --region ap-northeast-1
```

`ProductionAccessEnabled` が `true` になれば、sandbox の外です。sandbox を出ても、送信元の identity の確認は要ります。1 日の上限と 1 秒あたりの上限は、`SendQuota` に出ます。

### Cognito のメールも、ここにつながる

06章で、Cognito の既定のメール送信は少量向けだと書きました。公式ドキュメントも、既定の設定の 1 日の上限は、ふつうの本番の量には足りないとしています。利用者が増えたら、user pool の設定で、あなたのアカウントの SES の identity から送るように切り替えます。

切り替えに必要なのは、この章で用意した 2 つ、確認済みの identity と、sandbox の外に出ていることです。sandbox の中のままだと、Cognito は利用者にメールを送れません。
