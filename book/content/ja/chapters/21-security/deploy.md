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

ここで 1 つ、守りの章として先に言っておくことがあります。**既定のデプロイには、リクエストの数を止めるものが何もありません。** CloudFront は cache しない設定なので、届いたリクエストは全部 Lambda まで行きます。`/token?sub=...` は認証なしで、誰にでも、どんな `sub` にでも署名します（この token を信用するものは、この章には何もありません。本物の service なら、発行の前に呼び出し元を認証します）。URL を知られて叩かれたら、叩かれたぶんだけ請求になります。金額は「お金の話」の「叩かれたとき」で計算します。

歯止めは 2 つ用意してあります。

1 つは web ACL です。IP アドレスごとに 5 分で 300 件。この章でいちばん効く歯止めですが、月 USD 8.00 かかるので、既定では付けていません。付け方は「WAF を付けられる入口、付けられない入口」の節に。

もう 1 つは、料金のかからない歯止めです。

```bash
vp run sec:infra:deploy -c reservedConcurrency=5
```

関数が同時に動く数を 5 つまでにします。超えたぶんは Lambda が断るので、Lambda の実行時間と、実行環境ごとに起きる secret の読み直しに天井ができます。IP アドレスは見ないので、叩かれている間は、本物の利用者も一緒に断られます。それと、CloudFront のリクエスト料金は、断られたぶんにもかかります。

新しいアカウントでこのデプロイが同時実行数のエラーで断られたら、Service Quotas でアカウントの上限を確かめてください。正直に言うと、どの値から断られるのかは、ここでは確かめられていません。URL を誰かに渡す前に、どちらかは付けておくのがおすすめです。

function URL を直接呼べないことも、見ておいてください。Lambda のコンソールで関数の URL を調べて、`curl` で呼ぶと、403 が返るはずです。

```bash
vp run sec:infra:drift
```

この stack の resource type は、どれも固定した版の cdkd が専用の実装を持っているものです。drift で何がどこまで比べられるかは、実行していないので分かりません。1 つだけ予告しておくと、rotation は drift ではありません。secret の値は template に無いので、比べる対象になりません。
