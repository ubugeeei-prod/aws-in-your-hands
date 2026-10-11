---
title: "06 ログインを足す: Cognito と認可"
revision: 1
---

# 06 ログインを足す: Cognito と認可

## この章の成果

- SPA からサインインでき、パスワードはこのアプリのコードを一度も通らない
- API は、誰からの呼び出しかを確かめられないリクエストを、関数を起動する前に拒否する
- サインインした利用者は、自分のノートだけを読み書きできる。他人のノートの ID を知っていても届かない
- 03章の SPA と 05章の API が、1 つのアプリとしてつながる
- 手元では、Cognito なしで 2 人の利用者としてアプリを動かせる

前提は [03章](/ja/chapters/03-spa.md)と [05章](/ja/chapters/05-dynamodb.md)です。サンプルは `examples/06-auth/` にあります。ノートの保存と楽観ロックは 05章のコードをそのまま使い、この章では認証と認可で変わる部分だけを書きます。

## 構成

<!-- section: 06.architecture -->

```text
Browser (SPA from CloudFront + S3)
  |  1. redirect to sign in                      2. password typed here, not in the SPA
  +-------------------------------------------> Cognito managed login (user pool domain)
  |  3. redirect back with ?code=...&state=...
  |  4. POST /oauth2/token  (code + PKCE code_verifier)  ->  access token
  |
  |  5. GET /notes   Authorization: Bearer <access token>
  v
API Gateway HTTP API
  |  JWT authorizer: signature, issuer, expiry, client, scope
  |  fails -> 401/403 here; Lambda is not invoked
  v
Lambda function
  |  reads the verified claims from the event; owner = claims.sub
  v
DynamoDB table   pk = OWNER#<sub>   sk = NOTE#<note id>
```

登場するものを整理します。

- **user pool** は、Amazon Cognito が持つ利用者の名簿です。パスワードの検証と token の発行を行います。
- **managed login** は、Cognito が配信するサインイン画面です。あなたのアプリとは別のドメインで動きます。
- **JWT authorizer** は、API Gateway HTTP API の機能です。リクエストに付いた token を検証し、通らなければ関数を呼びません。

### 2 つの問いを分ける

この章は、次の 2 つを別のものとして扱います。

| | 問い | この章で答える場所 |
| --- | --- | --- |
| 認証（authentication） | この呼び出しは誰からか | Cognito と、API Gateway の JWT authorizer |
| 認可（authorization） | その人は、このノートを触ってよいか | Lambda の中のアプリのコードと、table の key |

サインインしていることは、どのノートでも触ってよいことを意味しません。認証だけを足して認可を忘れると、「サインインさえすれば、ID を知っている他人のノートを読める」API ができます。

### なぜこの構成か

パスワードを自分で保存し、照合し、再設定の手順を作ることもできます。この本はそれをしません。漏れたときの被害が大きく、正しく作るための細部が多いからです。Cognito に任せると、このアプリが扱うのは「検証済みの token」だけになります。

Amplify は使いません。Cognito の user pool は、OAuth 2.0 と OpenID Connect（OIDC）という標準の手順で使えます。この章の SPA は、汎用の OAuth ライブラリ（oauth4webapi）で標準の endpoint を呼びます。Cognito を別の OIDC 対応のサービスに替えても、SPA のコードの大半は変わりません。

SPA と API は別の origin のままにし、token を `Authorization` ヘッダーで送ります。cookie は使いません。もう 1 つのやり方は、サーバー側（BFF）が token を持ち、ブラウザには cookie だけを渡すものです。ブラウザの JavaScript から token が見えなくなる利点があります。それは 09章（planned）で扱います。

## 用語を最小限で

<!-- section: 06.terms -->

| 用語 | この章での意味 |
| --- | --- |
| access token | API を呼ぶための token。この章で API に送るのはこれ |
| ID token | サインインした事実と利用者の属性を、アプリ自身に伝える token。API には送らない |
| refresh token | 新しい access token をもらうための token。この章の SPA は保持しない |
| authorization code | サインイン後に SPA が受け取る、短命の引換券。token endpoint で token と交換する |
| PKCE | 引換券を横取りされても交換できないようにする仕組み |
| scope | token に付く、許可の範囲を表す文字列 |
| `sub` | user pool が利用者ごとに発行する、変わらない識別子 |

access token と ID token は、どちらも JWT という形式で、同じ user pool が署名します。見た目では区別がつきません。この点は、あとで API の設定に効いてきます。

## 契約に「誰か」を足す

<!-- section: 06.contract -->

ノートの形は 05章のままです。足すのは 2 つです。

<<< @/examples/06-auth/api/src/contract.ts{me}

<<< @/examples/06-auth/api/src/contract.ts{error}

`unauthenticated`（401）は、「誰からの呼び出しか分からない」という意味です。

ノートについて「権限がない」（403）を表すエラーは、意図的に作っていません。他人のノートを指定したときの答えは、存在しないノートを指定したときと同じ `not_found` にします。403 を返すと、「その ID のノートは存在する」ことを教えてしまうからです。

## 誰からの呼び出しかを受け取る

<!-- section: 06.identity -->

アプリは、「呼び出したのは誰か」を 1 つの関数として受け取ります。

<<< @/examples/06-auth/api/src/identity.ts{identity}

実装は 2 つあります。AWS 上では API Gateway が検証した結果を読み、手元では開発用の token を検証します。アプリの本体は、どちらが使われているかを知りません。

### AWS 上: API Gateway が検証した claims を読む

<<< @/examples/06-auth/api/src/identity.ts{api-gateway}

関数が動く時点で、API Gateway は token の署名、発行者、期限、発行先の client を確かめ終えています。token の中身（claims）は、イベントの `requestContext.authorizer.jwt.claims` に入っています。関数は署名を検証しません。検証済みの結果を読むだけです。

それでも、アプリの側で 2 つ確かめます。

- **`token_use` が `access` であること。** ID token も同じ user pool が署名しているので、署名と発行者の検証は通ります。API に送ってよいのは access token だけです。
- **`client_id` がこのアプリの client であること。** 同じ user pool に別のアプリの client を足したとき、そちらに発行された token でこの API を呼べてはいけません。

イベントに authorizer の情報がまったく無い場合は、「誰でもない」として扱います。authorizer を付け忘れた route があっても、それが「誰でも通す」にならないようにするためです。

<<< @/examples/06-auth/api/src/lambda.ts{handler}

Lambda の入口は、`Authorization` ヘッダーを読みません。本人確認の唯一の出どころは、API Gateway が検証した claims です。

### 認証を必須にする

<<< @/examples/06-auth/api/src/app.ts{guard}

`/health` だけが、この middleware より前にあります。それ以降の route は、すべて identity が無ければ 401 を返します。新しい route をこの下に足せば、書き忘れようがなく認証が必須になります。

API Gateway と Lambda の両方で確かめているのは重複に見えますが、役割が違います。API Gateway は「正しい token か」を見て、不正なリクエストで関数が起動するのを防ぎます。そのリクエストに、関数の料金はかかりません。アプリは「その token はこの用途のものか」を見ます。

## 自分のノートだけに届くようにする

<!-- section: 06.authorization -->

<<< @/examples/06-auth/api/src/app.ts{routes}

認可のためのコードは、ほとんどありません。「この利用者はこのノートを触ってよいか」を確かめる if 文は、どこにもありません。代わりに、次の 2 つの決まりがあります。

1. service に渡す持ち主は、**常に** token の `sub` である。path、query、body からは決して取らない
2. ノートは持ち主の下に保存されている（05章の `pk = OWNER#<持ち主>`）

この 2 つから、他人のノートは「見つからない」ことになります。Bob が Alice のノートの ID を指定して `GET /notes/<id>` を呼ぶと、アプリは `OWNER#bob` の下でその ID を探します。そこには無いので、404 です。

確認を 1 か所ずつ書く方式（「ノートを読んでから、持ち主が一致するか比べる」）は、新しい route を足すたびに書き忘れる機会があります。この方式には、忘れる対象がありません。05章で、まだ利用者が 1 人しかいないうちから key に持ち主を入れておいたのは、このためです。

守っている invariant は次の 1 文です。

**リクエストが読み書きできるのは、その token の `sub` を持ち主とするノートだけである。**

テストは、これを壊そうとします。

- Bob の一覧に Alice のノートが出ない
- Bob が Alice のノートの ID を指定すると、存在しない ID と同じ 404 が返る
- Bob は、ID と version を知っていても、Alice のノートを更新も削除もできない
- Bob が query、ヘッダー、body のすべてに `owner: alice` と書いても、ノートは Bob の下に作られる

`sub` は、メールアドレスではありません。メールアドレスは変更でき、別の人に再利用されることもあります。`sub` は user pool が発行する、変わらない識別子です。公式ドキュメントも、利用者を識別するには `sub` を使うよう勧めています。

### ログに残すもの

誰がどの操作をしたかを、リクエストのログに `sub` として残します。token そのものは、決してログに書きません。access token がログから読めれば、それを見られる人は、期限が切れるまでその利用者になりすませるからです。テストは、ログに token が含まれないことを確かめます。

## 手元で 2 人として動かす

<!-- section: 06.local -->

`examples/06-auth/.env.example` を、同じディレクトリに `.env` としてコピーします。

<<< @/examples/06-auth/.env.example

ターミナルを 2 つ使います。

```bash
vp run dev:app:api
vp run dev:app:web
```

<http://localhost:5173> を開き、利用者名（既定は `alice`）を入れてサインインします。ノートを作り、別のブラウザか private window で `bob` としてサインインすると、Bob の一覧は空です。同じノートを 2 つのタブで開いて両方で保存すると、後から保存したタブに、保存済みの内容と自分の入力の両方が表示されます。

Docker も、AWS の認証情報も、user pool も要りません。

### 開発用のサインイン

手元には Cognito がないので、代わりを用意します。

<<< @/examples/06-auth/api/src/local-auth.ts

<<< @/examples/06-auth/api/src/dev.ts{dev}

`POST /local/token` は、利用者名を送ると、その利用者の token を無条件に返します。パスワードはありません。これは、手元でアプリを 2 人として動かすための道具です。

これがデプロイに混ざらないことは、仕組みで保証しています。

- この endpoint と開発用の検証は、`dev.ts` と `local-auth.ts` にだけあります。Lambda の入口（`lambda.ts`）は、どちらも import しません。bundle に入りません
- 開発用の token は共有の秘密で署名します（HS256）。API Gateway の JWT authorizer が受け付けるのは RSA 系の署名だけなので、仮にこの token をデプロイした API に送っても、通りません

**これは Cognito の模擬ではありません。** 再現していないものを挙げます。

| 再現しないもの | 実環境での意味 |
| --- | --- |
| managed login とパスワード | 実際のサインイン画面、パスワードの規則、初回のパスワード変更 |
| authorization code と PKCE の往復 | SPA の Cognito 用のコード（`web/src/auth/cognito.ts`）は、手元では一度も実行されない |
| API Gateway の JWT authorizer | 不正な token が、関数に届く前に拒否されること。そのときの応答の形 |
| token の期限、更新、失効 | 1 時間後に何が起きるか |

とくに 2 つ目は大事です。手元で動いているのは「サインイン後のアプリ」であって、「Cognito でのサインイン」ではありません。

### SPA は実行時に設定を読む

<<< @/examples/06-auth/web/src/config.ts{config}

SPA は、起動時に `/config.json` を読んで、API の場所とサインインの方法を知ります。`web/public/config.json` は手元用です。デプロイするときは、stack の output から作った `config.json` に置き換えます。SPA は一度ビルドすれば、どのデプロイにも向けられます。

この設定に秘密はありません。client ID もサインイン用のドメインも、ページを読み込んだ人なら誰でも見られます。ブラウザで動くアプリは秘密を持てないので、そういうアプリを public client と呼びます。

## SPA からサインインする

<!-- section: 06.pkce -->

SPA がサインインに使うのは、authorization code grant と PKCE の組み合わせです。手順は構成図の 1 から 4 です。

<<< @/examples/06-auth/web/src/auth/provider.ts{provider}

<<< @/examples/06-auth/web/src/auth/cognito.ts{cognito}

`signIn` は、2 つの乱数を作ります。

- **state** は、戻ってきた redirect が、このタブが送った依頼への答えであることを確かめるためのものです。攻撃者が自分のサインインで得た code を含むリンクを踏ませても、state が合わないので受け付けません。
- **code verifier** は PKCE の秘密です。サインイン画面へ送るのは、その hash（code challenge）だけです。code を token と交換するとき、元の値を示します。途中で code を盗み見た者は、元の値を知らないので交換できません。

public client は client secret を持てません。PKCE が、その代わりをします。Cognito が対応する challenge の方式は `S256` だけです。

サインイン画面へ移動すると、SPA のページは破棄されます。戻ってくるまでの間、2 つの値はタブごとの sessionStorage に置きます。

<<< @/examples/06-auth/web/src/auth/pending.ts{pending}

取り出せるのは 1 回だけです。state が合わないとき、古すぎるときは、何も返しません。テストは、偽の state、同じ callback URL の再利用、10 分を過ぎた依頼を、それぞれ拒否することを確かめます。

Cognito には、code を使わずに token を直接 URL に載せて返す implicit grant もあります。公式ドキュメントは、token を利用者の側に露出させるので安全性が低いと説明しています。この章の client は implicit grant を無効にしています。

### token をどこに置くか

SPA は、access token をメモリの変数にだけ持ちます。localStorage にも cookie にも入れません。

| 置き場所 | 再読み込み後 | ページに入り込んだスクリプトから |
| --- | --- | --- |
| メモリ（この章） | 消える。もう一度サインインする | ページが開いている間は読める |
| localStorage | 残る | いつでも読める。タブを閉じた後も残る |
| サーバー側の session と cookie（09章の予定） | 残る | 読めない（`HttpOnly` の場合） |

再読み込みのたびにサインインし直すのは不便です。ただし、managed login 自身が 1 時間有効の session cookie を持つので、その間はパスワードを打ち直さずに戻ってこられます。refresh token を SPA に持たせれば、もっと長く保てますが、長く使える token をブラウザに置くことになります。この章は、短い側に倒しています。

どの方式でも、ページに悪意のあるスクリプトが入り込めば（XSS）、そのページが開いている間、利用者として API を呼べます。token の置き場所は被害の範囲を変えますが、XSS そのものの対策の代わりにはなりません。

型付きの client は、リクエストのたびに token を取りに来ます。

<<< @/examples/06-auth/api/src/client.ts{client}

API が 401 を返したら、SPA は持っている token を捨て、サインインし直すよう促します。

### 競合を利用者に見せる

05章で、古い version からの更新は 409 で拒否され、保存済みのノートが `current` として返るようにしました。この章の画面は、それを利用者に見せます。自分の入力は欄に残したまま、保存済みの内容を並べて表示し、「自分の入力で保存し直す」か「保存済みの内容を採る」かを選ばせます。どちらを残すかは、アプリが勝手に決めません。

## インフラを定義する

<!-- section: 06.infra -->

この章の stack（`AihNotesApp`）は、アプリ全体を 1 つにまとめたものです。03章の SPA 配信（bucket、distribution、fallback の関数）と、05章の table と API に、user pool と authorizer を足します。

### user pool

<<< @/examples/06-auth/infra/lib/notes-app-stack.ts{user-pool}

`selfSignUpEnabled` は `false` です。誰でも登録できる設定で練習用のアプリを公開すると、見知らぬ人が利用者になれます。登録の確認メールも、あなたのアカウントから送られます。利用者は、後で出てくるタスクで作ります。

`removalPolicy` は `DESTROY` です。stack を消すと、user pool と中の利用者がすべて消えます。

### app client

<<< @/examples/06-auth/infra/lib/notes-app-stack.ts{client}

- `generateSecret: false`。public client です
- 許可する flow は authorization code だけ。implicit は無効
- `authFlows` はすべて `false`。パスワードを API に直接送ってサインインする経路を閉じ、入口を managed login への redirect だけにします
- callback URL は 2 つだけ。デプロイした SPA の `/callback` と、手元の開発サーバーの `/callback`。Cognito は、登録していない URL へは code を返しません
- access token の寿命は 1 時間

`enableTokenRevocation` は、利用者の token を失効させられるようにします。ただし、この設定の効き目には範囲があります。これは次の節で説明します。

### JWT authorizer

<<< @/examples/06-auth/infra/lib/notes-app-stack.ts{authorizer}

公式ドキュメントによると、JWT authorizer は次を確かめます。

1. token の署名。発行者の公開鍵で検証する。対応するのは RSA 系の方式だけ
2. `iss` が設定した発行者と一致すること
3. `aud`、それが無ければ `client_id` が、設定した audience のどれかと一致すること
4. `exp`、`nbf`、`iat` が現在時刻と矛盾しないこと
5. route に scope を設定していれば、token がそのどれかを持つこと

どれかに失敗すると、API Gateway がリクエストを拒否します。関数は起動しません。

`authorizationScopes: ["openid"]` を付けているのは、ID token を入口で落とすためです。同じドキュメントは、access token と ID token を区別する標準の方法はなく、ID token を API の認可に使うのでなければ route に scope を要求するよう勧めています。ID token は scope の claim を持たないので、ここで拒否されます。アプリの側の `token_use` の検査は、その二重の守りです。

テストは、template に対して次を確かめます。

- `/health` 以外のすべての route に JWT authorizer が付いている
- 保護された route がすべて scope を要求している
- client が secret を持たず、flow が authorization code だけである
- CORS で許可する origin が 2 つだけで、`*` を含まない

最初の検査は、route を足して authorizer を付け忘れると落ちます。

## token の期限と失効

<!-- section: 06.revocation -->

access token は、発行された後は誰にも問い合わせずに検証できます。それが JWT の利点で、同時に限界でもあります。

```text
time   event                                            access token (exp = t0 + 1h)
t0     Alice signs in                                   issued
t0+10m admin disables Alice / revokes her tokens        Cognito's own APIs now refuse it
t0+11m Alice's browser calls GET /notes                 API Gateway: signature ok, not expired -> 200
t0+1h  token expires                                    API Gateway -> 401
```

公式ドキュメントはこう書いています。失効させた token は、token を必要とする Cognito の API では使えなくなる。しかし、署名と期限を検証するだけの JWT ライブラリでは、引き続き有効と判定される。API Gateway の JWT authorizer が確かめるのは、前の節の 5 項目です。失効したかどうかを Cognito に問い合わせる項目は、そこにありません。

つまり、**利用者を無効にしても、発行済みの access token は期限が切れるまでこの API を通ります。** 最長で、access token の寿命の分（この章では 1 時間）です。これは、状態を複数の場所が別々に持つときに起きる、分散システムの典型的なずれです。「アカウントは無効」という事実は Cognito にあり、「この token は有効」という判断は API Gateway が手元の情報だけで行います。

対処は 3 つあり、費用と引き換えです。

| 対処 | 得るもの | 払うもの |
| --- | --- | --- |
| access token の寿命を短くする（最短 5 分） | 失効が効くまでの時間が短くなる | token の更新が増える。managed login を使う場合、公式ドキュメントは 1 時間未満を勧めていない |
| アプリが、リクエストごとに失効の一覧を引く | すぐ効く | 全リクエストに読み取りが 1 回増える。JWT の「問い合わせない」利点を手放す |
| 受け入れる | 何も足さない | 最長 1 時間、無効にした利用者が通る |

この章は 3 つ目です。ノートアプリで、利用者を無効にしてから 1 時間以内に読まれて困る場面は、多くないと判断しました。扱うものが変われば、判断も変わります。

API Gateway は、発行者の公開鍵も最長 2 時間 cache します。user pool の鍵が替わるときの猶予として、覚えておいてください。

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

`app:infra:deploy` が、distribution、bucket、table、関数、API、user pool をまとめて作ります。

`app:user:create` は、利用者を 1 人作ります。Cognito が、そのアドレスに仮のパスワードをメールで送ります。初回のサインインで、利用者自身がパスワードを決めます。このタスクは、パスワードを見ることも表示することもありません。

`app:publish` は、SPA をビルドし、stack の output から `config.json` を書き出して、bucket に置きます。公開の順序と cache の方針は 03章と同じ実装です。

出力された `DistributionDomainName` の URL を開くと、「Sign in」のボタンが出ます。押すと Cognito のサインイン画面へ移動し、サインインすると SPA に戻ります。

`app:smoke:api` は、人がサインインしなくても確かめられることを確かめます。token なしのリクエストと、でたらめな token のリクエストが拒否されることです。サインイン後の経路は、環境変数 `AIH_ACCESS_TOKEN` に access token を入れたときだけ実行します。入れなかった場合、タスクは「サインイン後の経路は確かめていない」と表示します。

手元の SPA を、デプロイした API と user pool に向けることもできます。`http://localhost:5173/callback` を callback URL に、`http://localhost:5173` を CORS の許可する origin に、あらかじめ登録してあります。`web/public/config.json` を、デプロイ先の値に書き換えて `vp run dev:app:web` を起動します。本番のアプリでは、手元の origin を許可したままにしないでください。

drift の検査は、これまでの章と同じです。

```bash
vp run app:infra:drift
```

この stack には、固定した版の cdkd が専用の実装を持たない種類が 3 つあります。`AWS::CloudFront::Function`、`AWS::Cognito::UserPoolClient`、`AWS::Cognito::UserPoolDomain` です。Cloud Control API 経由で扱われます。実際に作成と読み戻しができるかは、確かめていません。

## Workers に慣れた人へ

Cloudflare で同じことをするなら、Cloudflare Access を前に置くか、Worker の中で JWT を検証するライブラリを使うことが多いでしょう。違いが出るのは、検証をどこで行うかです。この章では、検証は関数の手前（API Gateway）で済んでいて、関数は結果を読むだけです。Worker の中で検証する方式では、検証のコードも、公開鍵の取得と cache も、あなたのコードの責任になります。どちらにも利点があります。手前で済ませる方式は、コードが少なく、不正なリクエストで関数が動きません。その代わり、検証の規則は API Gateway が提供する範囲に限られます。

この比較は一般的な構成についての説明で、Cloudflare 側の一次情報は確認していません。

## 料金

金額は USD、東京リージョン、税別です。計算の入力と単価は[料金の計算](/ja/reference/pricing.md)にあります。

**Cognito。** user pool は、月間アクティブユーザー（MAU）の数に対して課金されます。その月に、サインインや token の更新など何らかの操作があった利用者が 1 人と数えられます。新しい user pool の既定のプランは Essentials で、東京リージョンでは 1 MAU あたり USD 0.015 です。料金ページによると、Essentials と Lite には、アカウント（または organization）ごとに月 10,000 MAU の無料枠があり、12 か月で失効しません。

利用者が 100 人なら、定価で月 USD 1.50、無料枠の範囲内なら 0 です。

メールと SMS は別料金です。この章の構成では、利用者を作るときの仮パスワードのメールを、Cognito の既定の送信機能で送ります。その上限と料金は確認していません。利用者が多いアプリでは Amazon SES を使います（15章の予定）。

**JWT authorizer。** 東京リージョンの API Gateway の価格表に、authorizer の項目はありません。拒否されたリクエストでは関数が起動しないので、Lambda の料金はかかりません。そのリクエストが API Gateway のリクエスト料金に数えられるかどうかは、確認していません。

**アプリ全体。** 05章の月 100 万リクエストの例に、100 MAU を足した計算です。

| 対象 | 定価 | 毎月の無料枠の適用後 |
| --- | --- | --- |
| 05章の合計（API Gateway、Lambda、ログ、DynamoDB） | 2.41 | 1.64 |
| Cognito（Essentials、100 MAU） | 1.50 | 0 |
| 小計 | **3.91** | **1.64** |

SPA の配信（CloudFront と S3）は、03章の計算を参照してください。

**使われていないとき。** 利用者が誰もサインインしない月は、Cognito の料金は 0 です。残るのは、table と bucket の保存量だけです。

**消した後。** 何も残りません。user pool も、中の利用者も、stack と一緒に消えます。

## うまくいかないとき

| 症状 | 確かめること |
| --- | --- |
| `dev:app:api` が `LOCAL_AUTH_SECRET` と言って止まる | `examples/06-auth/.env` があるか。値が 32 文字以上か |
| 手元の SPA が「The app could not start」と出る | `dev:app:api` が動いているか。`web/public/config.json` の `apiUrl` |
| サインイン画面が、redirect 先の不一致を示すエラーを出す | SPA の origin と `/callback` が、client の callback URL と完全に一致しているか。末尾の `/` の有無も区別される |
| サインイン後、「does not belong to a sign-in started in this tab」と出る | サインインを始めたタブと、戻ってきたタブが違う。あるいは 10 分以上かかった。もう一度サインインする |
| デプロイした API が、サインイン済みでも 401 を返す | SPA が送っているのが access token か。`config.json` の `clientId` が、stack の `UserPoolClientId` と一致しているか |
| 403 が返る | token に `openid` の scope が無い。サインインの依頼で `scope=openid` を送っているか |
| ブラウザのコンソールに CORS のエラーが出る | 401 や 403 を API Gateway が返すとき、応答に CORS のヘッダーが付かず、ブラウザが CORS のエラーとして表示することがある。まず `curl` で状態コードを確かめる |
| 利用者を無効にしたのに、まだ API を呼べる | 「token の期限と失効」の節のとおり。access token の期限まで通る |

API Gateway が返す 401 と 403 の本文は、この本のエラーの形（`error.code`）ではありません。型付きの client は、それを `unauthenticated` として扱います。

## 本番に進めるなら

- **MFA を有効にする。** この章の user pool は、パスワードだけです。
- **手元の origin を外す。** callback URL と CORS から `http://localhost:5173` を消します。開発用には別の stack を使います。
- **独自ドメインを使う。** サインイン画面のドメインが `...amazoncognito.com` のままでは、利用者にとって本物かどうか見分けにくくなります。
- **メールを SES から送る。** Cognito の既定の送信は、少量向けです（15章の予定）。
- **token の寿命と失効の方針を決める。** 前の節の表から選びます。
- **Content-Security-Policy を設定する。** XSS の被害を減らします。03章で述べたとおり、管理ポリシーには含まれません。
- **利用者の削除とデータの削除をつなぐ。** 利用者を消しても、その `sub` の下のノートは table に残ります。消す処理が要ります。
- **user pool を守る。** `removalPolicy` を `RETAIN` にし、削除保護を有効にします。user pool を消すと、利用者は全員、登録からやり直しになります。

## 片付け

<!-- section: 06.cleanup -->

```bash
vp run app:unpublish --yes
vp run app:infra:destroy
```

先に bucket を空にします。`app:infra:destroy` で、user pool、table、関数、API、distribution、bucket が消えます。**利用者とノートはすべて消え、戻せません。**

利用者だけを消すなら、`vp run app:user:delete you@example.com` です。その利用者のノートは table に残ります。

残るのは、cdkd の bootstrap で作った保存場所（02章）と、そこに置かれたデプロイ用のファイルだけです。

## この章の検証状況

- API のテスト（認証、認可、監査ログ）、identity の読み取りのテスト、開発用サインインのテスト、PKCE の一時保存のテスト、インフラの assertion、型検査、SPA のビルド、synth は、**ローカル検証済み**です。
- 手元で `dev:app:api` と `dev:app:web` を起動し、ブラウザを自動操作して次を確かめました。サインイン、ノートの作成、別の利用者からの取得が 404 になること、token なしが 401 になること、競合の表示と「自分の入力で保存し直す」、再読み込み後にサインインを求められること。これも**ローカル検証済み**です。
- **Cognito でのサインインは、一度も実行していません。** `web/src/auth/cognito.ts`（authorization code と PKCE の往復、token の交換）は、型検査を通っただけで、実際の user pool に対して動かしていません。この章でもっとも重要な未検証の部分です。
- `app:infra:deploy`、`app:user:create`、`app:publish`、`app:smoke:web`、`app:smoke:api`、`app:infra:drift`、`app:unpublish`、`app:infra:destroy` は実行していません。**未検証**です。
- したがって、次も実環境では確かめていません。JWT authorizer が ID token と不正な token を拒否すること。Cognito の token endpoint をブラウザから直接呼べること（CORS）。`config.json` に書き出す `Issuer` と `AuthDomain` の形が、oauth4webapi の検証に合うこと。

## この章のソース対応

| 節 | 対応するファイル | タスク |
| --- | --- | --- |
| 契約に「誰か」を足す | `examples/06-auth/api/src/contract.ts` | `test:unit` |
| 誰からの呼び出しかを受け取る | `examples/06-auth/api/src/identity.ts`、`api/src/lambda.ts`、`api/src/app.ts`、`api/test/identity.test.ts` | `test:unit` |
| 自分のノートだけに届くようにする | `examples/06-auth/api/src/app.ts`、`api/test/app.test.ts`、`examples/05-dynamodb/src/notes.ts` | `test:unit` |
| 手元で 2 人として動かす | `examples/06-auth/api/src/dev.ts`、`api/src/local-auth.ts`、`api/test/local-auth.test.ts`、`api/src/compose.ts`、`web/src/auth/local.ts`、`web/src/config.ts`、`web/public/config.json`、`.env.example` | `dev:app:api`、`dev:app:web` |
| SPA からサインインする | `examples/06-auth/web/src/auth/`、`web/src/App.vue`、`web/src/router/route.ts`、`api/src/client.ts` | `test:unit`、`typecheck:app:web`、`lint:app:web`、`build:app:web` |
| インフラを定義する | `examples/06-auth/infra/lib/notes-app-stack.ts`、`infra/bin/app.ts`、`infra/functions/spa-fallback.js`、`infra/test/notes-app-stack.test.ts`、`cdk.json` | `app:infra:synth`、`test:unit` |
| デプロイする | `examples/06-auth/scripts/write-config.ts`、`scripts/user.ts`、`scripts/smoke.ts`、`tools/src/site/`、`tools/src/infra/` | `app:infra:diff`、`app:infra:deploy`、`app:user:create`、`app:publish`、`app:smoke:web`、`app:smoke:api`、`app:infra:drift` |
| 片付け | `tools/src/site/unpublish.ts`、`examples/06-auth/scripts/user.ts` | `app:unpublish`、`app:infra:destroy`、`app:user:delete` |
| 料金 | `data/pricing/` | `test:unit` |

## 一次情報

- [Control access to HTTP APIs with JWT authorizers in API Gateway](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html)（確認日 2026-10-11）
- [The redirect and authorization endpoint](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html)（確認日 2026-10-11）
- [Understanding the access token](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-access-token.html)（確認日 2026-10-11）
- [Ending user sessions with token revocation](https://docs.aws.amazon.com/cognito/latest/developerguide/token-revocation.html)（確認日 2026-10-11）
- [The managed login sign-out endpoint](https://docs.aws.amazon.com/cognito/latest/developerguide/logout-endpoint.html)（確認日 2026-10-11）
- [Amazon Cognito pricing](https://aws.amazon.com/cognito/pricing/)（確認日 2026-10-11）
- AWS Price List bulk API: [Cognito](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCognito/current/ap-northeast-1/index.json)（確認日 2026-10-11）
- [oauth4webapi 3.8.8](https://www.npmjs.com/package/oauth4webapi/v/3.8.8)、[jose 6.2.12](https://www.npmjs.com/package/jose/v/6.2.12)（型定義。確認日 2026-10-11）
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)（確認日 2026-10-11）
