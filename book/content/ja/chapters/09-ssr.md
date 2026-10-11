---
title: "09 SSR と BFF: Nuxt をリージョンの Lambda で動かす"
generated: true
---

<!-- 生成ファイル。編集しないこと。生成元: data/chapters.json (tools/src/book/generate.ts) -->

# 09 SSR と BFF: Nuxt をリージョンの Lambda で動かす

> [!NOTE]
> この章は **planned（未執筆）** です。以下は執筆前のアウトラインで、本文でも動くサンプルでもありません。`examples/09-ssr` はまだ存在しません。

## この章の成果

Nuxt アプリが東京リージョンの Lambda で HTML を返し、静的 asset は S3 から配信される。

## 前提

- [03 SPA を公開する: private S3 origin と CloudFront](/ja/chapters/03-spa.md)
- [04 HTTP API を足す: Lambda と API Gateway HTTP API](/ja/chapters/04-http-api.md)

読書経路: `ssr`

## 構成案

CloudFront → (/_nuxt/* は S3) / (その他は Lambda の SSR)。これは edge rendering ではなく regional SSR。

使うサービス: Lambda, CloudFront, S3

## 扱う内容

- Nitro の AWS Lambda preset（固定版で確認）
- cookie と個人別ページを共有 cache に載せない cache key 設計
- response streaming の経路全体での確認
- BFF として API を呼ぶときの認証の受け渡し

## 分散システムとして見る点

CDN cache は古い内容を返し得る。誰の、どの期間の stale を許すかを明示する。

## 完成に必要なソース

- Nuxt アプリと CDK
- Cache-Control / cache policy を検証する assertion とローカル test
- ログイン済みページが cache されないことの smoke test 手順

## 調査の出発点にする一次情報

- [Response streaming for Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/configuration-response-streaming.html) (確認日 2026-10-11)
