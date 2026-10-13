---
title: "69 Web Functions: Lambda で HTTP サーバーをそのまま動かす"
revision: 1
---

# 69 Web Functions: Lambda で HTTP サーバーをそのまま動かす

[04章](/ja/chapters/04-http-api.md)のノート API は、`Request` を受けて `Response` を返す関数でした。Lambda で動かすために、API Gateway のイベントを `Request` に直すアダプターを 1 枚はさみ、手元では同じ関数を `node:http` のサーバーに載せて動かしました。2026 年 10 月 12 日に発表された Lambda Web Functions は、この手元の形をそのまま Lambda に置く機能です。コードはポートで待ち受ける HTTP サーバーで、アダプターも API Gateway も要りません。

この章では、04章のアプリを書き換えずに Web Function として動かします。変わるのは、サーバーを起動する数行と、前提が 1 つです。これまでの Lambda では 1 つの実行環境が一度に 1 つのリクエストしか処理しませんでしたが、Web Function では 1 つの実行環境が複数のリクエストを同時に処理します。この前提で壊れるコードは[35章](/ja/chapters/35-lambda-managed-instances.md)で見たものと同じで、この章ではそれを本物のソケットの上でテストします。

同じ発表で、これまでの Lambda 関数には Lambda Event Functions という名前が付きました。変わったのは名前だけで、コードにも設定にも手を入れる必要はありません。この章では、04章の形を Event Function、新しい形を Web Function と書き分けます。

この章のスタックは、AWS にデプロイしていません。発表の翌日に公式ドキュメントと料金表を読み、手元で動かせるものをすべて動かしたところまでが、この章の検証の範囲です。確かめていないことは、[費用のページ](/ja/chapters/69-web-functions/wrap.md)の検証メモにまとめました。

前提は 04章のノート API です。コードは `examples/69-web-functions/` にあります。

## Web Function とは

<!-- section: 69.overview -->

Web Function のコードは、Node.js の HTTP サーバーです。Lambda は待ち受けるアドレスを環境変数 `AWS_LAMBDA_HTTP_ENDPOINT` で渡し、サーバーがそのアドレスで接続を受け付けるようになると、HTTPS で届いたリクエストを HTTP/1.1 で転送します。ハンドラーも、イベントも、`event.requestContext` もありません。

この章のエントリファイルは、これで全部です。

<<< @/examples/69-web-functions/src/index.ts{entry}

`composeWebApp` が返すのは 04章と同じ形の関数で、`serve` の中身は 04章の `nodeServer` です。手元では、同じファイルを Node.js でそのまま起動します。

```bash
vp run dev:webfn
```

2026-10-13 の時点で、公式ドキュメントから確かめたことを並べます。

- **リージョン。** バージニア北部、オハイオ、オレゴン、東京、アイルランドの 5 つです。この章のスタックは東京（`ap-northeast-1`）に作ります
- **ランタイム。** Node.js 24（`nodejs24.x`）だけです。ほかの言語は Event Function を使います
- **実行環境の大きさ。** どの実行環境も Arm64 の 2 vCPU とメモリ 2 GB で、変えられません。04章の関数のように 256 MB を選ぶ設定はありません
- **同時実行。** 1 つの実行環境が同時に受けるリクエストは、既定で 64、上限で 128 です
- **料金。** リクエスト数、コードが実際に使った CPU 時間、実行環境が存在するあいだのメモリ、データ転送にかかります。リクエストが来なければ実行環境は 0 になり、料金もほぼ 0 です
- **入口。** エンドポイントごとに HTTPS のドメイン名が 1 つ付きます。独自ドメインと AWS WAF を使うには、前に CloudFront を置きます

## 全体像

<!-- section: 69.picture -->

04章では、リクエストは API Gateway を通り、Lambda のイベントに変換され、アダプターが `Request` に戻していました。Web Function では、エンドポイントが受けたリクエストがそのままサーバーに届きます。

```figure
caption: エンドポイントが受けた HTTPS のリクエストは、HTTP/1.1 のままサーバーに届く
direction: right
node caller: 呼び出す側 | SigV4 で署名
node endpoint: エンドポイント | IamAuth
node env: 実行環境 | Node.js のサーバー
edge caller -> endpoint: HTTPS
edge endpoint -> env: HTTP/1.1
group fn: Web Function = endpoint, env
mark env
```

なくなるものがある一方で、新しく覚えるリソースが 2 つあります。リビジョン（revision）は、コードと設定をある時点で固めたもので、作った後は変えられません。エンドポイント（endpoint）は HTTPS の入口で、リクエストを 1 つか 2 つのリビジョンに重みを付けて振り分けます。デプロイは「新しいリビジョンを作り、エンドポイントの重みを移す」という 2 つの操作になります。

```figure
caption: エンドポイントは重みに従ってリビジョンに振り分け、リビジョンは S3 のオブジェクトの 1 つのバージョンを指す
node endpoint: エンドポイント | 重み 90 と 10
node r1: リビジョン 1
node r2: リビジョン 2
node v1: function.zip | バージョン 1
node v2: function.zip | バージョン 2
edge endpoint -> r1: 90
edge endpoint -> r2: 10
edge r1 --> v1: 固定
edge r2 --> v2: 固定
group fn: Web Function = endpoint, r1, r2
group s3: S3 バケット = v1, v2
mark endpoint
```

この章のスタックが作るのは、コードを置く S3 バケット、実行ロール、2 つのロググループ、Web Function、リビジョン、エンドポイントです。エンドポイントは IAM で守り、1 秒あたりのリクエスト数と実行環境の数に上限を付けます。

デプロイの道具が、ほかの章と違います。固定している cdkd 0.296.28 は Web Function のリソースを作れないので、このスタックだけ、[20章](/ja/chapters/20-shipping.md)と同じ AWS CDK CLI と CloudFormation を使います。理由と手順は[デプロイのページ](/ja/chapters/69-web-functions/deploy.md)に書きました。

## 向かない場面

<!-- section: 69.when-not -->

Web Function は HTTP のリクエストに答えるためのものです。キューのメッセージ、S3 のイベント、スケジュールのように、HTTP ではないきっかけで動く処理は、これまでどおり Event Function に書きます。[08章](/ja/chapters/08-async.md)のワーカーを Web Function に移す理由はありません。

Node.js 以外の言語では使えません。WebSocket も使えず、サーバーから一方向に送り続けるなら server-sent events を使います。エンドポイントはインターネットから届く場所にしか作れず、VPC の中だけに閉じた入口が必要なら、別の構成を選びます。

CPU を使いどおしの処理にも向きません。料金は CPU 時間にかかり、1 vCPU 秒の単価は Event Function の 1 GB 秒の単価のおよそ 2.4 倍です。待ち時間の長いリクエストほど安く、計算の重いリクエストほど高くなります。境目の計算は[費用のページ](/ja/chapters/69-web-functions/wrap.md)にあります。

通信量が少なく、04章の構成でうまく動いているなら、移す必要はありません。04章の月 100 万リクエストの例は、定価で Event Function と HTTP API が USD 2.02、Web Function は実行環境が 1 か月残り続けると仮定して 2.74 から 3.96 です。この差は、リクエストが途切れたあと実行環境がどれだけ残るかで変わり、その長さは公式ドキュメントに書かれていません。

Cloudflare Workers と Vercel にも、同じ形の機能があります。違いは費用のページにまとめました。

次の[しくみと実装](/ja/chapters/69-web-functions/build.md)では、サーバーの起動と停止、同時に処理中のリクエストの扱い、スタックを順に読みます。
