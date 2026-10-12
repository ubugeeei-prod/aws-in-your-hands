---
title: "64 Isolates: 手元で動かす"
---

# 64 Isolates: 手元で動かす

このページのコマンドは、どれも AWS に触れません。アカウントも認証情報も Docker も要りません。

## 手元の workerd で 04章のアプリを動かす

<!-- section: 64.local -->

workerd のバイナリは、`vp install` が npm から連れてきます。Nix の devShell の中で、macOS（arm64）用の 1.20261012.1 が起動することを確かめました。README が動作を確認していると書いているのは、Linux と macOS の x86-64 と arm64、Windows の x86-64 です。Linux では glibc 2.35 以降が要ります。この章を Linux では動かしていません。

`workerd` のパッケージには postinstall のスクリプトがあり、pnpm は許可が無いので実行しません。`vp install` のたびに「Ignored build scripts: workerd」と表示されますが、この章のコードは、プラットフォーム別のパッケージからバイナリを直接見つけるので、スクリプトが無くても動きます。

<<< @/examples/64-isolates/src/runtime.ts{installed}

アプリを起動します。

```bash
vp run dev:isolates
```

このタスクは、先にバンドルを `dist/` に書き、手元用の設定のファイルを生成してから、workerd を起動します。

<<< @/examples/64-isolates/src/deployments.ts{local}

<<< @/examples/64-isolates/scripts/serve.ts{serve}

04章と同じノート API が、`http://localhost:8787` で動きます。別のターミナルから呼んでみます。

```bash
curl -si http://localhost:8787/health
curl -s -X POST http://localhost:8787/notes -d '{"title":"hello","body":"from workerd"}'
curl -s http://localhost:8787/notes
```

実際に実行したときの `/health` の応答と、workerd の標準出力です。リクエスト ID は実行のたびに変わります。

```text
HTTP/1.1 200 OK
Content-Length: 31
Content-Type: application/json
Access-Control-Allow-Origin: http://localhost:5173
Vary: Origin
x-request-id: f749b1f3-f6e7-4dd4-a3b8-1d524aaf21a5

{"status":"ok","stage":"local"}
```

```text
{"level":"info","message":"request","requestId":"f749b1f3-f6e7-4dd4-a3b8-1d524aaf21a5","method":"GET","path":"/health","status":200,"durationMs":4}
{"level":"info","message":"request","requestId":"62b15f1c-0e5e-4298-98aa-f57fc3e65a02","method":"POST","path":"/notes","status":201,"durationMs":10}
{"level":"info","message":"request","requestId":"37d6db12-328b-4dea-96de-ccf7448a8d80","method":"GET","path":"/notes","status":200,"durationMs":0}
```

ログは、04章のロガーが書いた JSON がそのまま 1 行ずつ出ています。Lambda のように、行の前に時刻やリクエスト ID が付くことはありません。

テストは次のコマンドで動かします。

```bash
vp test run examples/64-isolates
```

テストは 5 つのファイルに分かれています。

- `test/workerd.test.ts`: 本物の workerd を起動するテストです。04章のアプリがコントラクトどおりに答えること、2 つの worker が状態を共有しないこと、処理中の 2 つのリクエストがモジュールスコープを共有すること、binding が設定と環境変数から届くこと、イメージ用の設定のファイルを workerd が受け付けることを確かめます。バイナリが起動しないマシンでは、このファイルのテストは飛ばされ、その旨が 1 行表示されます
- `test/worker.test.ts`: アダプターを Node.js の上で呼ぶテストです
- `test/definition.test.ts`: 設定のスキーマが断るものと、生成されるファイルの中身、固定した配布物の照合
- `test/pricing.test.ts`: 料金の入力と計算
- `infra/test/isolates-stack.test.ts`: スタックのアサーション

時間に関わる動きは、テストではなく観察用のタスクで見ます。20 秒ほどかかります。

```bash
vp run isolates:observe
```

テンプレートと、イメージに入れるファイルも、手元で作れます。

```bash
vp run isolates:infra:synth -c imageTag=v1
vp run isolates:fetch
vp run isolates:bundle
vp run isolates:image:build v1 --dry-run
```

`isolates:fetch` は npm のレジストリから 40 MB ほどの配布物を取得し、照合してから `examples/64-isolates/.workerd/` に展開します。取得したバイナリは実行しません。`--dry-run` を付けた `isolates:image:build` は、`docker` のコマンドを表示するだけです。

手元で確かめられるのは、ここまでです。手元の workerd は macOS 用で、イメージに入るのは Linux arm64 用の別のバイナリです。コンテナの中での起動、Fargate の上での動き、ロードバランサー越しのリクエスト、タスクの入れ替えは、この章では一度も動かしていません。
