---
title: "15 メールを送る: SES"
generated: true
---

<!-- 生成ファイル。編集しないこと。生成元: data/chapters.json (tools/src/book/generate.ts) -->

# 15 メールを送る: SES

> [!NOTE]
> この章は **planned（未執筆）** です。以下は執筆前のアウトラインで、本文でも動くサンプルでもありません。`examples/15-email` はまだ存在しません。

## この章の成果

ノート共有の通知メールを送り、bounce と complaint を受けて送信を止められる。

## 前提

- [08 リクエストの外で処理する: SQS、DLQ、冪等性、Scheduler](/ja/chapters/08-async.md)


## 構成案

queue → Lambda → SES。bounce/complaint は event destination → SQS → suppression 記録。

使うサービス: SES

## 扱う内容

- sandbox と production access の申請（手作業の手順）
- SPF/DKIM/DMARC と Route 53
- 重複送信を防ぐ冪等性

## 分散システムとして見る点

送信 API の成功は配達の成功ではない。応答喪失後の再送で重複し得る。

## 完成に必要なソース

- 送信 adapter と fixture
- identity / configuration set の CDK
- 同じ通知を二度送らないテスト

## 調査の出発点にする一次情報

- [Request SES production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html) (執筆時に未再確認)
