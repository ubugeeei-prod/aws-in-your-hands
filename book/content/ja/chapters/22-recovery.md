---
title: "22 データとサービスを復旧する: PITR、snapshot、S3 versioning、AWS Backup"
generated: true
---

<!-- 生成ファイル。編集しないこと。生成元: data/chapters.json (tools/src/book/generate.ts) -->

# 22 データとサービスを復旧する: PITR、snapshot、S3 versioning、AWS Backup

> [!NOTE]
> この章は **planned（未執筆）** です。以下は執筆前のアウトラインで、本文でも動くサンプルでもありません。`examples/22-recovery` はまだ存在しません。

## この章の成果

誤って消したノートと画像を実際に復元し、かかった時間と失ったデータを記録する。

## 前提

- [05 ノートを保存する: DynamoDB](/ja/chapters/05-dynamodb.md)
- [07 画像をアップロードする: presigned URL と S3](/ja/chapters/07-uploads.md)

読書経路: `sql`, `cloudflare-d1`

## 構成案

DynamoDB PITR → 新しいテーブルへ復元 → 切替。S3 は versioning から復元。

使うサービス: DynamoDB PITR, S3 Versioning, S3 Replication, AWS Backup

## 扱う内容

- replication は backup ではない: 削除も複製される
- RPO/RTO を実測する
- 復元は新しい resource を作る: IaC と drift への影響
- backup の保存費用

## 分散システムとして見る点

DB と object store は別時点に戻る。復元後の不整合を検出して直す。

## 完成に必要なソース

- backup/restore の vp task（cache: false）
- 復元後に 05章・08章の invariant が成り立つかの検査 script
- drill の記録 template

## 調査の出発点にする一次情報

未選定。執筆時に一次情報を調べて出典台帳へ追加する。
