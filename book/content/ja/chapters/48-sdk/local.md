---
title: "48 SDK: 手元で動かす"
---

# 48 SDK: 手元で動かす

## 手元で動かす

<!-- section: 48.local -->

この章のコードは、すべて手元で動きます。AWS のアカウントも認証情報も要りません。[ここまでのページ](/ja/chapters/48-sdk/build.md)で「確かめました」と書いたことは、次のテストがしていることです。

```bash
vp test run examples/48-sdk
```

テストは 11 ファイル、104 件あります。どのテストも、ループバックに立てたサーバーに本物のクライアントをつないでいて、プロセスの外へは何も出ません。待ち時間を確かめるテストは、乱数を固定して実際に数百ミリ秒待つので、全体で 2 秒ほどかかります。

SDK の既定値を、自分の手元の版で見るには、次を実行します。

```bash
vp run sdk:defaults
```

```text
{
  "retries2026": false,
  "retryMode": "standard",
  "defaultsMode": "legacy",
  "maxAttempts": {
    "dynamodb": 3,
    "s3": 3,
    "constant": 3
  },
  "backoff": {
    "transientBaseMs": 100,
    "dynamodbTransientBaseMs": 100,
    "throttlingBaseMs": 500,
    "capMs": 20000
  },
  "retryQuota": {
    "capacity": 500,
    "transientRetryCost": 10,
    "throttlingRetryCost": 5,
    "refundWithoutRetry": 1
  },
  "http": {
    "connectionTimeoutMs": null,
    "requestTimeoutMs": null,
    "socketTimeoutMs": null,
    "throwOnRequestTimeout": false,
    "keepAlive": true,
    "maxSockets": 50
  }
}
```

このタスクは、この端末の環境変数と `~/.aws/config` をそのまま読みます。`max_attempts` や `retry_mode` を設定していれば、上と違う値が出ます。それが、あなたの端末でクライアントが実際に使う値です。テストのほうは、設定を切り離してから尋ねています。

`AWS_NEW_RETRIES_2026=true vp run sdk:defaults` とすると、`retries2026` が `true` になり、`maxAttempts.dynamodb` が 4、`backoff` が 50、25、1000、`transientRetryCost` が 14 に変わります。

試行ごとのログは、次で見られます。出力は[しくみと実装](/ja/chapters/48-sdk/build.md)に載せました。

```bash
vp run sdk:tour
```

`vp run sdk:credentials` は、この端末の既定の認証情報がどこから来るかを表示します。前のページに書いたとおり、設定によっては AWS に届くので、ほかの 2 つとは違って `live` のタスクです。

SDK の版を上げたときにすることは 1 つで、テストを走らせます。既定値が変わっていれば `defaults.test.ts` が、再試行されるエラーの範囲が変わっていれば `retry.test.ts` が、ミドルウェアの並びが変わっていれば `attempt-log.test.ts` が落ちます。落ちたら、`src/defaults.ts` の定数と本文の表を、新しい値に合わせて直します。

### 手元で再現しないもの

手元のサーバーは平文の HTTP です。本物のエンドポイントは HTTPS なので、TLS の接続にかかる時間と、HTTPS 用のエージェントの挙動は通っていません。keep-alive と 50 本という設定が HTTPS 用のエージェントにも入っていることは、ソースで読んだだけです。`sdk:defaults` が表示するのは、平文の HTTP 用のエージェントの値です。

サービスの側の挙動は、何も再現していません。本物の DynamoDB がどのエラーをどのステータスで返すか、`x-amz-retry-after` を返すサービスがどれか、リクエスト ID がどんな形か、は台本からはわかりません。

Lambda の実行環境の中での挙動も、確かめていません。環境変数から認証情報が取れること、`AWS_NEW_RETRIES_2026` を関数の環境変数に置けば効くことは、ソースとドキュメントから導いたものです。
