---
title: "16 長い処理を動かす: ECS task、Step Functions、Lambda durable functions、AWS Batch"
generated: true
---

<!-- 生成ファイル。編集しないこと。生成元: data/chapters.json (tools/src/book/generate.ts) -->

# 16 長い処理を動かす: ECS task、Step Functions、Lambda durable functions、AWS Batch

> [!NOTE]
> この章は **planned（未執筆）** です。以下は執筆前のアウトラインで、本文でも動くサンプルでもありません。`examples/16-long-jobs` はまだ存在しません。

## この章の成果

全ノートの export を、途中で止まっても続きから再開できる処理として作る。

## 前提

- [08 リクエストの外で処理する: SQS、DLQ、冪等性、Scheduler](/ja/chapters/08-async.md)
- [12 コンテナを動かす: ECR、ECS/Fargate、ALB](/ja/chapters/12-containers.md)

読書経路: `containers`

## 構成案

Scheduler → workflow（Step Functions または durable function）→ 各 step の Lambda / ECS task → S3。

使うサービス: Step Functions, Lambda durable functions, ECS, AWS Batch, EventBridge Scheduler

## 扱う内容

- Lambda の 15 分上限と分割
- Lambda durable functions（進捗を保持して再開）と Durable Objects（ID ごとの状態）の違い
- 補償処理
- state transition 課金と待機の費用

## 分散システムとして見る点

step は再実行され得る。各 step を冪等にし、checkpoint の粒度を選ぶ。

## 完成に必要なソース

- workflow 定義と step の実装
- worker 中断後に再開しても出力が重複しないテスト

## 調査の出発点にする一次情報

- [Lambda durable functions](https://docs.aws.amazon.com/lambda/latest/dg/durable-functions.html) (執筆時に未再確認)
- [What is Amazon EventBridge Scheduler?](https://docs.aws.amazon.com/scheduler/latest/UserGuide/what-is-scheduler.html) (執筆時に未再確認)
