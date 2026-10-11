---
title: "05 ノートを保存する: DynamoDB"
generated: true
---

<!-- 生成ファイル。編集しないこと。生成元: data/chapters.json (tools/src/book/generate.ts) -->

# 05 ノートを保存する: DynamoDB

> [!NOTE]
> この章は **planned（未執筆）** です。以下は執筆前のアウトラインで、本文でも動くサンプルでもありません。`examples/05-dynamodb` はまだ存在しません。

## この章の成果

04章の API がノートを DynamoDB に保存し、同時更新で黙って上書きしないことをテストで示せる。

## 前提

- [04 HTTP API を足す: Lambda と API Gateway HTTP API](/ja/chapters/04-http-api.md)

読書経路: `shortest`

## 構成案

ブラウザ → API Gateway HTTP API → Lambda（ap-northeast-1）→ DynamoDB テーブル（on-demand）。

使うサービス: DynamoDB

## 扱う内容

- アクセスパターンから partition key / sort key を決める
- version 属性と ConditionExpression による楽観ロック
- eventually / strongly consistent read の違いと費用
- on-demand と provisioned の選び方
- Global Tables の consistency mode（発展、要一次情報確認）
- SQL が合うデータなら 13章へ進む判断基準

## 分散システムとして見る点

状態の持ち主はテーブル。invariant は「version は保存のたびに 1 だけ増え、古い version からの更新は拒否される」。

## 完成に必要なソース

- NoteRepository の DynamoDB adapter と in-memory adapter（同じ contract test を通す）
- CDK のテーブル定義と removalPolicy の assertion
- 競合更新・応答喪失後の再試行を再現する決定的テスト
- DynamoDB Local を使う local integration（Docker daemon が必要なことを明記）

## 調査の出発点にする一次情報

- [What is Amazon DynamoDB?](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html) (執筆時に未再確認)
- [DynamoDB global tables](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GlobalTables.html) (執筆時に未再確認)
- [DynamoDB global tables core concepts](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/globaltables-CoreConcepts.html) (執筆時に未再確認)
