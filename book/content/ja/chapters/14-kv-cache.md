---
title: "14 key-value と cache を選ぶ: DynamoDB、ElastiCache/Valkey、edge 設定"
generated: true
---

<!-- 生成ファイル。編集しないこと。生成元: data/chapters.json (tools/src/book/generate.ts) -->

# 14 key-value と cache を選ぶ: DynamoDB、ElastiCache/Valkey、edge 設定

> [!NOTE]
> この章は **planned（未執筆）** です。以下は執筆前のアウトラインで、本文でも動くサンプルでもありません。`examples/14-kv-cache` はまだ存在しません。

## この章の成果

rate limit と一覧の cache を題材に、三つの「KV」を目的・一貫性・寿命・料金で選び分ける。

## 前提

- [05 ノートを保存する: DynamoDB](/ja/chapters/05-dynamodb.md)
- [10 edge を理解する: CloudFront Functions、KeyValueStore、Lambda@Edge](/ja/chapters/10-edge.md)
- [11 本当に必要なネットワーク: VPC、subnet、NAT、endpoint](/ja/chapters/11-network.md)


## 構成案

同じ interface の裏に DynamoDB（TTL）と Valkey を置き、edge 設定は KVS に分ける。

使うサービス: DynamoDB, ElastiCache, CloudFront KeyValueStore

## 扱う内容

- cache は消えてよいデータだけに使う
- TTL の削除は即時ではない
- Valkey は VPC と常時稼働費用を伴う（serverless の最小課金を確認）
- cache stampede

## 分散システムとして見る点

cache と元データの不一致を前提に、どちらが正かを決める。

## 完成に必要なソース

- rate limiter の実装と、時計を注入した境界テスト
- 各 store の CDK
- stale read を再現するテスト

## 調査の出発点にする一次情報

- [Amazon CloudFront KeyValueStore](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions.html) (確認日 2026-10-11)
- [What is Amazon DynamoDB?](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html) (執筆時に未再確認)
