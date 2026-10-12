---
title: "64 Isolates: デプロイ"
---

# 64 Isolates: デプロイ

## デプロイと動作確認

<!-- section: 64.deploy -->

このページの手順は、AWS では一度も実行していません。イメージのビルドには Docker のデーモンが要り、Nix のシェルには入っていません。手順の形は [12章](/ja/chapters/12-containers/deploy.md)と同じなので、12章を通したことがあれば、違いはイメージの中身だけです。

このページの途中から、時間課金が始まります。最初に、11章の VPC をデプロイします。既定の構成なら料金はかかりません。

```bash
vp run net:infra:deploy
```

次に、タグなしでデプロイします。リポジトリだけができます。

```bash
vp run isolates:infra:deploy
```

イメージに入れる 3 つのファイルを用意し、イメージを作ってプッシュします。

```bash
vp run isolates:fetch
vp run isolates:bundle
vp run isolates:image:build v1
vp run isolates:image:push v1
```

<<< @/examples/64-isolates/src/image.ts{steps}

プッシュする前に、イメージを手元で起動して確かめてください。この章ではできなかった確認です。

```bash
docker run --rm --read-only -p 8080:8080 -e ALLOWED_ORIGIN=http://localhost:5173 aih-isolates:v1
curl -si http://localhost:8080/health
```

最後に、タグを付けてデプロイします。**このデプロイから課金されます。**

```bash
vp run isolates:infra:diff -c imageTag=v1
vp run isolates:infra:deploy -c imageTag=v1
vp run isolates:smoke
```

`isolates:smoke` は、スタックの出力から URL を読み、`/health` を呼んでから、ノートを作り、読み、消します。タスクが 1 つなので、作ったノートは次のリクエストで読めるはずです。

workerd の版を上げるときも、アプリを直したときも、手順は同じです。`src/release.ts` と `package.json` の版をそろえて変え、新しいタグでイメージを作り、そのタグでデプロイします。

```bash
vp run isolates:image:build v2
vp run isolates:image:push v2
vp run isolates:infra:deploy -c imageTag=v2
```

`-c` はその 1 回のコマンドにしか効きません。`-c imageTag=...` を付け忘れてデプロイすると、ロードバランサーとタスクが削除されます。`diff` にも同じ `-c` を付けて、変更を先に確認してください。

ドリフトの検査は、02章と同じです。

```bash
vp run isolates:infra:drift
```

12章のデプロイのページに書いた未確認の点は、この章にもそのまま当てはまります。別のアプリのスタックから `Fn::ImportValue` で VPC を読む経路と、circuit breaker がロールバックしたときに cdkd が何を報告するかです。
