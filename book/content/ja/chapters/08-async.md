---
title: "08 リクエストの外で処理する: SQS、DLQ、冪等性、Scheduler"
generated: true
---

<!-- 生成ファイル。編集しないこと。生成元: data/chapters.json (tools/src/book/generate.ts) -->

# 08 リクエストの外で処理する: SQS、DLQ、冪等性、Scheduler

> [!NOTE]
> この章は **planned（未執筆）** です。以下は執筆前のアウトラインで、本文でも動くサンプルでもありません。`examples/08-async` はまだ存在しません。

## この章の成果

画像のサムネイル生成を queue に逃がし、同じメッセージが二度届いても結果が一つになる。

## 前提

- [07 画像をアップロードする: presigned URL と S3](/ja/chapters/07-uploads.md)

読書経路: `shortest`

## 構成案

S3 event → SQS → Lambda worker → S3 / DynamoDB。失敗は DLQ へ。Scheduler が定期掃除を起動。

使うサービス: SQS, Lambda, EventBridge Scheduler

## 扱う内容

- at-least-once 配送と visibility timeout
- partial batch response
- idempotency key と conditional write
- DLQ の監視と redrive
- backpressure と同時実行数の上限

## 分散システムとして見る点

invariant は「1 つの画像に対しサムネイル記録は高々 1 つ」。SQS を使うこと自体は exactly-once を与えない。

## 完成に必要なソース

- worker と idempotency store
- 重複配送・順序入替え・途中中断を注入する決定的テスト
- queue / DLQ / event source mapping の CDK と assertion

## 調査の出発点にする一次情報

- [What is Amazon SQS?](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html) (執筆時に未再確認)
- [What is Amazon EventBridge Scheduler?](https://docs.aws.amazon.com/scheduler/latest/UserGuide/what-is-scheduler.html) (執筆時に未再確認)
