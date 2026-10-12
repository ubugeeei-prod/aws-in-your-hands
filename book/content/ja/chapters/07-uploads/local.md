---
title: "07 File Upload: 手元で動かす"
---

# 07 File Upload: 手元で動かす

## 手元で動かす

<!-- section: 07.local -->

`examples/07-uploads/.env.example` を、同じ場所に `.env` という名前でコピーします。

<<< @/examples/07-uploads/.env.example

ターミナルを 2 つ使います。

```bash
vp run dev:uploads:api
vp run dev:uploads:web
```

<http://localhost:5173> を開いて、サインインして、ノートを作って開きます。「Images」の下でファイルを選ぶと、画像が付きます。別のブラウザで `bob` としてサインインしても、Alice のノートも画像も見えません。

Docker も、AWS の認証情報も、bucket も要りません。

### S3 の代わり

<<< @/examples/07-uploads/api/src/object-store.ts{port}

アプリは、「bytes を置く場所」をこの interface として受け取ります。AWS 上では S3、手元ではメモリ上の実装です。

<<< @/examples/07-uploads/api/src/local-store-http.ts{local-store}

<<< @/examples/07-uploads/api/src/dev.ts{dev}

手元の実装は、開発サーバーの中に form の受け口を持っています。許可証には、開発用の秘密で署名した小さな policy を入れてあって、違う key、違う種類、大きすぎるファイル、期限切れを拒否します。

これは S3 の模擬ではありません。アプリの順序と認可を動かすための代わりです。再現しないものを挙げておきます。

- POST policy の実際の評価。S3 が何を、どんな応答で拒否するか
- bucket の CORS。手元では開発サーバーが自分で CORS のヘッダーを返す
- IAM。実行 role の権限が足りているか
- lifecycle rule。手元では、pending の object はいつまでも残る
- 認証情報の失効で URL が早く切れること

S3 互換のサーバーをコンテナで動かせば、もう少し本物に近づけます。そのためには Docker が要ります。Docker の daemon は Nix の shell に含まれません。この章は、そういうタスクを用意していません。執筆した環境では daemon が動いていなかったので、試してもいません。

### 画面

SPA は、06章の `web/` を土台にしています。サインイン、設定の読み込み、route の解釈は、06章のファイルをそのまま import しています。足したのは、ノートの編集画面の下に出る画像の欄だけです。

<<< @/examples/07-uploads/web/src/check-file.ts{check-file}

ファイルを選んだら、種類と大きさをブラウザの側でも確かめます。これは親切であって、守りではありません。確認を通らないファイルを直接送っても、S3 が拒否します（手元では、メモリ上の実装が拒否します）。
