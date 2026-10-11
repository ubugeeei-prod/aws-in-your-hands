---
title: "18 ライブ配信のレシピ: IVS"
generated: true
---

<!-- 生成ファイル。編集しないこと。生成元: data/chapters.json (tools/src/book/generate.ts) -->

# 18 ライブ配信のレシピ: IVS

> [!NOTE]
> この章は **planned（未執筆）** です。以下は執筆前のアウトラインで、本文でも動くサンプルでもありません。`examples/18-live` はまだ存在しません。

## この章の成果

配信ソフトから IVS channel へ送り、Web の player で視聴する。

## 前提

- [04 HTTP API を足す: Lambda と API Gateway HTTP API](/ja/chapters/04-http-api.md)


## 構成案

encoder → IVS channel → player。stream key は secret として扱う。

使うサービス: IVS

## 扱う内容

- low-latency と real-time の違い
- 入力時間と視聴時間の課金
- 配信を止め忘れた場合の費用
- MediaLive 等が必要になる条件

## 分散システムとして見る点

視聴者ごとに遅延が違う。chat など別経路との同期を仮定しない。

## 完成に必要なソース

- channel の CDK
- player ページ
- stream 状態を確認する script

## 調査の出発点にする一次情報

- [What is Amazon IVS?](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/what-is.html) (執筆時に未再確認)
