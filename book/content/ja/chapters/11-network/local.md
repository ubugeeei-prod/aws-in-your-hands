---
title: "11 Network: 手元で動かす"
---

# 11 Network: 手元で動かす

## 手元で確かめる

<!-- section: 11.local -->

ネットワークは、デプロイしないと何もわからない、と思われがちです。でも、ここまで見てきた判断は全部、手元で確かめられます。AWS のアカウントも要りません。

```bash
vp run net:plan
```

設定から計画を作って、subnet、経路、時間課金の部品、月額を表示します。

<<< @/examples/11-network/src/report.ts{report}

構成を変えたらどうなるかも、同じタスクで見られます。

```bash
vp run net:plan egress=nat
vp run net:plan interfaceEndpoints=ecr.api,ecr.dkr,logs
vp run net:plan cidr=10.20.0.0/24 subnetPrefix=26
```

NAT Gateway を足す前に、月額が画面に出ます。請求書で知るより、ずっといいですよね。

テストと synth はこうです。

```bash
vp run test:unit
vp run net:infra:synth
```

stack のテストは、既定の構成の template に NAT Gateway と Elastic IP アドレスが無いことを見ています。誰かが既定値を変えて時間課金のリソースが紛れ込んだら、ここで落ちます。ほかに、インターネットへの経路が public にしかないこと、gateway endpoint が private の route table にだけ付いていること、stack を消したときに残るリソースが無いこと、synth が AWS に問い合わせないことも見ています。

手元で再現しないものも、はっきりさせておきます。

- 実際にパケットが届くかどうか。モデルは route table しか見ていません
- security group と network ACL の評価
- interface endpoint の DNS の解決
- あなたのアカウントで、その AZ 名が使えるかどうか
- cdkd が template のとおりにリソースを作れること
