---
title: "06 Auth: デプロイ"
---

# 06 Auth: デプロイ

## AWS にのせる準備

<!-- section: 06.infra -->

ここからは CDK です。この章の stack（`AihNotesApp`）は、アプリ全体を 1 つにまとめたものです。03章の SPA 配信（bucket、distribution、fallback の関数）と、05章の table と API に、user pool と authorizer を足します。

### user pool

<<< @/examples/06-auth/infra/lib/notes-app-stack.ts{user-pool}

`selfSignUpEnabled` は `false` です。誰でも登録できる設定のまま練習用のアプリを公開すると、見知らぬ人が利用者になれてしまいます。登録の確認メールも、あなたのアカウントから送られます。利用者は、あとで出てくるタスクで作ります。

`removalPolicy` は `DESTROY` です。stack を消すと、user pool と中の利用者がすべて消えます。

### app client

<<< @/examples/06-auth/infra/lib/notes-app-stack.ts{client}

- `generateSecret: false`。public client です
- 許可する flow は authorization code だけ。implicit は無効
- `authFlows` は、指定した 4 つ（`userSrp`、`userPassword`、`adminUserPassword`、`custom`）を `false` にしています。パスワードを API に直接送ってサインインする経路を閉じて、入口を managed login への redirect だけにします
- callback URL は 2 つだけ。デプロイした SPA の `/callback` と、手元の開発サーバーの `/callback`。Cognito は、登録していない URL へは code を返しません
- access token の寿命は 1 時間

`enableTokenRevocation` は、利用者の token を失効させられるようにする設定です。ただ、この設定の効き目には範囲があります。次の節の主役です。

### JWT authorizer

<<< @/examples/06-auth/infra/lib/notes-app-stack.ts{authorizer}

公式ドキュメントによると、JWT authorizer が確かめるのは次の 5 つです。

1. token の署名。発行者の公開鍵で検証する。対応するのは RSA 系の方式だけ
2. `iss` が設定した発行者と一致すること
3. `aud`、それが無ければ `client_id` が、設定した audience のどれかと一致すること
4. `exp`、`nbf`、`iat` が現在時刻と矛盾しないこと
5. route に scope を設定していれば、token がそのどれかを持つこと

どれかに失敗すると、API Gateway がリクエストを拒否します。関数は起動しません。

`authorizationScopes: ["openid"]` を付けているのは、ID token を入口で落とすためです。同じドキュメントは、access token と ID token を区別する標準の方法はないと言っていて、ID token を API の認可に使うのでなければ route に scope を要求するよう勧めています。ID token は scope の claim を持たないので、ここで拒否されます。アプリの側の `token_use` と `client_id` の検査は、5 と 3 に対する二重の守りというわけです。

テストは、template に対して次を確かめます。

- `/health` 以外のすべての route に JWT authorizer が付いている
- 保護された route がすべて scope を要求している
- client が secret を持たず、flow が authorization code だけである
- CORS で許可する origin が 2 つだけで、`*` を含まない

route を足して authorizer を付け忘れると、最初の検査が落ちます。

### 入口の流量を絞る

authorizer は、token のないリクエストを断ります。でも、断るだけで、遅くはしてくれません。それに `/health` は、token なしで関数まで届きます。なので、04章と同じ上限を stage に付けます。

<<< @/examples/06-auth/infra/lib/notes-app-stack.ts{throttle}

1 秒あたり 10 リクエスト、瞬間的には 20 まで。超えたぶんは、API Gateway が 429 で返して、関数は動きません。

知っておいてほしいのは、この上限が利用者ごとではないことです。誰か 1 人が使い切ると、ほかの人のリクエストも 429 になります。料金は守れますが、「1 人の使いすぎから、ほかの人を守る」ことはできません。この設定の単位は stage と route で、呼ぶ相手ごとではないからです。

table にも、05章と同じ上限（1 秒あたり読み取り 150 unit、書き込み 40 unit）を付けてあります。超えたぶんを DynamoDB は断って、課金しません。テストは、この 2 つの上限が template にあることも見ています。

## 無効にしても、しばらく通る

<!-- section: 06.revocation -->

access token は、発行された後は誰にも問い合わせずに検証できます。それが JWT のいいところで、同時に限界でもあります。

さて、利用者を無効にしたら、何が起きるでしょう。

```figure
caption: 利用者を無効にしても、発行済みの access token は期限が切れるまで API Gateway を通る
type: sequence
actor cognito: Cognito
actor alice: Alice のブラウザ
actor api: API Gateway | JWT authorizer
step alice -> cognito: t0 サインイン
step cognito --> alice: access token (exp = t0 + 1h)
note cognito: t0+10m 管理者が Alice を無効にする /
note cognito: token を失効させる
note cognito: Cognito 自身の API はもう拒否する
step alice -> api: t0+11m GET /notes
step api --> alice: 200（署名は正しい、期限内）
note alice: t0+1h token の期限が切れる
step alice -> api: GET /notes
step api --x alice: 401
```

t0+11m を見てください。通っています。

公式ドキュメントにはこう書いてあります。失効させた token は、token を必要とする Cognito の API では使えなくなる。でも、署名と期限を検証するだけの JWT ライブラリでは、引き続き有効と判定される。API Gateway の JWT authorizer が確かめるのは、前の節の 5 項目でした。失効したかどうかを Cognito に問い合わせる項目は、そこにありません。

つまり、**利用者を無効にしても、発行済みの access token は期限が切れるまでこの API を通ります。** 最長で、access token の寿命のぶん（この章では 1 時間）です。

これは、状態を複数の場所が別々に持つときに起きる、分散システムの典型的なずれです。「アカウントは無効」という事実は Cognito にあって、「この token は有効」という判断は API Gateway が手元の情報だけで下します。

対処は 3 つ。どれも何かと引き換えです。

| 対処 | 得るもの | 払うもの |
| --- | --- | --- |
| access token の寿命を短くする（最短 5 分） | 失効が効くまでの時間が短くなる | token の更新が増える。managed login を使う場合、公式ドキュメントは 1 時間未満を勧めていない |
| アプリが、リクエストごとに失効の一覧を引く | すぐ効く | 全リクエストに読み取りが 1 回増える。JWT の「問い合わせない」利点を手放す |
| 受け入れる | 何も足さない | 最長 1 時間、無効にした利用者が通る |

この章は 3 つ目にしました。ノートアプリで、利用者を無効にしてから 1 時間以内に読まれて困る場面は、多くないと判断したからです。扱うものが変われば、判断も変わります。

もう 1 つ。API Gateway は、発行者の公開鍵も最長 2 時間 cache します。user pool の鍵が替わるときの猶予として、覚えておいてください。

## デプロイする

<!-- section: 06.deploy -->

```bash
vp run app:infra:diff
vp run app:infra:deploy
vp run app:user:create you@example.com
vp run app:publish
vp run app:smoke:web
vp run app:smoke:api
```

順に見ていきます。

`app:infra:deploy` が、distribution、bucket、table、関数、API、user pool をまとめて作ります。

`app:user:create` は、利用者を 1 人作ります。Cognito が、そのアドレスに仮のパスワードをメールで送ります。初回のサインインで、利用者自身がパスワードを決めます。このタスクは、パスワードを見ることも表示することもありません。

`app:publish` は、SPA をビルドして、stack の output から `config.json` を書き出して、bucket に置きます。公開の順序と cache の方針は、03章と同じ実装です。

出力された `DistributionDomainName` の URL を開くと、「Sign in」のボタンが出ます。押すと Cognito のサインイン画面へ移動して、サインインすると SPA に戻ってきます。

`app:smoke:api` は、人がサインインしなくても確かめられることを確かめます。token なしのリクエストと、でたらめな token のリクエストが拒否されることです。サインイン後の経路は、環境変数 `AIH_ACCESS_TOKEN` に access token を入れたときだけ実行します。入れなかった場合、タスクは「サインイン後の経路は確かめていない」と表示します。

手元の SPA を、デプロイした API と user pool に向けることもできます。`http://localhost:5173/callback` を callback URL に、`http://localhost:5173` を CORS の許可する origin に、あらかじめ登録してあります。`web/public/config.json` をデプロイ先の値に書き換えて、`vp run dev:app:web` を起動してください。ただ、本番のアプリでは、手元の origin を許可したままにしないでくださいね。

drift の検査は、これまでの章と同じです。

```bash
vp run app:infra:drift
```

この stack には、固定した版の cdkd が専用の実装を持たない種類が 3 つあります。`AWS::CloudFront::Function`、`AWS::Cognito::UserPoolClient`、`AWS::Cognito::UserPoolDomain` です。これらは Cloud Control API 経由で扱われます。実際に作成と読み戻しができるかは、確かめていません。
