---
title: "12 コンテナを動かす: ECR、ECS/Fargate、ALB"
generated: true
---

<!-- 生成ファイル。編集しないこと。生成元: data/chapters.json (tools/src/book/generate.ts) -->

# 12 コンテナを動かす: ECR、ECS/Fargate、ALB

> [!NOTE]
> この章は **planned（未執筆）** です。以下は執筆前のアウトラインで、本文でも動くサンプルでもありません。`examples/12-containers` はまだ存在しません。

## この章の成果

ノート API をコンテナとして ECS/Fargate で動かし、無停止で更新できる。

## 前提

- [11 本当に必要なネットワーク: VPC、subnet、NAT、endpoint](/ja/chapters/11-network.md)

読書経路: `containers`

## 構成案

ALB → ECS service（private subnet、2 task）。image は ECR。

使うサービス: ECR, ECS, Fargate, ALB

## 扱う内容

- Docker CLI と host 側 daemon の区別
- health check と rolling update、circuit breaker
- task role と execution role
- 常時稼働の費用（Fargate、ALB、public IPv4）
- auto scaling の指標

## 分散システムとして見る点

更新中は新旧 version が同時に動く。両方が同じデータ形式を読めることを invariant にする。

## 完成に必要なソース

- Dockerfile とアプリ
- ECS/ALB の CDK と assertion
- SIGTERM で進行中リクエストを完了させる graceful shutdown のテスト

## 調査の出発点にする一次情報

- [What is Amazon ECS?](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/Welcome.html) (執筆時に未再確認)
- [Elastic Load Balancing pricing](https://aws.amazon.com/elasticloadbalancing/pricing/) (執筆時に未再確認)
- [Docker overview](https://docs.docker.com/get-started/docker-overview/) (執筆時に未再確認)
