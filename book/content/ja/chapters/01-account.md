---
title: 01 Account: 一時認証情報、リージョン、予算、片付け
revision: 3
---

# 01 Account: 一時認証情報、リージョン、予算、片付け

アプリを作る前に、AWS を安心して触れる状態にしておきましょう。

この章でやるのは 4 つです。root ユーザーを MFA で守って、ふだんの作業には使わないようにする。長期のアクセスキーを作らずに、ターミナルから AWS を操作できるようにする。支出がしきい値を超えたら通知が届くようにする。そして、「消したつもり」をちゃんと確かめる習慣をつける。作る AWS のリソースは予算（budget）1 つだけで、アプリはまだ出てきません。

前提は [00章](/ja/chapters/00-welcome.md)だけです。`vp run` で始まるコマンドは、[02章](/ja/chapters/02-toolchain.md)で用意する環境で動きます。先に 02章の「環境に入る」まで済ませてから戻ってきても大丈夫です。

## アカウントを作る

<!-- section: 01.account -->

アカウント（account）は、AWS のリソースと請求の入れ物です。12 桁の ID が付いています。作るのは Web の画面での手作業で、ここはコードにできません。

用意するものは 3 つ。

- メールアドレス。あとで復旧に使うので、長く読み続けられる受信箱のものを
- クレジットカードなどの支払い方法
- SMS か音声通話を受けられる電話番号

<https://aws.amazon.com/> から作成を始めます。途中でプランを選ぶ場面があります。確認日（2026-10-11）の時点で、公式の Free Tier のページにはこう書かれています。

- 新しいアカウントは USD 100 の credits を受け取り、指定のサービスを使うとさらに最大 USD 100 を得られる
- Free plan のアカウントは、作成から 6 か月経つか credits を使い切ると、Paid plan に切り替えない限り閉じられる
- Free plan では使えないサービスがある
- 30 以上のサービスに、どちらのプランでも毎月使える無料枠（always free）がある

正直に言うと、この本のどの章が Free plan のままで実行できるかは、確認していません。使えないサービスに当たったら、そのときに Paid plan への切り替えを考えてください。Paid plan は使った分だけ請求されるプランで、credits が残っていればそこから引かれます。

学習用のアカウントは、仕事や本番のアカウントと分けておくのがおすすめです。試しに作ったものを、アカウントごと閉じられるので。

## root ユーザーを守る

<!-- section: 01.root -->

アカウントを作ったときのメールアドレスとパスワードでサインインする利用者を、root ユーザー（root user）と呼びます。root ユーザーの権限は制限できません。請求情報の変更も、アカウントの解約も、できてしまいます。

なので、最初に 3 つやっておきます。どれもコンソール（Web の管理画面）での手作業です。

1. MFA を有効にする。右上のアカウント名から「セキュリティ認証情報」を開いて、多要素認証（MFA）のデバイスを登録します。passkey か認証アプリが使えます
2. 復旧の手段を確かめる。root のメールアドレスが今も読めること、登録した電話番号が今も使えることを確認します。アカウント設定の「代替連絡先」に、請求とセキュリティの連絡先も入れておきましょう
3. root のアクセスキーを作らない。すでにあれば削除します

MFA が有効かどうかは、あとの「ターミナルからサインインする」を済ませてから、コマンドで確かめられます。

```bash
aws iam get-account-summary --query 'SummaryMap.AccountMFAEnabled'
```

`1` なら、root ユーザーに MFA が設定されています。

ここから先、root ユーザーでサインインするのは、root でないとできない操作（支払い方法の変更、アカウントの解約など）のときだけにします。

## ふだん使いの identity を用意する

<!-- section: 01.identity -->

ふだんの作業に使う identity（サインインする主体）は、root と分けます。やり方は 2 つあります。

1 つ目は IAM Identity Center。AWS が人間の利用者向けに勧めている方法です。複数のアカウントを使う予定がある、あるいは組織で使うなら、こちらにしてください。ターミナルからは `aws configure sso` と `aws sso login` でサインインします。この本では手順を再現していないので、公式ドキュメントの「Configuring IAM Identity Center authentication with the AWS CLI」に従ってください。

2 つ目は、IAM ユーザーを 1 人作って、コンソールのサインインをそのまま使う方法。個人の学習用アカウントが 1 つだけなら、こちらのほうが手数が少なくて済みます。この先はこちらで進めますね。

コンソールの IAM の画面で、こんなユーザーを作ります。

- ユーザー名: `aih-dev`（好きな名前でかまいません）
- コンソールへのアクセス: 有効にして、パスワードを設定する
- MFA: 作ったあとに必ず登録する
- アクセスキー: 作らない
- 許可ポリシー: `AdministratorAccess` と `SignInLocalDevelopmentAccess`

`SignInLocalDevelopmentAccess` は、次の節で使う `aws login` に必要な AWS 管理ポリシーです。

`AdministratorAccess` は強い権限です。それでもここで使うのは、CDK がデプロイのたびに IAM の role を作るから。IAM を操作できない identity では、この本のサンプルを作れないんです。ただ、この選択が妥当なのは**自分だけが使う学習用アカウント**に限ります。共有のアカウントや、守るべきデータがあるアカウントでは使わないでください。権限を絞る方法は [21章](/ja/chapters/21-security.md)で扱います。

アクセスキーを作らないのは、あれが期限のない秘密だからです。ファイルに保存されて、うっかりコミットされて、漏れても自動では失効しません。次の節の方法なら、手元に残るのは期限付きの認証情報だけです。

## ターミナルからサインインする

<!-- section: 01.login -->

`aws login` は、コンソールにサインインするのと同じ資格で、ターミナル用の一時認証情報（temporary credentials）を受け取るコマンドです。一時認証情報というのは、access key、secret key、session token の 3 つに期限が付いたもの。

AWS CLI 2.32.0 以上が必要です。この本の環境には 2.35.11 が入っています。

```bash
aws login --profile aih
```

初回はリージョンを聞かれるので、`ap-northeast-1` と答えます。ブラウザが開いたら、前の節で作った `aih-dev` でサインインしてください。終わると、`~/.aws/config` にこんな profile ができます。

```ini
[profile aih]
login_session = arn:aws:iam::111111111111:user/aih-dev
region = ap-northeast-1
```

このファイルに秘密は入っていません。認証情報そのものは `~/.aws/login/cache` に置かれて、CLI と SDK が 15 分ごとに更新します。セッションは最長 12 時間で切れるので、切れたらもう一度 `aws login` です。使い終わったら `aws logout --profile aih` で消せます。

いま、どの identity でどのアカウントを触ろうとしているのか。これはいつでも確かめられます。

```bash
AWS_PROFILE=aih vp run account:whoami
```

```text
action:  identify credentials (reads AWS)
account: 111111111111
region:  ap-northeast-1
caller:  arn:aws:iam::111111111111:user/aih-dev
```

このタスクは AWS の STS に「私は誰？」と尋ねるだけで、何も変更しません。

毎回 `AWS_PROFILE` を書くのは面倒ですよね。リポジトリのルートで `.env.example` を `.env` にコピーして、自分のアカウント ID を入れておきましょう。

<<< @/.env.example

`AIH_AWS_ACCOUNT_ID` は安全装置です。AWS を変更するタスクは、いま使っている認証情報のアカウントがこの値と一致しない限り、実行を断ります。別の仕事の profile のままデプロイしてしまう、あの事故を防ぐためです。判定しているのは次の関数で、テストもあります。

<<< @/tools/src/aws/target.ts{check}

`.env` に AWS の認証情報は書きません。`.env` は git の管理対象から外してあります。

正直に言うと、`aws login` からここまでの流れは、まだ実際の AWS アカウントで通せていません。詳しくは章末の検証メモに書きました。

## リージョンは東京

<!-- section: 01.region -->

リージョン（Region）は、AWS がサービスを提供する地理的な単位です。この本は東京の `ap-northeast-1` を使います。ほとんどのリソースはリージョンに属していて、別のリージョンからは見えません。コンソールの右上でリージョンを切り替え忘れると、「作ったはずのものが無い」ように見えます。よくあるやつです。

ただ、リージョンに属さないものや、別のリージョンを指定しないといけないものもあります。この本で出会う順に並べると、こうです。

- IAM のユーザー、role、ポリシー: アカウント全体で 1 つ。リージョンを持ちません
- 予算（AWS Budgets）と請求: アカウント全体。API の窓口は `us-east-1` です
- CloudFront の distribution: 全世界に配信されます。管理 API の窓口は `us-east-1` です
- CloudFront に付ける ACM の証明書: `us-east-1` で作る必要があります

東京リージョンで提供されていない機能に当たった章では、その章で例外を明記します。

## 予算の通知を仕掛ける

<!-- section: 01.budget -->

予算（budget）は、支出がしきい値を超えた、または超えそうなときに通知してくれる仕組みです。ここは誤解しやすいのですが、**支出を止める上限ではありません**。

公式ドキュメントによると、予算の情報が更新されるのは 1 日に最大 3 回で、更新の間隔はおおむね 8〜12 時間です。そのうえ、リソースを使ってから請求に反映されるまでにも遅れがあります。つまり、通知が届いた時点で、支出はもうしきい値を超えているかもしれません。予算が防いでくれるのは「気づくのが翌月の請求書」になることであって、使いすぎそのものではないんです。

だから、この本で誰でも呼べる入口を開く章（04、05、06、07、08、09、10、12、13、14、15、17、18、19、20、21）は、受ける量にそれぞれ自分で蓋をしています。何をどこまで絞っていて、何が絞りきれていないかは、各章が自分で書いています。予算の通知は、その蓋が効いていなかったときに、何時間か遅れて気づくための最後の網です。

では、月 USD 10 の予算を作りましょう。定義はこのファイルです。

<<< @/examples/01-account/budget.json

`IncludeCredit` は `false` にしてあります。credits で相殺された支出も、通知の計算に含めたいからです。`true` にすると、credits が残っている間は予算が動かず、credits が尽きた月に初めて通知が来ます。

通知先は自分で用意します。`examples/01-account/notifications.example.json` を `notifications.json` という名前でコピーして、メールアドレスを書き換えてください。

<<< @/examples/01-account/notifications.example.json

1 つ目は実績が予算の 50% を超えたとき、2 つ目は月末の予測が 100% を超えたときの通知です。

```bash
vp run account:budget:create
```

このタスクは AWS を変更します。実行する前に対象のアカウントを表示して、`AIH_AWS_ACCOUNT_ID` と一致しなければ止まります。`notifications.json` に例のアドレスが残っているときも止まります。誰にも届かない予算は、守りになりませんからね。

作成できたかどうかは、コンソールの「Billing and Cost Management」→「Budgets」で確かめます。

AWS Budgets 自体の料金は、この本では確認していません。公式の料金ページで確かめてください。

## 片付けの考え方

<!-- section: 01.cleanup -->

AWS の料金の多くは、「存在している時間」か「保存している量」にかかります。使っていなくても、消すまで請求されるものがあるんです。なので、この本の各章は最後に次の 3 つを書きます。

1. 消すためのタスク
2. 消しても残るもの（ログ、バックアップ、保持設定のついた bucket など）
3. 残ったものにかかる料金

片付けたら、数日後にコンソールの「Billing and Cost Management」→「Bills」を見て、その日以降の利用が増えていないことを確かめましょう。請求への反映は即時ではないので、当日に見てもわかりません。

この章で作ったものを消すなら、これです。

```bash
vp run account:budget:delete
```

とはいえ、予算は消さずに残しておくのがおすすめです。次の章から、料金のかかるリソースを作り始めるので。

アカウントごとやめるときは、root ユーザーでサインインして、アカウント設定から解約します。これも手作業です。

## ハマりどころ

| こうなったら | ここを見る |
| --- | --- |
| `aws login` を実行すると、そのようなコマンドは無いと言われる | AWS CLI が 2.32.0 未満です。`aws --version` を確認して、02章の環境の中で実行する |
| `aws login` 後のコマンドが権限エラーになる | IAM ユーザーに `SignInLocalDevelopmentAccess` が付いていますか |
| `vp run account:whoami` が認証情報を特定できないと言う | `AWS_PROFILE` が `aws login` で作った profile 名と一致していますか。セッションが 12 時間を過ぎていませんか |
| アカウント ID が違うと言われて止まる | 別の profile を使っています。`.env` の `AWS_PROFILE` と `AIH_AWS_ACCOUNT_ID` を見直す |
| コンソールで作ったはずのものが見えない | 右上のリージョンは東京になっていますか |

::: details この章の検証メモ

**手元で確かめたこと。** `tools/src/aws/target.ts` の判定は、ユニットテストで確かめています。

**まだ確かめていないこと。** `aws login`、`account:whoami`、`account:budget:create` は、実際の AWS アカウントでは実行していません。この本の tools が使う AWS SDK for JavaScript v3（3.1149.0）が、`aws login` の認証情報をそのまま読めることも未確認です。読めない場合の回避策として、公式ドキュメントは `credential_process` で CLI に認証情報を出させる profile を挙げています。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| ターミナルからサインインする | `tools/src/aws/target.ts`、`tools/src/aws/target.test.ts`、`tools/src/aws/preflight.ts`、`tools/src/aws/whoami.ts`、`.env.example` | `account:whoami` |
| 予算の通知を仕掛ける | `examples/01-account/budget.json`、`examples/01-account/notifications.example.json`、`tools/src/aws/budget.ts` | `account:budget:create` |
| 片付けの考え方 | `tools/src/aws/budget.ts` | `account:budget:delete` |

**一次情報**

- [Login for AWS local development using console credentials](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html)（確認日 2026-10-11）
- [Managing your costs with AWS Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html)（確認日 2026-10-11）
- [AWS Free Tier](https://aws.amazon.com/free/)（確認日 2026-10-11）
- [Security best practices in IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)（執筆時に未再確認）

:::
