---
title: "07 画像をアップロードする: presigned URL と S3"
generated: true
---

<!-- 生成ファイル。編集しないこと。生成元: data/chapters.json (tools/src/book/generate.ts) -->

# 07 画像をアップロードする: presigned URL と S3

> [!NOTE]
> この章は **planned（未執筆）** です。以下は執筆前のアウトラインで、本文でも動くサンプルでもありません。`examples/07-uploads` はまだ存在しません。

## この章の成果

ブラウザが presigned URL で画像を S3 に直接送り、ノートに添付できる。

## 前提

- [06 ログインを足す: Cognito と認可](/ja/chapters/06-auth.md)

読書経路: `shortest`

## 構成案

SPA → API（presign）→ SPA → S3 PUT。閲覧は CloudFront + OAC 経由。

使うサービス: S3

## 扱う内容

- presigned URL が委譲する権限と期限
- content-type / サイズの検証をどこで行えるか
- object key の設計とユーザー分離
- 未完了 upload と孤立 object の lifecycle rule
- CORS

## 分散システムとして見る点

S3 への書込みと DynamoDB の更新は一つの transaction ではない。孤立を許容して掃除する設計を示す。

## 完成に必要なソース

- presign handler と入力 schema
- bucket の CDK（Block Public Access、lifecycle）と assertion
- upload 成功後にノート更新が失敗した場合の孤立 object を再現するテスト

## 調査の出発点にする一次情報

未選定。執筆時に一次情報を調べて出典台帳へ追加する。
