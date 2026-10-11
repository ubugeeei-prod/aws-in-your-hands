---
title: "06 ログインを足す: Cognito と認可"
generated: true
---

<!-- 生成ファイル。編集しないこと。生成元: data/chapters.json (tools/src/book/generate.ts) -->

# 06 ログインを足す: Cognito と認可

> [!NOTE]
> この章は **planned（未執筆）** です。以下は執筆前のアウトラインで、本文でも動くサンプルでもありません。`examples/06-auth` はまだ存在しません。

## この章の成果

SPA から authorization code + PKCE でログインし、API は自分のノートだけを返す。

## 前提

- [03 SPA を公開する: private S3 origin と CloudFront](/ja/chapters/03-spa.md)
- [05 ノートを保存する: DynamoDB](/ja/chapters/05-dynamodb.md)

読書経路: `shortest`

## 構成案

SPA → Cognito managed login → SPA（code）→ token endpoint。API Gateway の JWT authorizer が token を検証し、Lambda が sub でデータを絞る。

使うサービス: Cognito user pools, API Gateway HTTP API JWT authorizer

## 扱う内容

- OIDC/OAuth の用語を最小限で
- Amplify を使わない標準ライブラリでの PKCE
- 認証（誰か）と認可（そのノートを触ってよいか）の分離
- token の保存場所と寿命
- Cognito の料金単位（MAU と tier、要一次情報確認）

## 分散システムとして見る点

token は発行後も期限まで有効。失効の伝播は即時ではない点を扱う。

## 完成に必要なソース

- user pool / app client の CDK と callback URL の設定
- 他人のノート ID を指定しても 404 になる認可テスト
- ローカル用の署名付きテスト token を作る fixture（本物の Cognito を再現しないと明記）

## 調査の出発点にする一次情報

- [Amazon Cognito user pools](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools.html) (執筆時に未再確認)
