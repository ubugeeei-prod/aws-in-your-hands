---
title: "11 Network: VPC、subnet、NAT、endpoint"
revision: 1
---

# 11 Network: VPC、subnet、NAT、endpoint

ここまでの章は、ネットワークを 1 行も設計せずに来ました。この章で初めて、自分のネットワークを作ります。

作るのは、2 つの Availability Zone にまたがる小さな VPC です。12章のコンテナ、13章のデータベース、23章の EC2 が、この上に乗ります。

先にお金の話を 1 つ。この章の既定の構成には、**置いてあるだけで料金がかかるものが 1 つもありません**。そうなるように作りました。ただし、切り替え 1 つで NAT Gateway や interface endpoint を足せるようにもしてあって、足したぶんは使っていなくても時間で課金されます。NAT Gateway を 1 つ足すと月におよそ USD 49、interface endpoint を 3 つ足すと月におよそ USD 61 です（東京、730 時間、内訳は「置いてあるだけでかかるお金」に）。試したら、その日のうちに消してくださいね。

前提は [02章](/ja/chapters/02-toolchain.md)だけです。コードは `examples/11-network/` にあります。

## VPC が要るのはいつ？

<!-- section: 11.when -->

03章から 06章で使ったのは、CloudFront、S3、API Gateway、Lambda、DynamoDB、Cognito でした。どれも、AWS が用意した入口に HTTPS で話しかけるサービスです。あなたの側にネットワークは要りません。Lambda も、何も設定しなければインターネットに出られます。

VPC（Virtual Private Cloud）は、リージョンの中に作る自分専用の IP ネットワークです。要るのは、**VPC の中にしか置けないもの**を使うときです。

- RDS や Aurora のデータベース（13章）
- ElastiCache の node ベースの cluster（[14章](/ja/chapters/14-kv-cache.md)。ElastiCache Serverless には、VPC の設定が要らない public endpoint もあります）
- ECS の task（12章）
- EC2 の instance（23章）

これらは IP アドレスを持って、どこかの subnet に住みます。住む場所が要るわけです。

逆に言うと、Lambda と DynamoDB と S3 と API Gateway で足りているなら、VPC は作らないのが正解です。作っても速くも安全にもなりません。設計するものと、お金のかかる部品が増えるだけです。

VPC そのものに料金はありません。かかるのは、中に置く一部の部品です。この章の後半は、ほぼその話になります。

## 全体像

<!-- section: 11.architecture -->

```figure
caption: ap-northeast-1 の VPC AihNetwork は、ap-northeast-1a と ap-northeast-1c の 2 つの zone に、public と private の subnet を 1 つずつ持つ
direction: right
node pub1: Public1 | zone 1a, 10.20.0.0/20
node pub2: Public2 | zone 1c, 10.20.16.0/20
node priv1: Private1 | zone 1a, 10.20.128.0/20, 外への経路なし
node priv2: Private2 | zone 1c, 10.20.144.0/20, 外への経路なし
node nat: NAT gateway + Elastic IP | -c egress=nat または nat-per-az
node iface: interface endpoints | -c interfaceEndpoints=ecr.api,ecr.dkr,logs
node igw: internet gateway | 料金なし
node gwep: gateway endpoints | S3, DynamoDB, 料金なし
edge pub1 -> igw: 0.0.0.0/0
edge pub2 -> igw: 0.0.0.0/0
edge priv1 -> gwep: route table に route
edge priv2 -> gwep
group vpc: VPC AihNetwork 10.20.0.0/16 = pub1, pub2, priv1, priv2, nat, iface, igw, gwep
group opt: 頼まなければ作られない (時間で課金) = nat, iface
```

言葉を 3 つだけ。

**subnet** は、VPC のアドレス範囲を切り分けたものです。1 つの subnet は 1 つの Availability Zone（AZ）の中にあります。AZ は、リージョンの中にある、電源もネットワークも独立したデータセンターのまとまりです。

**public subnet** は、インターネットへの経路がある subnet。**private subnet** は、それがない subnet です。違いはそれだけで、後で見るとおり、たった 1 行の経路で決まります。

この章の private subnet は、既定では VPC の外へ出る経路をまったく持ちません。AWS のドキュメントはこれを isolated subnet と呼び、NAT を通して外へ出られるものを private subnet と呼び分けています。この本では、切り替えで NAT を足せるので、どちらも private と呼ぶことにします。

VPC と、インターネットへの出入口はこうなります。

<<< @/examples/11-network/infra/lib/network-stack.ts{vpc}

internet gateway は VPC に取り付ける出入口で、それ自体に料金はありません。DNS の 2 つの設定は、後で interface endpoint を足すときに必要になるので、最初から有効にしてあります。

### なぜ L1 で書いたのか

CDK には `Vpc` という高水準の construct があって、数行で同じようなものが作れます。この章では使わず、`CfnVPC` や `CfnSubnet` といった、CloudFormation のリソースと 1 対 1 に対応する construct（L1）を並べました。

理由は 2 つ。1 つは、route table の 1 行が subnet の性格を決める、というところを隠したくなかったから。もう 1 つは、`Vpc` の既定値です。固定した版（aws-cdk-lib 2.273.0）の型定義には、`natGateways` の既定は「AZ ごとに 1 つ」と書いてあります。何も考えずに `new ec2.Vpc(...)` と書くと、この章の構成なら月に USD 98 ほどの NAT Gateway が黙って付いてきます。

仕組みがわかったら、本番では `Vpc` に `natGateways: 0` と subnet の種類を渡して書くほうが短くて済みます。

## アドレスを割る

<!-- section: 11.cidr -->

VPC を作るとき、最初に決めるのはアドレスの範囲です。`10.20.0.0/16` のように書きます（CIDR 記法）。`/16` は「先頭の 16 ビットが共通」という意味で、65,536 個のアドレスが入ります。

設定は、Zod の schema で受けます。

<<< @/examples/11-network/src/config.ts{schema}

型だけでは守れないことが、いくつも入っています。`cidr` の型は `string` ですが、`"10.20.1.0/16"`（範囲の先頭になっていない）も、`"8.8.0.0/16"`（プライベートな範囲ではない）も `string` です。どちらも schema が落とします。subnet の大きさが AZ の数に対して足りるかどうかも、ここで確かめます。

AZ は名前（`ap-northeast-1a`）で指定します。1 つ注意があって、東京リージョンでは、2025 年 11 月より前に作ったアカウントだと、同じ名前がアカウントごとに別の場所を指します。あなたのアカウントで使える名前は、次のコマンドでわかります（認証情報が要ります）。

```bash
aws ec2 describe-availability-zones --region ap-northeast-1
```

既定の 2 つと違っていたら、`-c availabilityZones=...` で渡してください。

### CIDR の計算は、ただの関数にする

「2 つの範囲が重なっているか」「この範囲に /20 はいくつ入るか」は、AWS とは関係のない算数です。なので、純粋な関数にしてテストを書きました。

<<< @/examples/11-network/src/cidr.ts{relations}

地味ですが、落とし穴が 1 つあります。JavaScript のビット演算は符号つき 32 ビットなので、`192.168.0.0` のような大きなアドレスを `<<` で組み立てると負の数になります。このコードは掛け算と割り算で計算していて、テストは `128.0.0.0` より上のアドレスで往復を確かめています。

subnet で実際に使えるアドレスは、見た目より 5 つ少なくなります。AWS が、どの subnet でも先頭の 4 つと最後の 1 つを自分用に取っておくからです。

<<< @/examples/11-network/src/cidr.ts{usable}

### 割り方

<<< @/examples/11-network/src/plan.ts{plan}

VPC を半分に割って、下半分を public、上半分を private にしています。それぞれの半分の中で、AZ ごとに /20 を 1 つずつ。`10.20.0.0/16` なら 16 個の /20 のうち 4 つしか使っていません。

詰めて並べなかったのは、後で足せるようにするためです。3 つ目の AZ を足すときも、新しい層（たとえばデータベース専用の subnet）を足すときも、いまある subnet の番号を変えずに済みます。subnet の CIDR を後から変えると、subnet は作り直しになります。中に住んでいるものごと、です。最初に余らせておくのがいちばん安上がりです。

`planNetwork` は、AWS を呼ばず、設定から計画を作るだけの関数です。stack はこの計画をそのままリソースにします。テストは、設定をいろいろ変えても「どの 2 つの subnet も重ならない」「全部 VPC の中に収まる」ことを確かめています。
