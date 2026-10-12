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

### 叩かれたら

この API の URL は公開されています。bot が大量に叩いてきたら、どうなるでしょう。

サインインしていない相手にできることは、2 つだけです。`/health` を呼ぶこと。これは関数まで届きます。それ以外の route を呼んで、authorizer に断られること。こちらは関数が動きません。断られたリクエストが API Gateway の料金に数えられるかは、上に書いたとおり確認していません。

サインインした利用者は、全部の route を呼べます。ただし、この user pool は自分で登録できません。利用者は、あなたが `app:user:create` で作った人だけです。

どちらにも、上限があります。stage の throttle が 1 秒 10 リクエスト。1 か月（30 日）で最大 2,592 万リクエストです。それが全部通って、全部が関数を動かしたとすると、こうなります。Lambda とログは、上の例と同じ仮定（平均 60 ミリ秒、256 MB、1 回 0.5 KB）です。

| 対象 | 数量 | 定価 |
| --- | --- | --- |
| API Gateway | 2,592 万リクエスト | 33.44 |
| Lambda（リクエストと実行時間） | 2,592 万回、388,800 GB 秒 | 10.37 |
| ログの取り込みと保存 | 12.36 GB | 9.49 |
| DynamoDB の書き込み（table の上限いっぱい） | 1 秒 40 unit、月 1 億 368 万 unit | 74.13 |
| DynamoDB の読み取り（table の上限いっぱい） | 1 秒 150 unit、月 3 億 8,880 万 unit | 55.40 |
| 小計 | | **182.83** |

サインインしていない相手に届くのは、上の 3 行までです。DynamoDB の 2 行は、サインインした利用者が、いちばん大きいノートの更新と一覧を、1 か月休まず繰り返した場合。そこまで行くことはまずありませんが、「ここより上には行かない」という数字です。

この計算は、1 秒 10 回という上限が API 全体で 1 つだとして出しています。route ごとに別々に数えられるなら、サインインした利用者が届く上の 3 行は、route の数（この章は 7 つ）だけ倍になります。どちらなのかは、実機で確かめていません。DynamoDB の 2 行は、table の上限なので変わりません。429 で返したリクエストに料金がかかるかどうかも、確認していません。

この表には、応答のデータ転送を入れていません。一覧は table から読んだぶんを返すので、table の読み取りの上限が、返せる量の上限にもなります。1 秒 150 unit は、結果整合の読み取りで約 1.2 MB。1 か月続くと約 2,966 GB で、インターネットへの転送の単価（1 GB あたり USD 0.114）を当てはめると USD 338 ほどです。この単価が API Gateway の応答にそのまま当てはまるかは、04章と同じく確かめていません。一覧を呼べるのは、サインインした利用者だけです。

溜まるほうにも上限があります。ノートは 1 人 100 件まで、1 件は大きくても約 31 KB。1 人あたり 3 MB ほどです。

そして、この上限は呼ぶ相手を区別しません。bot が叩き続けている route では、本物の利用者も 429 を受け取ります。料金は守れても、使える状態は守れません。それを守るには、相手ごとに絞る部品が要ります。AWS WAF の rate-based rule がそれですが、[21章](/ja/chapters/21-security.md)で話すとおり、HTTP API には直接付けられません。手前に CloudFront を置いて、そこに付けます（web ACL が月 USD 5、rule 1 つにつき月 USD 1、検査 100 万回あたり USD 0.60）。この本では、その構成は実装していません。

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
| 429 が返る | stage の throttle（1 秒 10 リクエスト）です。上限は利用者ごとではないので、ほかの誰かが使い切っても返ります。少し待って、もう一度 |
| ノートの作成が 409 `quota_exceeded` を返す | その利用者のノートが 100 件あります。待っても変わりません。1 件消してください |
| 利用者を無効にしたのに、まだ API を呼べる | 「無効にしても、しばらく通る」のとおりです。access token の期限まで通ります |

API Gateway が返す 401 と 403 の本文は、この本のエラーの形（`error.code`）ではありません。型付きの client は、それを `unauthenticated` として扱います。

## 本番にするなら

- **相手ごとに流量を絞る。** この章の throttle は、呼ぶ相手を区別しません。「叩かれたら」のとおり、手前に CloudFront と AWS WAF を置くか、利用者ごとの上限をアプリで数えます
- **MFA を有効にする。** この章の user pool は、パスワードだけです。足すなら、利用者が認証アプリを登録する手順も一緒に用意します。この章の SPA には、その画面がありません
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

**手元で確かめたこと。** API のテスト（認証、認可、監査ログ）、identity の読み取りのテスト、開発用サインインのテスト、PKCE の一時保存のテスト、インフラの assertion、型検査、SPA のビルド、synth。それから、`dev:app:api` と `dev:app:web` を起動して、ブラウザを自動操作して次を確かめました。サインイン、ノートの作成、別の利用者からの取得が 404 になること、token なしが 401 になること、競合の表示と「自分の入力で保存し直す」、再読み込み後にサインインを求められること。今回足した上限は、テストで確かめました。利用者ごとに 101 件目のノートが 409 になり、ほかの利用者には影響せず、消せば空きが戻ること（`composeApp` を通した場合も）。template の stage に throttle が、table に request unit の上限があること。

**まだ確かめていないこと。** Cognito でのサインインは、一度も実行していません。`web/src/auth/cognito.ts`（authorization code と PKCE の往復、token の交換）は、型検査を通っただけで、実際の user pool に対して動かしていません。この章でもっとも重要な未検証の部分です。`app:infra:deploy`、`app:user:create`、`app:publish`、`app:smoke:web`、`app:smoke:api`、`app:infra:drift`、`app:unpublish`、`app:infra:destroy` も実行していません。したがって、次も実環境では確かめていません。JWT authorizer が ID token と不正な token を拒否すること。Cognito の token endpoint をブラウザから直接呼べること（CORS）。`config.json` に書き出す `Issuer` と `AuthDomain` の形が、oauth4webapi の検証に合うこと。上限まわりも同じです。cdkd 0.296.28 が stage の `DefaultRouteSettings` と table の `OnDemandThroughput` を反映するか。throttle が API 全体で数えられるのか、route ごとなのか。429 や、authorizer が断ったリクエストに料金がかかるか。ノートを数える条件付きの更新が、実際の DynamoDB で通ること。「叩かれたら」の金額は、単価と仮定からの計算です。

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
