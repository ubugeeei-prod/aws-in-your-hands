---
title: "21 守り、統制する: WAF、Inspector、GuardDuty、secret、KMS、CloudTrail、Config、Organizations"
generated: true
---

<!-- 生成ファイル。編集しないこと。生成元: data/chapters.json (tools/src/book/generate.ts) -->

# 21 守り、統制する: WAF、Inspector、GuardDuty、secret、KMS、CloudTrail、Config、Organizations

> [!NOTE]
> この章は **planned（未執筆）** です。以下は執筆前のアウトラインで、本文でも動くサンプルでもありません。`examples/21-security` はまだ存在しません。

## この章の成果

個人利用で入れるものと、組織になったら必要なものを分けて設定できる。

## 前提

- [06 ログインを足す: Cognito と認可](/ja/chapters/06-auth.md)
- [20 変更を届ける: CI/CD、OIDC、環境、preview、rollback、drift](/ja/chapters/20-shipping.md)


## 構成案

CloudFront + WAF。secret は Secrets Manager。監査は CloudTrail。脆弱性は Inspector、脅威は GuardDuty。

使うサービス: WAF, Inspector, GuardDuty, Secrets Manager, KMS, CloudTrail, AWS Config, Organizations

## 扱う内容

- Inspector（脆弱性検査）と GuardDuty（脅威検出）は別物
- WAF を付けられる入口と付けられない入口
- secret ごと・key ごとの月額
- SCP は権限を与えず上限を決める

## 分散システムとして見る点

IAM の変更は結果整合。直後の拒否/許可を前提にしない。

## 完成に必要なソース

- WAF rule の CDK
- secret を読む adapter と rotation の手順
- IAM policy の wildcard を検出する assertion

## 調査の出発点にする一次情報

- [What is Amazon Inspector?](https://docs.aws.amazon.com/inspector/latest/user/what-is-inspector.html) (執筆時に未再確認)
- [What is Amazon GuardDuty?](https://docs.aws.amazon.com/guardduty/latest/ug/what-is-guardduty.html) (執筆時に未再確認)
- [Security best practices in IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html) (執筆時に未再確認)
