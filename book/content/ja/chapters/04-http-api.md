---
title: "04 HTTP API: Lambda と API Gateway HTTP API"
revision: 6
---

# 04 HTTP API: Lambda と API Gateway HTTP API

03章で SPA を公開したので、この章では API を作ります。ノートを作り、読み、消せる小さな HTTP API を書いて手元で動かし、同じコードを Lambda にのせます。Docker は使いません。手元で試すだけなら、AWS のアカウントも要りません。

この章の API には、あとの章で埋める欠けが 2 つあります。ノートはメモリに置くだけで保存しないので、実行環境が入れ替わると消えます（保存は [05章](/ja/chapters/05-dynamodb.md)で足します）。認証もないので、URL を知っている人は誰でも呼べます（認証は [06章](/ja/chapters/06-auth.md)で足します）。そのかわり、受けるリクエストは 1 秒に 10 件まで、置けるノートは 100 件まで、一覧が返すのは新しい 20 件の要約までに絞ってあります。消えて困るものや、見られて困るものは入れないでください。

前提は [02章](/ja/chapters/02-toolchain.md)だけです。コードは `examples/04-http-api/` にあります。

## 全体像

<!-- section: 04.architecture -->

```figure
caption: API Gateway はルートに合うリクエストだけを Lambda 関数に渡し、関数は CloudWatch Logs にログを書き出します。
node client: Client | curl、型付きクライアント、のちに SPA
node health: /health | GET
node notes: /notes | GET, POST
node note: /notes/{id} | GET, DELETE
node other: それ以外 | 404、Lambda は呼ばれない
node fn: Lambda 関数 | Node.js 24, arm64, 256 MB, タイムアウト 10 s
node logs: CloudWatch Logs | リクエストごとに JSON 1 行、7 日保持
edge client -> health: HTTPS
edge client -> notes
edge client -> note
edge client -> other
edge health -> fn
edge notes -> fn
edge note -> fn
edge fn -> logs: 実行ロール: 自分のロググループだけ
group api: API Gateway HTTP API (ap-northeast-1) = health, notes, note, other
```

```figure
caption: Lambda 関数の中では、Hono のアプリが NoteService を呼び、NoteService がメモリ上のリポジトリにノートを置きます。
direction: right
node hono: Hono app
node service: NoteService
node repo: InMemoryNoteRepository | 実行環境ごと
edge hono -> service
edge service -> repo
group fn: Lambda 関数 = hono, service, repo
```

使うサービスは 3 つです。API Gateway が入口で HTTPS を受け、定義しておいたルート（route）に合うリクエストだけを Lambda に渡します。Lambda はあなたのコードを動かす場所で、リクエストが来たときだけ起動し、終わると待機に戻ります。常に動いているサーバーはありません。Lambda が書き出したログは CloudWatch Logs に溜まります。

Lambda が動くのは東京リージョンの中で、CloudFront のようなエッジではありません。

### HTTP API と REST API

API Gateway にはいくつか種類があり、この章で使うのは「HTTP API」です。名前は一般的な言葉に見えますが製品名で、同じ API Gateway の「REST API」とは別の製品です。

| | HTTP API | REST API |
| --- | --- | --- |
| リクエスト料金（東京、最初の段階） | 100 万件あたり USD 1.29 | 100 万件あたり USD 4.25 |
| JWT オーソライザー | あり | なし（Cognito 用のオーソライザーと Lambda オーソライザーはある） |
| AWS WAF、API キー、リクエスト検証、キャッシュ、X-Ray | なし | あり |
| レスポンスのストリーミング | なし | あり |

公式ドキュメントは HTTP API を、機能を絞って安くしたものと説明しています。ノートの API に要るのはルートと、06章で使う JWT オーソライザー（authorizer）くらいなので、HTTP API で足ります。

API の直前に AWS WAF を置きたいときや、レスポンスをストリーミングで返したいときは、REST API を選び直します。ストリーミングできないのは HTTP API であって API Gateway 全体ではないので、2 つを分けて覚えておくと、あとで選び直すときに迷いません。

### Lambda が向かない場面

Lambda は使われていない間の料金が 0 で、ネットワークを設計しなくても API を 1 つ足せます。一方で、次のような場合には向きません。

- 1 回の処理が 30 秒を超える場合。HTTP API は Lambda のレスポンスを最大 30 秒しか待ちません（[08章](/ja/chapters/08-async.md)、[16章](/ja/chapters/16-long-jobs.md)）
- 接続を張ったままにしたい場合や、手持ちのコンテナをそのまま動かしたい場合（[12章](/ja/chapters/12-containers.md)）
- 利用者のすぐ近くで動かしたい場合（[10章](/ja/chapters/10-edge.md)）

## 契約を先に決める

<!-- section: 04.contract -->

コードを書く前に、API の入力と出力の形をスキーマ（schema）にします。

<<< @/examples/04-http-api/src/contract.ts{note}

サーバーとクライアントは、同じこの定義を使います。サーバーは届いたリクエストを、クライアントは返ってきたレスポンスを、このスキーマで検証します。TypeScript の型も、ここから `z.infer` で作ります。定義が 1 つしかないので、サーバーだけ直してクライアントを直し忘れることがありません。

一覧の形は、ノート 1 件の形とは別に決めます。

<<< @/examples/04-http-api/src/contract.ts{list}

一覧に載せるのは ID と題名と作成時刻だけで、本文は載せません。本文が要るときは `GET /notes/:id` で 1 件を取ります。件数も、新しい順に 20 件までです。本文は 1 件で 10,000 文字まで入るので、持っているノートを本文ごと全部返すと、1 回のレスポンスが数 MB になります。要約だけを 20 件までにすれば、題名をどう書いても 20 KiB を超えません。この切り詰めは `createNoteService` の `list` がしていて、スキーマを strict にしてあるので、本文が紛れ込んだレスポンスはクライアントの検証で落ちます。

21 件目より古いノートは一覧に出なくなりますが、ID がわかっていれば読めますし、消せます。一覧の続きを取る方法は、05章で足します。

エラーの形も決めておきます。

<<< @/examples/04-http-api/src/contract.ts{error}

呼ぶ側は、メッセージの文章を読み解かなくても `code` で分岐できます。`requestId` は、あとでログを探すときの手がかりになります。

## アプリを書く

<!-- section: 04.app -->

HTTP の処理には Hono を使います。Hono は Web 標準の `Request` と `Response` で動く小さなフレームワークで、同じアプリが Node.js でも Lambda でもそのまま動きます。Workers で使ったことがある人も多いと思います。

<<< @/examples/04-http-api/src/app.ts{app}

このアプリは、必要なものをすべて引数で受け取ります。時刻、ID の生成、ログの出力先、ノートの保存先がそうで、`createApp` の中では `Date.now()` にも `process.env` にも直接触りません。テストでは決まった値を、本番では本物を渡せます。

リクエストは実行時に確かめます。TypeScript の型は実行時には残っていないので、型が `CreateNote` だからといって、届いた JSON がその形をしているとは限りません。届いた JSON は `validator` がスキーマと照合し、合わなければ、どの項目が合わないかを添えて 400 を返します。

想定していない例外は、理由を外に出しません。`onError` がログに書き、呼んだ側には `requestId` だけを返します。スタックトレースをレスポンスに載せると、アプリの内部の作りを外に教えることになるからです。

ノートの保存先はインターフェースにしてあります。

<<< @/examples/04-http-api/src/notes.ts{repository}

いまの実装はただの `Map` です。`Map` はメモリの上にあるので、誰でも `POST` できる API でそのままにしておくと、入れられただけ膨らみます。そこで 100 件で打ち切り、101 件目には `NoteLimitError` を投げます。アプリの `onError` は、この例外を 409 と `quota_exceeded` にして返します。429 ではなく 409 にしたのは、待っても空きはできず、1 件消せば空くからです。

05章で保存先を DynamoDB に差し替えますが、このインターフェースはそのまま使います。

本物の時刻、乱数、環境変数に触るのは、次の 1 か所だけです。

<<< @/examples/04-http-api/src/compose.ts{compose}

## 設定は起動時に確かめる

<!-- section: 04.env -->

環境変数も、型の外から来る値です。`process.env` の型は、どの変数も `string` か `undefined` だと言っているだけなので、必要な変数が入っているかどうかは型からはわかりません。

<<< @/examples/04-http-api/src/env.ts{env}

環境変数は、起動するときに一度だけ確かめます。足りなければ、最初の呼び出しが、変数の名前を含むメッセージで失敗します。特定の条件のときだけ `undefined` を読んで壊れるより、ずっと早く原因にたどり着けます。

ここに置いているのは設定で、秘密の値ではありません。Lambda の環境変数は、コンソールで関数の設定を見られる人なら誰でも読めます。API キーのような秘密の値は環境変数に直接置かず、Secrets Manager などから実行時に取得します。この章のサンプルには秘密の値がないので、取得するコードもありません（[21章](/ja/chapters/21-security.md)で扱います）。
