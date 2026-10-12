---
title: "35 Lambda Managed Instances: 手元で動かす"
---

# 35 Lambda Managed Instances: 手元で動かす

このページのコマンドは、どれも AWS に触れません。アカウントも認証情報も要りません。

## 手元で動かす

<!-- section: 35.local -->

API を起動します。

```bash
cp examples/35-lambda-managed-instances/.env.example examples/35-lambda-managed-instances/.env
vp run dev:lmi
```

04章と同じノート API が `http://localhost:8787` で動きます。違いは、ノートを保存や削除するたびに `note stored`、`note deleted` というログが 1 行増え、そこにリクエスト ID が付くことです。

<<< @/examples/35-lambda-managed-instances/src/dev.ts{dev}

環境変数 `SCOPE=module` を付けて起動すると、リクエスト ID をモジュールスコープに置く版になります。ただ、手で `curl` を打っているかぎり、この版でもログは正しく出ます。メモリの中のリポジトリは書き込みで待たないので、2 つのリクエストが重なる瞬間がほとんど無いからです。不具合を確実に見るには、順序を固定したテストを使います。

```bash
vp test run examples/35-lambda-managed-instances
```

テストは 8 つのファイルに分かれています。

- `test/scope.test.ts` と `test/server.test.ts`: 同時に処理中の 2 つのリクエストで、リクエスト ID が入れ替わること、`AsyncLocalStorage` では入れ替わらないこと。前者は関数の呼び出しで、後者は本物のソケットで確かめます
- `test/threads.test.ts`: 2 本のワーカースレッドが、別々の `Map` を持つこと
- `test/config.test.ts`: 設定の検証
- `test/network.test.ts`: 11章のサブネットから CloudWatch Logs に届く経路があるか。経路のモデルを読むだけで、実物は見ません
- `test/pricing.test.ts` と `test/break-even.test.ts`: 料金の入力と、損益分岐の計算
- `infra/test/managed-instances-stack.test.ts`: スタックのアサーション

料金と経路は、デプロイする前に 1 つのコマンドで確かめられます。

```bash
vp run lmi:plan
```

表示されるのは、関数とインスタンスの設定、サブネットから CloudWatch Logs への経路、置いてあるだけでかかる料金、標準の Lambda より安くなる負荷です。11章のネットワークにエンドポイントが無い設定（`vp run lmi:plan interfaceEndpoints=`）では、経路が無いことを表示して、終了コード 2 で終わります。

テンプレートは、次のコマンドで作れます。

```bash
vp run lmi:infra:synth
```

esbuild がハンドラーをバンドルし、`examples/35-lambda-managed-instances/cdk.out/` にテンプレートを書きます。AWS には問い合わせません。VPC の ID やサブネットの ID は 11章のスタックの出力を名前で参照しているので、値が入るのはデプロイのときです。

手元で確かめられるのは、ここまでです。次のことは、この章では一度も動かしていません。

- Lambda の実行環境そのもの。ワーカースレッドがいくつ起動するか、リクエストがどう配られるか
- スケーリングと、間に合わないときのスロットリング
- インスタンスの起動、入れ替え、終了。インスタンスは最長 14 日で入れ替わると発表の記事にあります
- タイムアウトしたあとも動き続けるコード

手元の Node.js のサーバーは、1 つのプロセスで複数のリクエストを処理するという 1 点だけが Lambda Managed Instances と同じで、ほかは別のものです。cdkd にはスタックを手元の Lambda のコンテナで動かす機能がありますが、Docker のデーモンが要り、Nix のシェルには含まれていません。そのコンテナが Lambda Managed Instances の同時実行を再現するかも、確認していません。
