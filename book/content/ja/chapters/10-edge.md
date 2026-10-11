---
title: "10 edge を理解する: CloudFront Functions、KeyValueStore、Lambda@Edge"
generated: true
---

<!-- 生成ファイル。編集しないこと。生成元: data/chapters.json (tools/src/book/generate.ts) -->

# 10 edge を理解する: CloudFront Functions、KeyValueStore、Lambda@Edge

> [!NOTE]
> この章は **planned（未執筆）** です。以下は執筆前のアウトラインで、本文でも動くサンプルでもありません。`examples/10-edge` はまだ存在しません。

## この章の成果

redirect と feature flag を edge で処理し、どの処理をどの実行環境に置くか説明できる。

## 前提

- [03 SPA を公開する: private S3 origin と CloudFront](/ja/chapters/03-spa.md)

読書経路: `ssr`, `cloudflare-workers`

## 構成案

viewer request → CloudFront Function（+ KeyValueStore）→ cache → origin。

使うサービス: CloudFront Functions, CloudFront KeyValueStore, Lambda@Edge

## 扱う内容

- CloudFront Functions の runtime 制約（network なし、実行時間、サイズ）
- KeyValueStore の更新伝播と用途
- Lambda@Edge の region / version / 環境変数の制約
- Workers と同じものではない点の率直な比較

## 分散システムとして見る点

KVS の読みは edge ごとに結果整合。書いた直後に全 edge で読めるとは仮定しない。

## 完成に必要なソース

- Function のコードと、Node 上で同じ入力を与える unit test
- KVS の CDK と更新 script
- 本のサイトの URL rewrite Function との対応

## 調査の出発点にする一次情報

- [Restrictions on CloudFront Functions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-function-restrictions.html) (確認日 2026-10-11)
- [Amazon CloudFront KeyValueStore](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions.html) (執筆時に未再確認)
- [Restrictions on Lambda@Edge](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-at-edge-function-restrictions.html) (執筆時に未再確認)
