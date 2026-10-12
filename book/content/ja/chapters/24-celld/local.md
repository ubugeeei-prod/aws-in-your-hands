---
title: "24 Self-hosting: 手元で動かす"
---

# 24 Self-hosting: 手元で動かす

## 手元で確かめられること、られないこと

<!-- section: 24.local -->

```bash
vp run test:unit
vp run celld:plan nodes=3
vp run celld:render
vp run celld:infra:synth -c nodes=3
vp run celld:fetch
```

テストが確かめているのは、次のことです。

- stack が作るもの。既定では時間課金の resource が 0 個であること、inbound が group 自身からの 1 行だけであること、IMDSv2 が必須であること、bucket と volume が残る設定であること、role に `*` が無いこと
- unit と install script。celld の 2 つの要求（再起動の間隔と停止の猶予）を破れないこと、digest の合わない archive を拒むこと（本物の script を bash で動かします）
- 更新の順序。次の節で話します
- node を失ったときの検査の判定。その次の節で

確かめられないのは、celld そのものです。celld には `celld dev` という、cloud の bucket なしで node を 1 つ動かすコマンドがあります。application を書くなら、まずそれで動かすのがよさそうです。ただ、この章の執筆では binary を実行していないので、その使い心地は書けません。
