---
title: "04 HTTP API: Lambda と API Gateway HTTP API"
revision: 5
---

# 04 HTTP API: Lambda と API Gateway HTTP API

SPA は公開できました。次は API です。

この章では、ノートを作って、読んで、消せる小さな HTTP API を書きます。まず手元で動かして、それから同じコードを Lambda にのせます。Docker は要りません。手元で試すぶんには AWS のアカウントも要りません。

先に 2 つだけ。この章の API は、ノートをメモリに置くだけで保存しません（保存は [05章](/ja/chapters/05-dynamodb.md)）。認証もないので、URL を知っている人は誰でも呼べます（認証は [06章](/ja/chapters/06-auth.md)）。そのかわり、受けるリクエストは 1 秒に 10 件まで、置けるノートは 100 件まで、一覧が返すのは新しい 20 件の要約までに絞ってあります。消えて困るもの、見られて困るものは入れないでくださいね。

前提は [02章](/ja/chapters/02-toolchain.md)だけです。コードは `examples/04-http-api/` にあります。

## 全体像

<!-- section: 04.architecture -->

```figure
caption: API Gateway は route に合うリクエストだけを Lambda 関数に渡し、関数は CloudWatch Logs に書き出します。
node client: Client | curl、型付き client、のちに SPA
node health: /health | GET
node notes: /notes | GET, POST
node note: /notes/{id} | GET, DELETE
node other: それ以外 | 404、Lambda は呼ばれない
node fn: Lambda 関数 | Node.js 24, arm64, 256 MB, timeout 10 s
node logs: CloudWatch Logs | リクエストごとに JSON 1 行、7 日保持
edge client -> health: HTTPS
edge client -> notes
edge client -> note
edge client -> other
edge health -> fn
edge notes -> fn
edge note -> fn
edge fn -> logs: 実行 role: 自分の log group だけ
group api: API Gateway HTTP API (ap-northeast-1) = health, notes, note, other
```

```figure
caption: Lambda 関数の中では、Hono app が NoteService を呼び、NoteService がメモリ上の repository にノートを置きます。
direction: right
node hono: Hono app
node service: NoteService
node repo: InMemoryNoteRepository | 実行環境ごと
edge hono -> service
edge service -> repo
group fn: Lambda 関数 = hono, service, repo
```

登場人物は 3 つです。

入口が **API Gateway**。HTTPS を受けて、決めておいた route に合うリクエストだけを奥へ渡します。あなたのコードが動くのは **Lambda**。リクエストが来たときだけ起動して、終わったら待機に戻ります。常駐するサーバーはありません。そして Lambda が書き出すログが **CloudWatch Logs** に溜まります。

Lambda が動くのは東京リージョンの中です。CloudFront のような edge ではありません。

### HTTP API ってどれのこと？

API Gateway には種類があって、ここで使うのは「HTTP API」です。名前がややこしいのですが、「REST API」とは別の製品だと思ってください。

| | HTTP API | REST API |
| --- | --- | --- |
| リクエスト料金（東京、最初の段階） | 100 万件あたり USD 1.29 | 100 万件あたり USD 4.25 |
| JWT authorizer | あり | なし（Cognito 用の authorizer と Lambda authorizer はある） |
| AWS WAF、API キー、リクエスト検証、cache、X-Ray | なし | あり |
| レスポンスの streaming | なし | あり |

公式ドキュメントの言い方を借りると、HTTP API は「機能を絞って安くしたもの」。ノートの API に要るのは route と、06章で使う JWT authorizer くらいなので、こちらで十分です。

逆に、API の直前に WAF を置きたい、応答を streaming したい、となったら選び直しです。「API Gateway は streaming できない」みたいに、種類を混ぜて覚えないのがコツです。

### Lambda じゃないほうがいいとき

Lambda のいいところは、使われていない間の料金が 0 なことと、ネットワークの設計なしで API を 1 つ足せること。ただ、向かない場面もあります。

- 1 回の処理が 30 秒を超える。HTTP API は Lambda の応答を最大 30 秒しか待ってくれません（[08章](/ja/chapters/08-async.md)、[16章](/ja/chapters/16-long-jobs.md)）
- つなぎっぱなしの接続が要る、あるいは手持ちのコンテナをそのまま動かしたい（[12章](/ja/chapters/12-containers.md)）
- 読者のすぐ近くで動かしたい（[10章](/ja/chapters/10-edge.md)）

## まず契約から

<!-- section: 04.contract -->

コードを書く前に、API の入力と出力の形を schema にします。

<<< @/examples/04-http-api/src/contract.ts{note}

この定義を、サーバーも client も使います。サーバーは届いたリクエストをこれで検証し、client は返ってきたレスポンスをこれで検証する。TypeScript の型も、ここから `z.infer` で作ります。定義が 1 つしかないので、「サーバーだけ直して client を直し忘れた」が起きません。

一覧の形は、ノートそのものとは別に決めます。

<<< @/examples/04-http-api/src/contract.ts{list}

一覧に載せるのは ID と題名と作成時刻だけで、本文は載せません。本文が要るときは `GET /notes/:id` で 1 件を取ります。件数も、新しい順に 20 件までです。本文は 1 件で 10,000 文字まで入るので、持っているノートを本文ごと全部返すと、1 回のレスポンスが数 MB になります。要約だけを 20 件までにすれば、題名をどう書いても 20 KiB を超えません。この切り詰めは `createNoteService` の `list` がしていて、schema を strict にしてあるので、本文が紛れ込んだレスポンスはクライアントの検証で落ちます。

21 件目より古いノートは一覧に出なくなりますが、ID がわかっていれば読めますし、消せます。一覧の続きを取る方法は、05章で足します。

エラーの形も決めておきましょう。

<<< @/examples/04-http-api/src/contract.ts{error}

呼ぶ側は、メッセージの文章を読み解かなくても `code` で分岐できます。`requestId` は、あとでログを探すときの手がかりです。

## アプリを書く

<!-- section: 04.app -->

HTTP の処理には Hono を使います。Web 標準の `Request` と `Response` で動く小さなフレームワークで、Node.js でも Lambda でも同じアプリがそのまま動きます。Workers で使ったことがある人も多いはず。

<<< @/examples/04-http-api/src/app.ts{app}

ポイントは 3 つです。

**必要なものは全部、引数でもらう。** 時刻、ID の生成、ログの出力先、ノートの保存先。`createApp` の中で `Date.now()` や `process.env` を直接触りません。テストでは決まった値を渡せて、本番では本物を渡せます。

**リクエストは実行時に確かめる。** TypeScript の型は、実行時には消えています。「型が `CreateNote` だから大丈夫」とは言えないんです。届いた JSON は `validator` が schema に通して、合わなければどの項目がまずいかを添えて 400 を返します。

**想定外の例外は、理由を外に出さない。** `onError` がログに書いて、呼んだ側には `requestId` だけを返します。スタックトレースを応答に載せると、中の作りを教えてしまうので。

ノートの保存先は interface にしてあります。

<<< @/examples/04-http-api/src/notes.ts{repository}

いまの中身はただの `Map` です。`Map` はメモリなので、誰でも `POST` できる API でそのままにしておくと、入れられただけ膨らみます。そこで 100 件で打ち切って、101 件目は `NoteLimitError` を投げます。アプリの `onError` がそれを 409 と `quota_exceeded` にして返します。待っても空かないので 429 ではなく、1 件消せば空くので 409 です。

05章で DynamoDB に差し替えますが、この interface はそのまま使います。

そして、本物の時刻や乱数や環境変数に触るのは、ここ 1 か所だけ。

<<< @/examples/04-http-api/src/compose.ts{compose}

## 設定は起動時に確かめる

<!-- section: 04.env -->

環境変数も、型の外からやってくる値です。`process.env` の型は「全部 `string` か `undefined`」。必要な変数がちゃんと入っているかは、型を見てもわかりません。

<<< @/examples/04-http-api/src/env.ts{env}

起動するときに一度だけ確かめます。足りなければ、変数の名前つきのメッセージで、最初の呼び出しがコケます。「ある条件のときだけ `undefined` を読んで壊れる」より、ずっと見つけやすいですよね。

ちなみに、ここに置いているのは設定であって、秘密ではありません。Lambda の環境変数は、コンソールで関数の設定を見られる人なら誰でも読めます。API キーのような秘密は環境変数に直接置かず、Secrets Manager などから実行時に取ってきます。この章のサンプルには秘密がないので、そのコードはこの章にはありません（[21章](/ja/chapters/21-security.md)で扱います）。
