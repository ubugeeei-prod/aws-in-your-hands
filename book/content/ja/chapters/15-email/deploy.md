---
title: "15 Email: デプロイ"
---

# 15 Email: デプロイ

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
