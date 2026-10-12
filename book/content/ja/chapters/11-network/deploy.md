---
title: "11 Network: デプロイ"
---

# 11 Network: デプロイ

## ほかの stack から使う

<!-- section: 11.share -->

この VPC は、ほかの章の stack が使うためのものです。なので、ID を output して、名前を付けて export しています。

<<< @/examples/11-network/infra/lib/network-stack.ts{outputs}

export の名前は、アカウントとリージョンの中で一意でなければなりません。stack の名前を頭に付けています。

<<< @/examples/11-network/src/exports.ts{names}

使う側は、別の CDK アプリです。同じアプリの中なら CDK が参照を自動でつないでくれますが、章ごとにアプリを分けているこの本では、名前で取りに行きます。そのための関数を用意しました。

<<< @/examples/11-network/infra/lib/import-network.ts{import}

全部が `Fn::ImportValue` になるので、synth のときに AWS へ問い合わせません。実際の ID が入るのはデプロイのときです。テストは、この関数が取りに行く名前がすべて、VPC の stack が export している名前であることを確かめています。片方だけ名前を変えると落ちます。

### cdkd は export をどう扱うのか

CloudFormation なら、export と `Fn::ImportValue` は CloudFormation 自身の機能です。cdkd は CloudFormation を通さないので、同じことができるのかを、固定した版（0.296.28）のドキュメントとソースで調べました。

わかったこと。

- cdkd は output を、自分の state（S3 の `state.json`）に保存します。export の名前も一緒に記録します
- `Fn::ImportValue` は、cdkd がほかの stack の state から解決します。どの cdkd の stack も export していない名前は、CloudFormation の export を探しに行きます
- export がまだ使われている stack は、`cdkd destroy` が拒否します（`StackHasActiveImportsError`）。CloudFormation も、import されている間は export している stack を消させません。同じ守り方で、強制する flag はありません。先に、使っている側を消します
- `Fn::GetStackOutput` という、消すのを妨げない弱い参照もあります。cdkd のドキュメントは cdkd 独自のものと書いていますが、CloudFormation のドキュメントにも同じ名前の関数が載っています。両者の違いは調べておらず、この本では使っていません

わからないこと。この経路を、実際に cdkd で動かしてはいません。CloudFormation は、import されている output の値を変えることも拒否します。cdkd が同じように拒否するのか（たとえば、使っている stack が残っているときに subnet を作り直す変更）は、確かめていません。12章を書くときに、最初に通す場所です。

## デプロイする

<!-- section: 11.deploy -->

まず既定の構成で。これは時間課金のリソースを作りません。

```bash
vp run net:infra:diff
vp run net:infra:deploy
```

終わると、`VpcId` や `Private1SubnetId` など 12 個の output が出ます。route table を見てみましょう。`vpc-xxxxxxxx` は、出力された `VpcId` に置き換えてください。

```bash
aws ec2 describe-route-tables --region ap-northeast-1 --filters Name=vpc-id,Values=vpc-xxxxxxxx
```

public の 2 つには `0.0.0.0/0` の経路があり、private の 2 つには無く、かわりに S3 と DynamoDB の prefix list 宛ての経路が入っているはずです。

時間課金の部品を足すときは、`-c` で渡します。

```bash
vp run net:infra:diff -c egress=nat
vp run net:infra:deploy -c egress=nat
```

ここからは、置いてあるだけで 1 時間に USD 0.067（NAT Gateway と Elastic IP アドレス）かかります。

気をつけたいのは、`-c` はその 1 回のコマンドにしか効かないことです。次に `-c` なしで deploy すると、計画は既定に戻って、NAT Gateway は消える変更として現れます。これは止め方としても使えます。必ず `diff` を先に見て、何が消えて何が増えるかを確かめてからにしてください。

drift の検査は、02章と同じです。

```bash
vp run net:infra:drift
```

正直に言うと、この節のコマンドは、まだ実際の AWS で通せていません。cdkd が見るリソースの種類のうち、VPC、subnet、route table、経路、internet gateway、NAT Gateway、Elastic IP アドレス、security group は、cdkd が専用の実装を持っています。`AWS::EC2::VPCEndpoint` だけは専用の実装がなく、Cloud Control API 経由になります。ここが通るかどうかが、最初に確かめたい点です。
