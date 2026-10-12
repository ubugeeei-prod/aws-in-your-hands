---
title: "06 Auth: Cognito と認可"
revision: 4
---

# 06 Auth: Cognito と認可

SPA は公開できて、ノートは table に残るようになりました。足りないのは「誰のノートか」です。

この章では、SPA にサインインを足して、サインインした人が自分のノートだけを読み書きできるようにします。03章の SPA と 05章の API も、ここでやっと 1 つのアプリとしてつながります。

パスワードは、このアプリのコードを一度も通りません。誰からの呼び出しか確かめられないリクエストは、関数が起動する前に拒否されます。他人のノートは、ID を知っていても届きません。そして手元では、Cognito なしで 2 人の利用者になってアプリを動かせます。

前提は [03章](/ja/chapters/03-spa.md)と [05章](/ja/chapters/05-dynamodb.md)です。コードは `examples/06-auth/` にあります。ノートの保存と楽観ロックは 05章のコードをそのまま使うので、この章で書くのは認証と認可で変わるところだけです。

## 全体像

<!-- section: 06.architecture -->

```figure
caption: SPA は Cognito の managed login でサインインし、code を access token に交換する
type: sequence
actor browser: Browser | CloudFront + S3 から配る SPA
actor cognito: Cognito managed login | user pool domain
step browser -> cognito: 1. サインインへ redirect
note cognito: 2. パスワードはここで入力する。SPA ではない
step cognito --> browser: 3. ?code=...&state=... を付けて redirect で戻す
step browser -> cognito: 4. POST /oauth2/token (code + PKCE code_verifier)
step cognito --> browser: access token
```

```figure
caption: API Gateway の JWT authorizer が access token を検証し、通ったリクエストだけが Lambda と table に届く
node browser: Browser | CloudFront + S3 から配る SPA
node api: API Gateway HTTP API | JWT authorizer: signature, issuer, expiry, client, scope
node fn: Lambda function | owner = claims.sub
node table: DynamoDB table | pk = OWNER#<sub>, sk = NOTE#<note id>
edge browser -> api: 5. GET /notes + access token
edge api -> fn: 検証済みの claims を event で渡す
edge fn -> table
edge api -x browser: 失敗は 401/403。Lambda は呼ばれない
mark api
```

新しい登場人物は 3 つです。

user pool は、Amazon Cognito が持つ利用者の名簿です。パスワードの検証と token の発行をしてくれます。managed login は、Cognito が配信するサインイン画面。あなたのアプリとは別のドメインで動きます。そして JWT authorizer は、API Gateway HTTP API の機能です。リクエストに付いた token を検証して、通らなければ関数を呼びません。

### 「誰？」と「触っていい？」は別の問い

この章では、2 つの問いを分けて考えます。

1 つ目は**認証**（authentication）。「この呼び出しは誰からか」です。答えるのは Cognito と、API Gateway の JWT authorizer。

2 つ目は**認可**（authorization）。「その人は、このノートを触ってよいか」です。こちらに答えるのは、Lambda の中のアプリのコードと、table の key。

サインインしているからといって、どのノートでも触ってよいわけではありませんよね。認証だけを足して認可を忘れると、「サインインさえすれば、ID を知っている他人のノートを読める」API ができあがります。

### パスワードは預かりません

パスワードを自分で保存して、照合して、再設定の手順を作る。やろうと思えばできます。でも、この本はやりません。漏れたときの被害が大きいし、正しく作るための細部が多すぎるからです。Cognito に任せれば、このアプリが扱うのは「検証済みの token」だけになります。

Amplify は使いません。Cognito の user pool は、OAuth 2.0 と OpenID Connect（OIDC）という標準の手順で使えます。この章の SPA は、汎用の OAuth ライブラリ（oauth4webapi）で標準の endpoint を呼ぶだけ。Cognito を別の OIDC 対応のサービスに替えても、SPA のコードの大半は変わりません。

SPA と API は別の origin のままにして、token を `Authorization` ヘッダーで送ります。cookie は使いません。別のやり方として、サーバー側（BFF）が token を持って、ブラウザには cookie だけを渡す方法もあります。ブラウザの JavaScript から token が見えなくなるのが利点です。そちらは [09章](/ja/chapters/09-ssr.md)で扱います。

## 言葉をそろえる

<!-- section: 06.terms -->

この章で出てくる言葉を、先に並べておきます。

- access token: API を呼ぶための token。この章で API に送るのはこれ
- ID token: サインインした事実と利用者の属性を、アプリ自身に伝える token。API には送らない
- refresh token: 新しい access token をもらうための token。token endpoint の応答には入ってくるが、この章の SPA は保存せずに捨てる
- authorization code: サインイン後に SPA が受け取る、短命の引換券。token endpoint で token と交換する
- PKCE: 引換券を横取りされても交換できないようにする仕組み
- scope: token に付く、許可の範囲を表す文字列
- `sub`: user pool が利用者ごとに発行する、変わらない識別子

access token と ID token は、どちらも JWT という形式で、同じ user pool が署名します。見た目では区別がつきません。これ、あとで API の設定に効いてきます。

## 契約に「誰か」を足す

<!-- section: 06.contract -->

ノートの形は 05章のままです。一覧が 1 ページ 20 件までの要約を返し、本文は `GET /notes/:id` で取るところも変わりません。SPA の一覧の画面は題名と更新時刻だけを出し、ノートを開いたときに本文を取りに行きます。足すのは 2 つ。

<<< @/examples/06-auth/api/src/contract.ts{me}

<<< @/examples/06-auth/api/src/contract.ts{error}

`unauthenticated`（401）は、「誰からの呼び出しか分からない」という意味です。

`quota_exceeded`（409）は、05章の repository が数えている上限です。1 人が持てるノートは 100 件まで。05章では持ち主が 1 人（`anonymous`）だったので、全体で 100 件でした。この章からは持ち主が token の `sub` になるので、利用者ごとに 100 件です。この章で書いたのは、上限を repository に渡す 1 行（`api/src/compose.ts`）と、エラーを 409 にする数行（`api/src/app.ts`）だけ。数え方は 05章のままです。

ノートについて「権限がない」（403）を表すエラーは、わざと作っていません。他人のノートを指定したときの答えは、存在しないノートを指定したときと同じ `not_found` にします。403 を返すと、「その ID のノートは存在する」と教えてしまうからです。

## 誰からの呼び出し？

<!-- section: 06.identity -->

アプリは、「呼び出したのは誰か」を 1 つの関数として受け取ります。

<<< @/examples/06-auth/api/src/identity.ts{identity}

実装は 2 つあります。AWS 上では API Gateway が検証した結果を読み、手元では開発用の token を検証します。アプリの本体は、どちらが使われているかを知りません。

### AWS では、API Gateway が確かめた結果を読む

<<< @/examples/06-auth/api/src/identity.ts{api-gateway}

関数が動く時点で、API Gateway は token の署名、発行者、期限、発行先の client を確かめ終えています。token の中身（claims）は、イベントの `requestContext.authorizer.jwt.claims` に入っています。関数は署名を検証しません。検証済みの結果を読むだけです。

それでも、アプリの側でもう一度、2 つ確かめます。どちらも API Gateway が入口で見ているものなので、**二重の守り**です。

- `token_use` が `access` であること。ID token も同じ user pool が署名しているので、署名と発行者の検証は通ります。でも、API に送ってよいのは access token だけです。入口では、あとで出てくる scope の要求が ID token を落とします
- `client_id` がこのアプリの client であること。同じ user pool に別のアプリの client を足したとき、そちらに発行された token でこの API を呼べてはいけません。入口では、authorizer が audience として同じことを確かめています

イベントに authorizer の情報がまったく無い場合は、「誰でもない」として扱います。authorizer を付け忘れた route があっても、それが「誰でも通す」にならないようにするためです。

<<< @/examples/06-auth/api/src/lambda.ts{handler}

Lambda の入口は、`Authorization` ヘッダーを読みません。本人確認の出どころは、API Gateway が検証した claims だけです。

### 認証は書き忘れようがない

<<< @/examples/06-auth/api/src/app.ts{guard}

route のうち、この middleware より前に登録しているのは `/health` だけです。それより後の route は、identity が無ければ全部 401 を返します。新しい route をこの下に足せば、書き忘れようがなく認証が必須になります。

API Gateway と Lambda の両方で確かめるのは、重複に見えますよね。主役は API Gateway です。不正なリクエストは入口で止まるので、関数は起動せず、関数の料金もかかりません。アプリの側は、入口の設定が外れていたときのための、もう 1 枚の守りです。

## 自分のノートにしか届かない

<!-- section: 06.authorization -->

<<< @/examples/06-auth/api/src/app.ts{routes}

認可のためのコードは、ほとんどありません。「この利用者はこのノートを触ってよいか」を確かめる if 文は、どこにも無いんです。かわりに、決まりが 2 つあります。

1. service に渡す持ち主は、いつも token の `sub`。path、query、body からは決して取らない
2. ノートは持ち主の下に保存されている（05章の `pk = OWNER#<持ち主>`）

この 2 つがあると、他人のノートは「見つからない」ことになります。Bob が Alice のノートの ID を指定して `GET /notes/<id>` を呼ぶと、アプリは `OWNER#bob` の下でその ID を探します。そこには無いので、404 です。（`bob` と書いたところに実際に入るのは `sub` です。手元の開発用サインインなら `local-bob`、実環境なら user pool が発行する ID になります。）

「ノートを読んでから、持ち主が一致するか比べる」という確認を 1 か所ずつ書くやり方だと、新しい route を足すたびに書き忘れるチャンスがあります。このやり方には、忘れる対象がそもそもありません。05章で、まだ利用者が 1 人しかいないうちから key に持ち主を入れておいたのは、このためです。

守っている invariant は、この 1 文です。

**リクエストが読み書きできるのは、その token の `sub` を持ち主とするノートだけである。**

テストは、これを壊しにいきます。

- Bob の一覧に Alice のノートが出ない
- Bob が Alice のノートの ID を指定すると、存在しない ID と同じ 404 が返る
- Bob は、ID と version を知っていても、Alice のノートを更新も削除もできない
- Bob が query、ヘッダー、body のすべてに `owner: alice` と書いても、ノートは Bob の下に作られる

ちなみに、`sub` はメールアドレスではありません。メールアドレスは変更できるし、別の人に再利用されることもあります。`sub` は user pool が発行する、変わらない識別子です。公式ドキュメントも、利用者を識別するには `sub` を使うよう勧めています。

### ログに残すもの

誰がどの操作をしたかは、リクエストのログに `sub` として残します。token そのものは、決してログに書きません。access token がログから読めたら、それを見られる人は、期限が切れるまでその利用者になりすませてしまいます。ログに token が含まれないことは、テストで確かめてあります。
