---
title: "69 Web Functions: 手元で動かす"
---

# 69 Web Functions: 手元で動かす

[しくみと実装](/ja/chapters/69-web-functions/build.md)で読んだサーバーは、Lambda に置くものと同じファイルを、手元の Node.js でそのまま起動できます。このページでは、起動、テスト、パッケージの確認の順に進め、最後に、手元ではわからないことを挙げます。どの手順も AWS のアカウントを使いません。

## 起動して、呼ぶ

<!-- section: 69.local -->

設定ファイルを写して、サーバーを起動します。

```bash
cp examples/69-web-functions/.env.example examples/69-web-functions/.env
vp run dev:webfn
```

別の端末から呼びます。`lambda-web-request-id` を自分で付けると、Lambda が付けたときと同じように、その値がレスポンスの `x-request-id` に入ります。

```bash
curl -i http://127.0.0.1:8787/health
curl -i -H 'lambda-web-request-id: from-my-terminal' \
  -d '{"title":"first","body":""}' http://127.0.0.1:8787/notes
```

`AWS_LAMBDA_HTTP_ENDPOINT` を設定せずに起動したので、サーバーは `127.0.0.1:8787` で待ち受け、ログは 04章と同じ 1 行の JSON です。`.env` でこの変数に `127.0.0.1:3000` のような値を入れると、Lambda の上と同じ経路でアドレスを読み、ログも `console` にオブジェクトを渡す形に変わります。手元の端末では、オブジェクトは JSON ではなく Node.js の表示形式で出ます。

Lambda がするように、エントリファイルを独立したプロセスとして起動し、同時にリクエストを送り、SIGTERM で止めるところまでを、1 つのタスクにまとめてあります。

```bash
vp run webfn:demo
```

```text
listening on 127.0.0.1:63789 after 107 ms
50 requests at once in one process: 50 answered under their own request ID
SIGTERM: exited with code 0 after 4 ms (Lambda allows 1000 ms)
```

ポートの番号と時間は、実行のたびに変わります。時間は手元の Mac での値で、Lambda の実行環境での起動時間ではありません。

## テスト

テストは 9 ファイル、68 件です。

```bash
vp test run examples/69-web-functions
```

サーバーに関わるテストは、アプリを関数として呼ぶのではなく、`serve` で実際にソケットを開いて、`fetch` と `node:http` でつなぎます。同時に処理中の 2 つのリクエスト、プリフライト、上限を超えるアップロード、SIGTERM のあとの停止は、どれもこの形です。

zip のパッケージには、専用のテストがあります。Lambda に渡すのと同じアーカイブを作り、空のディレクトリに展開して、そこにあるファイルだけでサーバーを起動します。

<<< @/examples/69-web-functions/test/package.test.ts{package}

このテストが守っているのは、「手元で動くのは `node_modules` があるからだった」という失敗です。ランタイムは、パッケージのルートにある `index.js` を読み込みます。`package.json` の `main` は見ません。そして `index.js` が `import` を使うなら、同じ場所の `package.json` に `"type": "module"` が要ります。パッケージを組み立てるコードは、この 2 つのファイルだけを作ります。

<<< @/examples/69-web-functions/scripts/build.ts{package}

Nix のシェルに `zip` コマンドは入っていないので、アーカイブは自分で書いています。DEFLATE は `node:zlib` に任せ、足りないのは見出しと目次の部分だけです。日時を固定してあるので、同じファイルからは同じバイト列ができ、チェックサムでビルドを特定できます。

<<< @/examples/69-web-functions/src/zip.ts{zip}

アーカイブだけを作って大きさとチェックサムを見るには、次のタスクを使います。

```bash
vp run webfn:package
```

## synth

スタックの synth も手元で完結します。AWS には問い合わせません。

```bash
vp run webfn:cfn:synth
vp run webfn:cfn:synth -c stable=v1 -c canary=v2 -c canaryWeight=10
```

1 つ目は、パッケージをまだアップロードしていない状態のテンプレートで、リビジョンとエンドポイントを含みません。2 つ目は、2 つのリビジョンに 90 対 10 で振り分けるテンプレートです。`v1` と `v2` は S3 のバージョン ID の代わりに置いた仮の値で、synth はオブジェクトがあるかどうかを確かめません。

AWS CDK CLI 2.1145.0 は、synth のたびに次の警告を出します。

```text
WARNING Unknown resource type 'AWS::Lambda::WebFunction' (CloudFormation Validate)
```

CLI に同梱されている検証のルールが、この種類を知らないために出る警告で、テンプレートは書き出されます。CloudFormation がこのテンプレートを受け付けるかどうかは、デプロイしていないので確かめていません。

## 手元ではわからないこと

<!-- section: 69.laptop-limits -->

手元で確かめられるのは、サーバーとしてのふるまいです。ルート、ヘッダー、同時に処理中のリクエストの分離、停止の処理、パッケージの中身は、Lambda の上でも同じコードが同じように動きます。

Lambda が決めることは、手元では再現しません。

- **起動。** バンドルした `index.js` が `nodejs24.x` のランタイムで読み込まれ、10 秒以内に待ち受けが始まるかどうか。手元の Node.js は macOS の上で動いていて、Arm64 の Linux ではありません
- **認可。** 署名のないリクエストが 403 で断られること、署名したリクエストが通ること。手元のサーバーは誰のリクエストにも答えます
- **Lambda が足すもの。** `lambda-web-request-id` の実際の形、`X-Forwarded-For`、取り除かれるヘッダー、`lambda-web-error-type`
- **ボディの受け渡し。** ボディを渡し終えてからレスポンスを届ける、という決まりのもとでのふるまい。手元の Node.js は、ボディの途中でもレスポンスを送ります
- **スケーリングとスロットリング。** 実行環境がいつ増え、いつ消えるか。`rateLimit` と `maxEnvironments` で 429 が返ること
- **ログ。** `console` に渡したオブジェクトが `message` の下に JSON で入ること、2 つのロググループに届くまでの時間
- **CPU 時間とメモリ。** 料金のもとになる 2 つの値。手元のプロセスの値は、請求の値の代わりになりません

公式ドキュメントも、IAM の認可、S3 と KMS へのアクセス、リビジョンとエンドポイントの状態、スケーリング、テレメトリは、クラウドでのテストが必要だと書いています。次の[デプロイ](/ja/chapters/69-web-functions/deploy.md)のページの手順は、そのために用意したものです。
