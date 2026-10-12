---
title: "06 Auth: 費用、注意点、片付け"
---

# 06 Auth: 費用、注意点、片付け

この章の最後のページです。Cloudflare でのやり方との違い、料金、つまずきやすいところ、本番に進めるときに変えることをまとめ、作ったものを片付けます。

## Workers から来た人へ

Cloudflare で同じことをするなら、Cloudflare Access を前に置くか、Worker の中で JWT を検証するライブラリを使うことが多いと思います。この章との違いは、検証をどこでするかにあります。

この章では、検証は関数の手前の API Gateway で済んでいて、関数は結果を読むだけです。Worker の中で検証する方法では、検証のコードも、公開鍵の取得とキャッシュも、あなたのコードの責任になります。

手前で済ませる方法は、コードが少なく、不正なリクエストで関数が動きません。そのかわり、検証の規則は API Gateway が提供する範囲に限られます。どちらにも利点があります。

この比較は一般的な構成についてのもので、Cloudflare 側の一次情報は確認していません。

## 料金

金額は USD、東京リージョン、税別です。計算の入力と単価は[料金の計算](/ja/reference/pricing.md)にあります。

Cognito のユーザープールは、月間アクティブユーザー（MAU）の数に対して課金されます。その月に、サインインやトークンの更新など何らかの操作があった利用者が、1 人と数えられます。新しいユーザープールの既定のプランは Essentials で、東京リージョンでは 1 MAU あたり USD 0.015 です。料金ページによると、Essentials と Lite には、アカウント（または organization）ごとに月 10,000 MAU の無料枠があり、12 か月で失効しません。

利用者が 100 人なら、定価で月 USD 1.50 です。無料枠の範囲内なら 0 です。

メールと SMS は別料金です。この章の構成では、利用者を作るときの仮パスワードのメールを、Cognito の既定の送信機能で送ります。その上限と料金は確認していません。利用者が多いアプリでは Amazon SES を使います（[15章](/ja/chapters/15-email.md)）。

東京リージョンの API Gateway の価格表に、JWT オーソライザーの項目はありません。拒否されたリクエストでは関数が起動しないので、Lambda の料金はかかりません。そのリクエストが API Gateway のリクエスト料金に数えられるかどうかは、確認していません。

アプリ全体の料金は次の表のとおりです。05章の月 100 万リクエストの例に、100 MAU を足して計算しました。

| 対象 | 定価 | 毎月の無料枠の適用後 |
| --- | --- | --- |
| 05章の合計（API Gateway、Lambda、ログ、DynamoDB） | 2.41 | 1.64 |
| Cognito（Essentials、100 MAU） | 1.50 | 0 |
| 小計 | **3.91** | **1.64** |

SPA の配信（CloudFront と S3）の料金は、03章の計算を見てください。

**誰もサインインしない月は、Cognito の料金は 0 です。** 残るのは、テーブルとバケットの保存量にかかる料金だけです。

スタックを消すと、ユーザープールも中の利用者も一緒に消えます。残るのは「片付け」に書いたとおり、cdkd の bootstrap で作った保存場所と、そこに置かれたデプロイ用のファイルだけです。

### 叩かれたら

この API の URL は公開されているので、bot が大量のリクエストを送ってくることがあります。そのときに何が起き、いくらかかるかを見ておきます。

サインインしていない相手にできることは、2 つだけです。1 つは `/health` を呼ぶことで、このリクエストは関数まで届きます。もう 1 つは、それ以外のルートを呼んでオーソライザーに断られることで、このときは関数が動きません。断られたリクエストが API Gateway の料金に数えられるかどうかは、上に書いたとおり確認していません。

サインインした利用者は、すべてのルートを呼べます。ただし、このユーザープールは自分では登録できないので、利用者は、あなたが `app:user:create` で作った人だけです。

どちらの相手にも上限があります。ステージのスロットリングが 1 秒 10 リクエストなので、1 か月（30 日）で最大 2,592 万リクエストです。そのすべてが通り、すべてが関数を動かしたとすると、次の表のようになります。Lambda とログは、上の例と同じ仮定（平均 60 ミリ秒、256 MB、1 回 0.5 KB）です。

| 対象 | 数量 | 定価 |
| --- | --- | --- |
| API Gateway | 2,592 万リクエスト | 33.44 |
| Lambda（リクエストと実行時間） | 2,592 万回、388,800 GB 秒 | 10.37 |
| ログの取り込みと保存 | 12.36 GB | 9.49 |
| DynamoDB の書き込み（テーブルの上限いっぱい） | 1 秒 40 ユニット、月 1 億 368 万ユニット | 74.13 |
| DynamoDB の読み取り（テーブルの上限いっぱい） | 1 秒 150 ユニット、月 3 億 8,880 万ユニット | 55.40 |
| 小計 | | **182.83** |

サインインしていない相手に届くのは、上の 3 行までです。DynamoDB の 2 行は、サインインした利用者が、いちばん大きいノートの更新と一覧を 1 か月休まず繰り返した場合の値です。そこまで行くことはまずありませんが、これより上には行かないという数字として載せています。

この計算は、1 秒 10 回というスロットリングが API 全体で 1 つだとして出しています。ルートごとに別々に数えられるなら、サインインした利用者が届く上の 3 行は、ルートの数（この章は 7 つ）だけ倍になります。どちらなのかは、実機で確かめていません。DynamoDB の 2 行は、テーブルの上限なので変わりません。429 で返したリクエストに料金がかかるかどうかも、確認していません。

この表には、レスポンスのデータ転送を入れていません。レスポンスの大きさには上限があり、一覧は 1 ページ 20 件の要約で 20 KiB まで、ノート 1 件は 64 KiB までです。1 秒 10 回が 1 か月続くと、すべてが一覧なら約 494 GB で、インターネットへの転送の単価（1 GB あたり USD 0.114）を当てはめると USD 56 ほどです。すべてが 64 KiB のノート 1 件だったとしても、約 1,582 GB で USD 180 ほどに収まります。この単価が API Gateway のレスポンスにそのまま当てはまるかどうかは、04章と同じく確かめていません。ノートを返すルートを呼べるのは、サインインした利用者だけです。

溜まるデータの量にも上限があります。ノートは 1 人 100 件までで、1 件は大きくても約 31 KB なので、1 人あたり 3 MB ほどです。

スロットリングは、呼ぶ相手を区別しません。bot がリクエストを送り続けているルートでは、本物の利用者も 429 を受け取ります。料金は守れても、使える状態は守れません。使える状態を守るには、相手ごとに絞る仕組みが要ります。AWS WAF のレートベースのルールがそれにあたりますが、[21章](/ja/chapters/21-security.md)で説明するとおり、HTTP API には直接付けられません。手前に CloudFront を置いて、そこに付けます（web ACL が月 USD 5、ルール 1 つにつき月 USD 1、検査 100 万回あたり USD 0.60。21章の構成はルールが 3 つなので、月 USD 8.00 から）。この本では、その構成は実装していません。

## つまずきやすいところ

| こうなったら | ここを見る |
| --- | --- |
| `dev:app:api` が `LOCAL_AUTH_SECRET` を示して止まる | `examples/06-auth/.env` があるか、値が 32 文字以上かを確かめます |
| 手元の SPA が「The app could not start」と出す | `dev:app:api` が動いているかを確かめます。`web/public/config.json` の `apiUrl` も確認してください |
| サインイン画面が、リダイレクト先の不一致を示すエラーを出す | SPA のオリジンと `/callback` が、クライアントのコールバック URL と完全に一致しているかを確かめます。末尾の `/` の有無も区別されます |
| サインイン後、「does not belong to a sign-in started in this tab」と出る | サインインを始めたタブと戻ってきたタブが違うか、10 分以上かかっています。もう一度サインインしてください |
| デプロイした API が、サインイン済みでも 401 を返す | SPA が送っているのがアクセストークンかどうかと、`config.json` の `clientId` がスタックの `UserPoolClientId` と一致しているかを確かめます |
| 403 が返る | トークンに `openid` のスコープがありません。サインインの依頼で `scope=openid` を送っているかを確かめます |
| ブラウザのコンソールに CORS のエラーが出る | API Gateway が 401 や 403 を返すとき、レスポンスに CORS のヘッダーが付かず、ブラウザが CORS のエラーとして表示することがあります。まず `curl` で状態コードを確かめてください |
| 429 が返る | ステージのスロットリング（1 秒 10 リクエスト）です。利用者ごとではないので、ほかの誰かが使い切っても返ります。少し待ってから、もう一度呼んでください |
| ノートの作成が 409 `quota_exceeded` を返す | その利用者のノートが 100 件あります。待っても変わらないので、1 件消してください |
| 利用者を無効にしたのに、まだ API を呼べる | [無効にしても、しばらく通る](/ja/chapters/06-auth/deploy.md)で説明した動きです。アクセストークンの期限まで通ります |

API Gateway が返す 401 と 403 の本文は、この本のエラーの形（`error.code`）ではありません。型付きのクライアントは、それを `unauthenticated` として扱います。

## 本番にするなら

- 相手ごとにリクエストを絞ります。この章のスロットリングは、呼ぶ相手を区別しません。「叩かれたら」に書いたとおり、手前に CloudFront と AWS WAF を置くか、利用者ごとの上限をアプリで数えます
- MFA を有効にします。この章のユーザープールは、パスワードだけです。MFA を足すなら、利用者が認証アプリを登録する手順も一緒に用意します。この章の SPA には、その画面がありません
- 手元のオリジンを外します。コールバック URL と CORS から `http://localhost:5173` を消し、開発用には別のスタックを使います
- 独自ドメインを使います。サインイン画面のドメインが `...amazoncognito.com` のままだと、利用者には本物かどうかを見分けにくくなります
- メールを SES から送ります。Cognito の既定の送信は、少量向けです（[15章](/ja/chapters/15-email.md)）
- トークンの寿命と失効の方針を決めます。[無効にしても、しばらく通る](/ja/chapters/06-auth/deploy.md)の表から選びます
- Content-Security-Policy を設定して、XSS の被害を減らします。03章で説明したとおり、管理ポリシーには含まれません
- 利用者の削除とデータの削除をつなぎます。利用者を消しても、その `sub` の下のノートはテーブルに残るので、消す処理が要ります
- ユーザープールを守ります。`removalPolicy` を `RETAIN` にして、削除保護を有効にします。ユーザープールを消すと、利用者は全員、登録からやり直しになります

## 片付け

<!-- section: 06.cleanup -->

```bash
vp run app:unpublish --yes
vp run app:infra:destroy
```

先に `app:unpublish` でバケットを空にします。`app:infra:destroy` で、ユーザープール、テーブル、関数、API、ディストリビューション、バケットが消えます。利用者もノートもすべて消えて、元には戻せません。

利用者だけを消すなら、`vp run app:user:delete you@example.com` を実行します。その利用者のノートはテーブルに残ります。

残るのは、cdkd の bootstrap で作った保存場所（02章）と、そこに置かれたデプロイ用のファイルだけです。

::: details この章の検証メモ

**手元で確かめたこと。** API のテスト（認証、認可、監査ログ）、呼び出し元の読み取りのテスト、開発用サインインのテスト、PKCE の一時保存のテスト、インフラのアサーション、型検査、SPA のビルド、synth を実行しました。また、`dev:app:api` と `dev:app:web` を起動し、ブラウザを自動操作して次のことを確かめました。サインインできること、ノートを作成できること、別の利用者からの取得が 404 になること、トークンなしが 401 になること、競合が表示されて「自分の入力で保存し直す」が働くこと、再読み込み後にサインインを求められることです。一覧が本文を返さないこと、1 ページが 20 件で止まること、いちばん大きい題名を並べても 20 KiB を超えないことも、API のテストで固定しました。この変更のあと、ブラウザでの確認はやり直していません。SPA について確かめたのは、型検査とビルドだけです。今回足した上限は、テストで確かめました。利用者ごとに 101 件目のノートが 409 になり、ほかの利用者には影響せず、消せば空きが戻ること（`composeApp` を通した場合も）と、テンプレートのステージにスロットリングが、テーブルにリクエストユニットの上限があることです。アプリを、`Request` を受けて `Response` を返す関数に書き直したあとは、テスト、型検査、SPA の型検査と lint とビルドをやり直しました。そのうえで `dev:app:api` と同じ入口を起動し、`curl` で次のことを確かめました。開発用サインインでトークンを受け取れること、ノートの作成と一覧、別の利用者の一覧が空であること、トークンなしが CORS のヘッダー付きの 401 になること、プリフライトが 204 になることです。SPA の開発サーバーは、ページと `config.json` を返すところまでを見ました。このときも、ブラウザでの確認はやり直していません。Lambda の入口については、API Gateway のイベントを通したときに、検証済みのクレームだけを読み、`Authorization` ヘッダーを信用しないことをテストにしました。このイベントは手で組み立てたもので、実際の API Gateway が渡したものではありません。

**まだ確かめていないこと。** Cognito でのサインインは、一度も実行していません。`web/src/auth/cognito.ts`（認可コードと PKCE の往復、トークンの交換）は、型検査を通っただけで、実際のユーザープールに対して動かしていません。この章でもっとも重要な未検証の部分です。`app:infra:deploy`、`app:user:create`、`app:publish`、`app:smoke:web`、`app:smoke:api`、`app:infra:drift`、`app:unpublish`、`app:infra:destroy` も実行していません。したがって、次のことも実環境では確かめていません。JWT オーソライザーが ID トークンと不正なトークンを拒否すること、Cognito のトークンエンドポイントをブラウザから直接呼べること（CORS）、`config.json` に書き出す `Issuer` と `AuthDomain` の形が oauth4webapi の検証に合うことです。上限についても同じで、次のことを確かめていません。cdkd 0.296.28 がステージの `DefaultRouteSettings` とテーブルの `OnDemandThroughput` を反映するかどうか、スロットリングが API 全体で数えられるのかルートごとなのか、429 や、オーソライザーが断ったリクエストに料金がかかるかどうか、ノートを数える条件付きの更新が実際の DynamoDB で通ることです。「叩かれたら」の金額は、単価と仮定からの計算です。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 契約に呼び出し元を足す | `examples/06-auth/api/src/contract.ts` | `test:unit` |
| 呼び出し元を確かめる | `examples/06-auth/api/src/identity.ts`、`api/src/lambda.ts`、`api/src/app.ts`、`api/test/identity.test.ts` | `test:unit` |
| 自分のノートにしか届かない | `examples/06-auth/api/src/app.ts`、`api/test/app.test.ts`、`examples/05-dynamodb/src/notes.ts` | `test:unit` |
| 手元で 2 人の利用者として動かす | `examples/06-auth/api/src/dev.ts`、`api/src/local-auth.ts`、`api/test/local-auth.test.ts`、`api/src/compose.ts`、`web/src/auth/local.ts`、`web/src/config.ts`、`web/public/config.json`、`.env.example` | `dev:app:api`、`dev:app:web` |
| SPA からサインインする | `examples/06-auth/web/src/auth/`、`web/src/App.vue`、`web/src/router/route.ts`、`api/src/client.ts` | `test:unit`、`typecheck:app:web`、`lint:app:web`、`build:app:web` |
| AWS にのせる準備 | `examples/06-auth/infra/lib/notes-app-stack.ts`、`infra/bin/app.ts`、`infra/functions/spa-fallback.js`、`infra/test/notes-app-stack.test.ts`、`cdk.json` | `app:infra:synth`、`test:unit` |
| デプロイする | `examples/06-auth/scripts/write-config.ts`、`scripts/user.ts`、`scripts/smoke.ts`、`tools/src/site/`、`tools/src/infra/` | `app:infra:diff`、`app:infra:deploy`、`app:user:create`、`app:publish`、`app:smoke:web`、`app:smoke:api`、`app:infra:drift` |
| 片付け | `tools/src/site/unpublish.ts`、`examples/06-auth/scripts/user.ts` | `app:unpublish`、`app:infra:destroy`、`app:user:delete` |
| 料金 | `data/pricing/` | `test:unit` |

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
