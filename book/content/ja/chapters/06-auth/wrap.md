---
title: "06 Auth: 費用、注意点、片付け"
---

# 06 Auth: 費用、注意点、片付け

## Workers から来た人へ

Cloudflare で同じことをするなら、Cloudflare Access を前に置くか、Worker の中で JWT を検証するライブラリを使うことが多いと思います。違いが出るのは、検証をどこでやるかです。

この章では、検証は関数の手前（API Gateway）で済んでいて、関数は結果を読むだけです。Worker の中で検証するやり方だと、検証のコードも、公開鍵の取得と cache も、あなたのコードの責任になります。

どちらにもいいところがあります。手前で済ませるやり方は、コードが少なくて、不正なリクエストで関数が動きません。そのかわり、検証の規則は API Gateway が提供する範囲に限られます。

この比較は一般的な構成についての話で、Cloudflare 側の一次情報は確認していません。

## お金の話

金額は USD、東京リージョン、税別です。計算の入力と単価は[料金の計算](/ja/reference/pricing.md)にあります。

まず Cognito から。user pool は、月間アクティブユーザー（MAU）の数に対して課金されます。その月に、サインインや token の更新など何らかの操作があった利用者が 1 人と数えられます。新しい user pool の既定のプランは Essentials で、東京リージョンでは 1 MAU あたり USD 0.015 です。料金ページによると、Essentials と Lite には、アカウント（または organization）ごとに月 10,000 MAU の無料枠があって、12 か月で失効しません。

利用者が 100 人なら、定価で月 USD 1.50。無料枠の範囲内なら 0 です。

メールと SMS は別料金です。この章の構成では、利用者を作るときの仮パスワードのメールを、Cognito の既定の送信機能で送ります。その上限と料金は確認していません。利用者が多いアプリでは Amazon SES を使います（[15章](/ja/chapters/15-email.md)）。

JWT authorizer はどうでしょう。東京リージョンの API Gateway の価格表に、authorizer の項目はありません。拒否されたリクエストでは関数が起動しないので、Lambda の料金はかかりません。そのリクエストが API Gateway のリクエスト料金に数えられるかどうかは、確認していません。

アプリ全体だと、こうなります。05章の月 100 万リクエストの例に、100 MAU を足した計算です。

| 対象 | 定価 | 毎月の無料枠の適用後 |
| --- | --- | --- |
| 05章の合計（API Gateway、Lambda、ログ、DynamoDB） | 2.41 | 1.64 |
| Cognito（Essentials、100 MAU） | 1.50 | 0 |
| 小計 | **3.91** | **1.64** |

SPA の配信（CloudFront と S3）は、03章の計算を見てください。

**誰もサインインしない月は、Cognito の料金は 0 です。** 残るのは、table と bucket の保存量だけです。

stack を消すと、user pool も中の利用者も一緒に消えます。残るのは「片付け」に書いたとおり、cdkd の bootstrap で作った保存場所と、そこに置かれたデプロイ用のファイルだけです。

## ハマりどころ

| こうなったら | ここを見る |
| --- | --- |
| `dev:app:api` が `LOCAL_AUTH_SECRET` と言って止まる | `examples/06-auth/.env` はありますか。値は 32 文字以上ですか |
| 手元の SPA が「The app could not start」と出る | `dev:app:api` は動いていますか。`web/public/config.json` の `apiUrl` も確認 |
| サインイン画面が、redirect 先の不一致を示すエラーを出す | SPA の origin と `/callback` が、client の callback URL と完全に一致していますか。末尾の `/` の有無も区別されます |
| サインイン後、「does not belong to a sign-in started in this tab」と出る | サインインを始めたタブと、戻ってきたタブが違います。あるいは 10 分以上かかりました。もう一度サインインしてください |
| デプロイした API が、サインイン済みでも 401 を返す | SPA が送っているのは access token ですか。`config.json` の `clientId` が、stack の `UserPoolClientId` と一致していますか |
| 403 が返る | token に `openid` の scope がありません。サインインの依頼で `scope=openid` を送っていますか |
| ブラウザのコンソールに CORS のエラーが出る | 401 や 403 を API Gateway が返すとき、応答に CORS のヘッダーが付かず、ブラウザが CORS のエラーとして表示することがあります。まず `curl` で状態コードを確かめてください |
| 利用者を無効にしたのに、まだ API を呼べる | 「無効にしても、しばらく通る」のとおりです。access token の期限まで通ります |

API Gateway が返す 401 と 403 の本文は、この本のエラーの形（`error.code`）ではありません。型付きの client は、それを `unauthenticated` として扱います。

## 本番にするなら

- **MFA を有効にする。** この章の user pool は、パスワードだけです
- **手元の origin を外す。** callback URL と CORS から `http://localhost:5173` を消します。開発用には別の stack を使います
- **独自ドメインを使う。** サインイン画面のドメインが `...amazoncognito.com` のままだと、利用者にとって本物かどうか見分けにくくなります
- **メールを SES から送る。** Cognito の既定の送信は、少量向けです（[15章](/ja/chapters/15-email.md)）
- **token の寿命と失効の方針を決める。** 「無効にしても、しばらく通る」の表から選びます
- **Content-Security-Policy を設定する。** XSS の被害を減らします。03章で話したとおり、管理ポリシーには含まれません
- **利用者の削除とデータの削除をつなぐ。** 利用者を消しても、その `sub` の下のノートは table に残ります。消す処理が要ります
- **user pool を守る。** `removalPolicy` を `RETAIN` にして、削除保護を有効にします。user pool を消すと、利用者は全員、登録からやり直しです

## 片付け

<!-- section: 06.cleanup -->

```bash
vp run app:unpublish --yes
vp run app:infra:destroy
```

先に bucket を空にします。`app:infra:destroy` で、user pool、table、関数、API、distribution、bucket が消えます。利用者もノートもすべて消えて、元には戻せません。

利用者だけを消すなら、`vp run app:user:delete you@example.com` です。その利用者のノートは table に残ります。

残るのは、cdkd の bootstrap で作った保存場所（02章）と、そこに置かれたデプロイ用のファイルだけです。

::: details この章の検証メモ

**手元で確かめたこと。** API のテスト（認証、認可、監査ログ）、identity の読み取りのテスト、開発用サインインのテスト、PKCE の一時保存のテスト、インフラの assertion、型検査、SPA のビルド、synth。それから、`dev:app:api` と `dev:app:web` を起動して、ブラウザを自動操作して次を確かめました。サインイン、ノートの作成、別の利用者からの取得が 404 になること、token なしが 401 になること、競合の表示と「自分の入力で保存し直す」、再読み込み後にサインインを求められること。

**まだ確かめていないこと。** Cognito でのサインインは、一度も実行していません。`web/src/auth/cognito.ts`（authorization code と PKCE の往復、token の交換）は、型検査を通っただけで、実際の user pool に対して動かしていません。この章でもっとも重要な未検証の部分です。`app:infra:deploy`、`app:user:create`、`app:publish`、`app:smoke:web`、`app:smoke:api`、`app:infra:drift`、`app:unpublish`、`app:infra:destroy` も実行していません。したがって、次も実環境では確かめていません。JWT authorizer が ID token と不正な token を拒否すること。Cognito の token endpoint をブラウザから直接呼べること（CORS）。`config.json` に書き出す `Issuer` と `AuthDomain` の形が、oauth4webapi の検証に合うこと。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 契約に「誰か」を足す | `examples/06-auth/api/src/contract.ts` | `test:unit` |
| 誰からの呼び出し？ | `examples/06-auth/api/src/identity.ts`、`api/src/lambda.ts`、`api/src/app.ts`、`api/test/identity.test.ts` | `test:unit` |
| 自分のノートにしか届かない | `examples/06-auth/api/src/app.ts`、`api/test/app.test.ts`、`examples/05-dynamodb/src/notes.ts` | `test:unit` |
| 手元で 2 人になる | `examples/06-auth/api/src/dev.ts`、`api/src/local-auth.ts`、`api/test/local-auth.test.ts`、`api/src/compose.ts`、`web/src/auth/local.ts`、`web/src/config.ts`、`web/public/config.json`、`.env.example` | `dev:app:api`、`dev:app:web` |
| SPA からサインインする | `examples/06-auth/web/src/auth/`、`web/src/App.vue`、`web/src/router/route.ts`、`api/src/client.ts` | `test:unit`、`typecheck:app:web`、`lint:app:web`、`build:app:web` |
| AWS にのせる準備 | `examples/06-auth/infra/lib/notes-app-stack.ts`、`infra/bin/app.ts`、`infra/functions/spa-fallback.js`、`infra/test/notes-app-stack.test.ts`、`cdk.json` | `app:infra:synth`、`test:unit` |
| デプロイする | `examples/06-auth/scripts/write-config.ts`、`scripts/user.ts`、`scripts/smoke.ts`、`tools/src/site/`、`tools/src/infra/` | `app:infra:diff`、`app:infra:deploy`、`app:user:create`、`app:publish`、`app:smoke:web`、`app:smoke:api`、`app:infra:drift` |
| 片付け | `tools/src/site/unpublish.ts`、`examples/06-auth/scripts/user.ts` | `app:unpublish`、`app:infra:destroy`、`app:user:delete` |
| お金の話 | `data/pricing/` | `test:unit` |

**一次情報**（確認日はすべて 2026-10-11）

- [Control access to HTTP APIs with JWT authorizers in API Gateway](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html)
- [The redirect and authorization endpoint](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html)
- [Understanding the access token](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-access-token.html)
- [Ending user sessions with token revocation](https://docs.aws.amazon.com/cognito/latest/developerguide/token-revocation.html)
- [The managed login sign-out endpoint](https://docs.aws.amazon.com/cognito/latest/developerguide/logout-endpoint.html)
- [Amazon Cognito pricing](https://aws.amazon.com/cognito/pricing/)
- AWS Price List bulk API: [Cognito](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCognito/current/ap-northeast-1/index.json)
- [oauth4webapi 3.8.8](https://www.npmjs.com/package/oauth4webapi/v/3.8.8)、[jose 6.2.12](https://www.npmjs.com/package/jose/v/6.2.12)（型定義）
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)

:::
