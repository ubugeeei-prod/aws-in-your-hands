---
title: "29 Lambda Tuning: デプロイ"
---

# 29 Lambda Tuning: デプロイ

## デプロイして測る

<!-- section: 29.deploy -->

ここからは AWS にデプロイして、Lambda の上の数字を取ります。ただし、このページの手順は、まだ実際の AWS で通せていません。出力の例も載せていません。

```bash
vp run tune:infra:diff
vp run tune:infra:deploy
```

既定では、メモリは 256 MB、予約済み同時実行数も provisioned concurrency も無しです。この状態なら、置いてあるだけでかかる料金はありません。

リクエストを送ります。

```bash
vp run tune:smoke
```

`tune:smoke` は、ノートを 1 件作り、それを 20 回読んでから消します。1 回ごとに、手元から見た応答時間と `x-request-id` を表示します。デプロイの直後なので、最初の 1 回は新しい実行環境に当たるはずです。ここで表示される時間には、手元から東京リージョンまでのネットワークが入っています。

Lambda 自身の記録を集計します。

```bash
vp run tune:report --minutes 15
```

`tune:report` は、関数のロググループから指定した時間のログを読み、[最初のページ](/ja/chapters/29-lambda-tuning.md)と同じ形で、コールドスタートの回数、初期化とハンドラーの時間、メモリの使用量、課金された時間を表示します。公式ドキュメントによると、ログが見えるまでに 5 分から 10 分かかることがあります。何も出なければ、少し待ってからやり直してください。

見る順番は次のとおりです。

- `cold starts` と `initialization`。初期化にどれだけかかっているかが、バンドルと初期化のコードを見直す価値の目安になります
- `handler, cold` と `handler, warm` の差。最初の呼び出しだけ遅いなら、その差の多くは接続の確立のはずです
- `memory`。使った最大量が設定に近ければ、メモリを増やします

メモリを変えて比べるには、値を渡してデプロイし直します。

```bash
vp run tune:infra:deploy -c memorySize=512
vp run tune:smoke
vp run tune:report --minutes 15
```

比べるときは、2 回の `tune:report` の時間の範囲が重ならないようにしてください。20 回の呼び出しでは、p95 は 1 回か 2 回の値で決まります。傾向を見るには足りますが、数字として人に渡すなら `--count` を増やして取り直します。

### 同時実行数を付ける

予約済み同時実行数と provisioned concurrency は、付ける前にアカウントの上限を確かめます。

```bash
aws lambda get-account-settings
```

`ConcurrentExecutions` がアカウントの上限です。予約できるのは、まだ予約されていない数から 100 を残したぶんまでで、足りなければ、次のデプロイは同時実行数のエラーで断られます。

```bash
vp run tune:infra:deploy -c reservedConcurrency=5
vp run tune:infra:deploy -c reservedConcurrency=5 -c provisionedConcurrency=1
```

2 つ目のコマンドからは、**時間で課金されます。** 256 MB で 1 つなら月に 2.83、1 日では 0.09 ほどです。確かめ終わったら、`-c provisionedConcurrency` を外してデプロイし直すか、スタックを消してください。

provisioned concurrency を付けると、バージョンとエイリアスができ、API はエイリアスを呼ぶようになります。実行環境の用意には時間がかかります。次のコマンドの `Status` が `READY` になれば、用意は済んでいます。関数名はスタックの出力 `FunctionName` です。

```bash
aws lambda get-provisioned-concurrency-config --function-name <FunctionName> --qualifier live
```

用意された実行環境の初期化は、`platform.initReport` という記録としてログに出ます。`tune:report` は、これも `initialization` の行に数えます。

cdkd については、固定している版（0.296.28）のソースを読んで、リソースの種類ごとの扱いを確かめました。既定のスタックが使う種類には、すべて専用の実装があります。provisioned concurrency を指定したときに増える `AWS::Lambda::Version` と `AWS::Lambda::Alias` には専用の実装が無く、Cloud Control API 経由になります。どちらの種類も Cloud Control API の対応一覧にはありますが、cdkd から実際に作れるかは未確認です。

ドリフトの検査は、これまでの章と同じです。

```bash
vp run tune:infra:drift
```

メモリやタイムアウトは、コンソールから 1 クリックで変えられる設定です。試しに変えたまま戻し忘れると、テンプレートと実物が食い違います。`tune:infra:drift` はその差を見つけます。
