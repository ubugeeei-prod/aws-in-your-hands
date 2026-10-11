---
title: "20 変更を届ける: CI/CD、OIDC、環境、preview、rollback、drift"
generated: true
---

<!-- 生成ファイル。編集しないこと。生成元: data/chapters.json (tools/src/book/generate.ts) -->

# 20 変更を届ける: CI/CD、OIDC、環境、preview、rollback、drift

> [!NOTE]
> この章は **planned（未執筆）** です。以下は執筆前のアウトラインで、本文でも動くサンプルでもありません。`examples/20-shipping` はまだ存在しません。

## この章の成果

CI が OIDC の短命 credentials で同じ vp task を実行し、定期的な drift 検出が未検査も含めて報告する。

## 前提

- [02 再現できる TypeScript 開発: Nix、vp、CDK、cdkd、drift](/ja/chapters/02-toolchain.md)
- [04 HTTP API を足す: Lambda と API Gateway HTTP API](/ja/chapters/04-http-api.md)


## 構成案

pull request → check:all → infra:diff。main → deploy（標準の CDK/CloudFormation 経路）。schedule → drift。

使うサービス: IAM OIDC, CloudFormation, AWS CDK

## 扱う内容

- 02章の drift gate を実環境へ
- CloudFormation drift detection の検査範囲と nested stack
- cdkd と CloudFormation を同じ resource に交互に使わない
- rollback できるものとできないもの（data、schema）
- preview 環境の費用と片付け

## 分散システムとして見る点

deploy は原子的ではない。途中失敗で一部だけ更新された状態を前提に手順を書く。

## 完成に必要なソース

- OIDC role の CDK と trust policy の assertion
- CI 設定（同じ Nix lock と vp task）
- CloudFormation drift の polling/parser/report と fixture
- drift 注入と解消の実環境ラボ手順

## 調査の出発点にする一次情報

- [Detect unmanaged configuration changes to stacks and resources with drift detection](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-stack-drift.html) (執筆時に未再確認)
- [Detect drift on an entire CloudFormation stack](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/detect-drift-stack.html) (執筆時に未再確認)
- [cdkd: Drift](https://cdkd.dev/drift/index.html) (執筆時に未再確認)
- [cdkd: drift CLI reference](https://cdkd.dev/cli-drift/index.html) (執筆時に未再確認)
- [cdk diff](https://docs.aws.amazon.com/cdk/v2/guide/ref-cli-cmd-diff.html) (執筆時に未再確認)
