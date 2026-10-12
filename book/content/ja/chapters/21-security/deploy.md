---
title: "21 Security: デプロイ"
---

# 21 Security: デプロイ

## デプロイして確かめる

<!-- section: 21.deploy -->

既定の stack だけなら、流れはいつもどおりです。

```bash
vp run sec:infra:diff
vp run sec:infra:deploy
vp run sec:smoke
```

`sec:smoke` は、CloudFront の URL に対して、`/health`、token の発行、検証、署名を書き換えた token の拒否、POST の拒否を順に確かめます。token の発行は、Secrets Manager を 1 回読みます（課金対象の API 呼び出しです）。

function URL を直接呼べないことも、見ておいてください。Lambda のコンソールで関数の URL を調べて、`curl` で呼ぶと、403 が返るはずです。

```bash
vp run sec:infra:drift
```

この stack の resource type は、どれも固定した版の cdkd が専用の実装を持っているものです。drift で何がどこまで比べられるかは、実行していないので分かりません。1 つだけ予告しておくと、rotation は drift ではありません。secret の値は template に無いので、比べる対象になりません。
