---
title: "11 Network: デプロイ"
---

# 11 Network: デプロイ

このページでは、VPC をほかの章のスタックから使えるようにしたうえで、実際の AWS にデプロイします。

## ほかのスタックから使う

<!-- section: 11.share -->

この VPC は、ほかの章のスタックが使うために作るものです。そこで、VPC やサブネットの ID をスタックの出力（output）にし、名前を付けてエクスポートしています。

<<< @/examples/11-network/infra/lib/network-stack.ts{outputs}

エクスポートの名前は、アカウントとリージョンの中で一意でなければならないので、スタックの名前を頭に付けています。

<<< @/examples/11-network/src/exports.ts{names}

使う側は、別の CDK アプリです。同じアプリの中なら CDK が参照を自動でつなぎますが、この本は章ごとにアプリを分けているので、名前で値を取りに行きます。そのための関数を用意しました。

<<< @/examples/11-network/infra/lib/import-network.ts{import}

値はすべて `Fn::ImportValue` になるので、synth のときに AWS へ問い合わせることはなく、実際の ID が入るのはデプロイのときです。テストは、この関数が取りに行く名前がすべて、VPC のスタックがエクスポートしている名前であることを確かめています。片方だけ名前を変えると、テストが落ちます。

### cdkd でのエクスポートの扱い

CloudFormation では、エクスポートと `Fn::ImportValue` は CloudFormation 自身の機能です。cdkd は CloudFormation を通さないので、同じことができるのかを、固定した版（0.296.28）のドキュメントとソースで調べました。

わかったのは次の 4 点です。

- cdkd は出力を、自分の state（S3 の `state.json`）に保存します。エクスポートの名前も一緒に記録します
- `Fn::ImportValue` は、cdkd がほかのスタックの state から解決します。どの cdkd のスタックもエクスポートしていない名前は、CloudFormation のエクスポートを探しに行きます
- エクスポートがまだ使われているスタックは、`cdkd destroy` が拒否します（`StackHasActiveImportsError`）。CloudFormation も、インポートされている間は、エクスポートしているスタックを消させません。cdkd も同じ守り方をしていて、強制する flag はありません。使っている側を先に消します
- `Fn::GetStackOutput` という、消すのを妨げない弱い参照もあります。cdkd のドキュメントは cdkd 独自のものと書いていますが、CloudFormation のドキュメントにも同じ名前の関数が載っています。両者の違いは調べておらず、この本では使っていません

わかっていないこともあります。この経路を、実際に cdkd で動かしてはいません。また、CloudFormation は、インポートされている出力の値を変えることも拒否します。cdkd が同じように拒否するのか（たとえば、使っているスタックが残っているときにサブネットを作り直す変更）は、確かめていません。12章を書くときに、最初に通す場所です。

## デプロイする

<!-- section: 11.deploy -->

最初は既定の構成でデプロイします。既定の構成は、時間課金のリソースを作りません。

```bash
vp run net:infra:diff
vp run net:infra:deploy
```

終わると、`VpcId` や `Private1SubnetId` など 12 個の出力が表示されます。次のコマンドで、ルートテーブルを確かめます。`vpc-xxxxxxxx` は、出力された `VpcId` に置き換えてください。

```bash
aws ec2 describe-route-tables --region ap-northeast-1 --filters Name=vpc-id,Values=vpc-xxxxxxxx
```

パブリックの 2 つには `0.0.0.0/0` の経路があり、プライベートの 2 つには無く、かわりに S3 と DynamoDB の prefix list 宛ての経路が入っているはずです。

時間課金の部品を足すときは、`-c` で渡します。

```bash
vp run net:infra:diff -c egress=nat
vp run net:infra:deploy -c egress=nat
```

このデプロイのあとは、置いてあるだけで 1 時間に USD 0.067（NAT Gateway と Elastic IP アドレス）かかります。

`-c` は、その 1 回のコマンドにしか効かないことに気をつけてください。次に `-c` なしでデプロイすると、計画は既定に戻り、NAT Gateway は消える変更として現れます。この動きは、NAT Gateway を止める方法としても使えます。必ず `diff` を先に見て、何が消えて何が増えるかを確かめてからデプロイしてください。

ドリフトの検査は、02章と同じです。

```bash
vp run net:infra:drift
```

この節のコマンドは、まだ実際の AWS で通せていません。cdkd が見るリソースの種類のうち、VPC、サブネット、ルートテーブル、経路、インターネットゲートウェイ、NAT Gateway、Elastic IP アドレス、セキュリティグループは、cdkd が専用の実装を持っています。`AWS::EC2::VPCEndpoint` だけは専用の実装がなく、Cloud Control API 経由になります。ここが通るかどうかが、最初に確かめたい点です。
