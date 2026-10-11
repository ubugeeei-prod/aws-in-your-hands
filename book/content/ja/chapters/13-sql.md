---
title: "13 D1 に親しんだ人の SQL 開発: Aurora DSQL、RDS PostgreSQL、Aurora Serverless v2"
generated: true
---

<!-- 生成ファイル。編集しないこと。生成元: data/chapters.json (tools/src/book/generate.ts) -->

# 13 D1 に親しんだ人の SQL 開発: Aurora DSQL、RDS PostgreSQL、Aurora Serverless v2

> [!NOTE]
> この章は **planned（未執筆）** です。以下は執筆前のアウトラインで、本文でも動くサンプルでもありません。`examples/13-sql` はまだ存在しません。

## この章の成果

schema、migration、型付き CRUD、seed/reset、テスト、実環境の migration、backup/restore までを SQL で一通り行える。

## 前提

- [04 HTTP API を足す: Lambda と API Gateway HTTP API](/ja/chapters/04-http-api.md)

読書経路: `sql`, `cloudflare-d1`

## 構成案

Lambda → Aurora DSQL（IAM 認証、VPC 不要の経路を一次情報で確認）。比較として RDS PostgreSQL / Aurora Serverless v2 は 11章の VPC 内。

使うサービス: Aurora DSQL, RDS for PostgreSQL, Aurora Serverless v2

## 扱う内容

- 三つの選択肢を SQL 互換性・認証・接続・transaction・無通信時費用で選ぶ
- DSQL は完全な PostgreSQL ではない: 対応 SQL/DDL と migration tool を固定版で確認
- OCC による commit 時の競合と再試行
- ローカルの PostgreSQL は代用であり DSQL の認証・競合を再現しない
- Aurora auto-pause の条件と残る storage 料金
- D1 の read replica/Sessions との保証範囲の比較

## 分散システムとして見る点

invariant は「transaction は全体が commit されるか全体が再試行される」。再試行は冪等な範囲に閉じる。

## 完成に必要なソース

- migration、seed、reset の vp task（local / cloud を分離、cache: false）
- 型付き query 層と contract test
- serialization failure を注入して再試行を確かめる決定的テスト
- D1 側の比較コードを載せる場合は wrangler 設定を含む完全なソース

## 調査の出発点にする一次情報

- [What is Amazon Aurora DSQL?](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/what-is-aurora-dsql.html) (執筆時に未再確認)
- [Aurora DSQL PostgreSQL compatibility](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-migration-guide.html) (執筆時に未再確認)
- [Aurora DSQL DDL](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-ddl.html) (執筆時に未再確認)
- [Aurora DSQL Node.js connectors](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/SECTION_Node-js-connectors.html) (執筆時に未再確認)
- [Aurora DSQL concurrency control](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-concurrency-control.html) (執筆時に未再確認)
- [Aurora DSQL pricing](https://aws.amazon.com/rds/aurora/dsql/pricing/) (執筆時に未再確認)
- [Aurora Serverless v2 auto-pause](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html) (執筆時に未再確認)
- [What is Amazon RDS?](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Welcome.html) (執筆時に未再確認)
- [Cloudflare D1: Local development](https://developers.cloudflare.com/d1/best-practices/local-development/) (確認日 2026-10-11)
- [Cloudflare D1: Migrations](https://developers.cloudflare.com/d1/reference/migrations/) (執筆時に未再確認)
- [Cloudflare D1: Read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/) (執筆時に未再確認)
