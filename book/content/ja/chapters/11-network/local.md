---
title: "11 Network: 手元で動かす"
---

# 11 Network: 手元で動かす

## 手元で確かめる

<!-- section: 11.local -->

ネットワークはデプロイしないと何もわからない、と思われがちです。しかし、[しくみと実装](/ja/chapters/11-network/build.md)までに決めたアドレスの割り当て、経路、料金は、どれも手元で確かめられます。AWS のアカウントも要りません。

```bash
vp run net:plan
```

このタスクは、設定から計画を作り、サブネット、経路、時間課金の部品、月額を表示します。

<<< @/examples/11-network/src/report.ts{report}

構成を変えるとどうなるかも、同じタスクで見られます。

```bash
vp run net:plan egress=nat
vp run net:plan interfaceEndpoints=ecr.api,ecr.dkr,logs
vp run net:plan cidr=10.20.0.0/24 subnetPrefix=26
```

NAT Gateway を足す前に月額が画面に出るので、請求書を見て初めて知ることにはなりません。

テストと synth は、次のタスクで実行します。

```bash
vp run test:unit
vp run net:infra:synth
```

スタックのテストは、既定の構成のテンプレートに NAT Gateway と Elastic IP アドレスが無いことを確かめています。誰かが既定値を変えて時間課金のリソースが紛れ込むと、このテストが落ちます。ほかに、インターネットへの経路がパブリックにしかないこと、ゲートウェイエンドポイントがプライベートのルートテーブルにだけ付いていること、スタックを消したときに残るリソースが無いこと、synth が AWS に問い合わせないことも確かめています。

手元では再現しないものもあります。

- 実際にパケットが届くかどうか。モデルはルートテーブルしか見ていません
- セキュリティグループとネットワーク ACL の評価
- インターフェースエンドポイントの DNS の解決
- 自分のアカウントで、その AZ 名が使えるかどうか
- cdkd がテンプレートのとおりにリソースを作れること
