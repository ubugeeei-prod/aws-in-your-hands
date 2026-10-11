---
title: "11 本当に必要なネットワーク: VPC、subnet、NAT、endpoint"
generated: true
---

<!-- 生成ファイル。編集しないこと。生成元: data/chapters.json (tools/src/book/generate.ts) -->

# 11 本当に必要なネットワーク: VPC、subnet、NAT、endpoint

> [!NOTE]
> この章は **planned（未執筆）** です。以下は執筆前のアウトラインで、本文でも動くサンプルでもありません。`examples/11-network` はまだ存在しません。

## この章の成果

後続章の DB とコンテナが入る最小の VPC を作り、時間課金される部品を説明できる。

## 前提

- [02 再現できる TypeScript 開発: Nix、vp、CDK、cdkd、drift](/ja/chapters/02-toolchain.md)

読書経路: `containers`

## 構成案

2 AZ の public / private subnet。NAT は必要になるまで作らず、endpoint との費用を比べる。

使うサービス: VPC, NAT Gateway, VPC endpoints

## 扱う内容

- route table が到達性を決める
- security group は stateful
- NAT Gateway・public IPv4・interface endpoint の固定費
- Lambda を VPC に入れる条件

## 分散システムとして見る点

複数 AZ は region 障害への備えではない。AZ と region を区別する。

## 完成に必要なソース

- VPC の CDK と、NAT が存在しないことを確かめる assertion
- 構成別の月額を出す価格計算の入力

## 調査の出発点にする一次情報

- [Amazon VPC pricing](https://aws.amazon.com/vpc/pricing/) (執筆時に未再確認)
