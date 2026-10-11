---
title: "19 本番の挙動を見る: CloudWatch、OpenTelemetry、RUM、Synthetics"
generated: true
---

<!-- 生成ファイル。編集しないこと。生成元: data/chapters.json (tools/src/book/generate.ts) -->

# 19 本番の挙動を見る: CloudWatch、OpenTelemetry、RUM、Synthetics

> [!NOTE]
> この章は **planned（未執筆）** です。以下は執筆前のアウトラインで、本文でも動くサンプルでもありません。`examples/19-observability` はまだ存在しません。

## この章の成果

1 つのリクエストを browser から Lambda、queue の worker まで同じ ID で追える。

## 前提

- [04 HTTP API を足す: Lambda と API Gateway HTTP API](/ja/chapters/04-http-api.md)

読書経路: `shortest`

## 構成案

構造化ログ → CloudWatch Logs。trace は OpenTelemetry → X-Ray。alarm → 通知。

使うサービス: CloudWatch, X-Ray, CloudWatch RUM, CloudWatch Synthetics

## 扱う内容

- 04章のログ形式を土台にする
- 新規計装は OpenTelemetry。X-Ray SDK/daemon の寿命と X-Ray service は別
- log の取込みと保存の費用
- 症状に対する alarm

## 分散システムとして見る点

trace は sampling される。欠けた span を障害と誤読しない。

## 完成に必要なソース

- 計装の設定
- alarm の CDK と assertion
- log 量から費用を出す計算入力

## 調査の出発点にする一次情報

- [CloudWatch RUM](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-RUM.html) (執筆時に未再確認)
- [X-Ray SDK and daemon support timeline](https://docs.aws.amazon.com/xray/latest/devguide/xray-sdk-daemon-timeline.html) (執筆時に未再確認)
