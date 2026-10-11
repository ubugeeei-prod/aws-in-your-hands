---
title: "24 発展ラボ: celld を AWS でセルフホストする"
generated: true
---

<!-- 生成ファイル。編集しないこと。生成元: data/chapters.json (tools/src/book/generate.ts) -->

# 24 発展ラボ: celld を AWS でセルフホストする

> [!NOTE]
> この章は **planned（未執筆）** です。以下は執筆前のアウトラインで、本文でも動くサンプルでもありません。`examples/24-celld` はまだ存在しません。

## この章の成果

celld を 1 台の EC2 で動かし、次に小さな fleet で drain・更新・復旧を試す。

## 前提

- [22 データとサービスを復旧する: PITR、snapshot、S3 versioning、AWS Backup](/ja/chapters/22-recovery.md)
- [23 制御したいときの EC2: SSM、EBS、プロセス運用](/ja/chapters/23-ec2.md)


## 構成案

private subnet の node 群（peer 通信は private + TLS）+ 保持する EBS と S3 bucket。CDK はインフラまで、celld の配置は別手順。

使うサービス: EC2, EBS, S3, VPC

## 扱う内容

- celld は AWS の managed service ではなく、版を固定して自分で運用する OSS（調査時点で beta）
- 公式の limitations/security/guarantees/upgrade notes を再確認
- S3 があっても全 node の disk を同時に捨てられるとは限らない
- drain と更新の順序
- 未確認の cdkd 統合は作らない

## 分散システムとして見る点

保証は celld が文書化した protocol と failure model に依存する。任意の障害での無損失は主張しない。

## 完成に必要なソース

- fleet の CDK と保持設定の assertion
- 配置・drain・更新・backup/restore の script と vp task
- node 喪失後に object ownership の invariant を確かめる検査

## 調査の出発点にする一次情報

- [celld source](https://github.com/denoland/celld) (執筆時に未再確認)
- [celld limitations](https://github.com/denoland/celld/blob/main/docs/limitations.md) (執筆時に未再確認)
- [celld security](https://github.com/denoland/celld/blob/main/docs/security.md) (執筆時に未再確認)
- [celld guarantees](https://celld.dev/docs/guarantees/) (執筆時に未再確認)
- [celld documentation](https://celld.dev/docs/) (執筆時に未再確認)
