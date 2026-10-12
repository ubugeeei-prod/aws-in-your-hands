---
title: "11 Network: VPC、subnet、NAT、endpoint"
revision: 2
---

# 11 Network: VPC、subnet、NAT、endpoint

ここまでの章では、ネットワークを設計する場面が一度もありませんでした。この章で初めて、自分のネットワークを作ります。

作るのは、2 つの Availability Zone にまたがる小さな VPC です。12章のコンテナ、13章のデータベース、23章の EC2 を、この VPC の上に置きます。

料金について先に書いておくと、この章の既定の構成には、**置いてあるだけで料金がかかるものが 1 つもありません**。そうなるように作ってあります。ただし、設定を 1 つ切り替えれば NAT Gateway やインターフェースエンドポイントを足せるようにもしてあり、足した部品は使っていなくても時間単位で課金されます。NAT Gateway を 1 つ足すと月におよそ USD 49、インターフェースエンドポイントを 3 つ足すと月におよそ USD 61 です（東京、730 時間。内訳は[しくみと実装](/ja/chapters/11-network/build.md)の「置いてあるだけでかかる料金」にあります）。試したら、その日のうちに消してください。

前提は [02章](/ja/chapters/02-toolchain.md)だけです。コードは `examples/11-network/` にあります。

## VPC が要る場面

<!-- section: 11.when -->

03章から 06章で使った CloudFront、S3、API Gateway、Lambda、DynamoDB、Cognito は、どれも AWS が用意した入口に HTTPS で話しかけるサービスです。使う側がネットワークを用意する必要はなく、Lambda も、何も設定しなければインターネットに出られます。

VPC（Virtual Private Cloud）は、リージョンの中に作る自分専用の IP ネットワークです。VPC が要るのは、次のような、VPC の中にしか置けないものを使うときです。

- RDS や Aurora のデータベース（13章）
- ElastiCache のノードベースのクラスター（[14章](/ja/chapters/14-kv-cache.md)。ElastiCache Serverless には、VPC の設定が要らないパブリックエンドポイントもあります）
- ECS のタスク（12章）
- EC2 のインスタンス（23章）

どれも IP アドレスを持ち、どこかのサブネットに置かれるので、置く場所として VPC が必要になります。

Lambda、DynamoDB、S3、API Gateway で足りているなら、VPC は作らないほうがよい構成です。VPC を作っても速くも安全にもならず、設計するものと、料金のかかる部品が増えるだけだからです。

VPC そのものに料金はかからず、かかるのは中に置く一部の部品です。どの部品にいくらかかるかは、[しくみと実装](/ja/chapters/11-network/build.md)のページで何度も取り上げます。

## 全体像

<!-- section: 11.architecture -->

```figure
caption: ap-northeast-1 の VPC AihNetwork は、ap-northeast-1a と ap-northeast-1c の 2 つの AZ に、パブリックとプライベートのサブネットを 1 つずつ持つ
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
edge priv1 -> gwep: ルートテーブルに経路
edge priv2 -> gwep
group vpc: VPC AihNetwork 10.20.0.0/16 = pub1, pub2, priv1, priv2, nat, iface, igw, gwep
group opt: 頼まなければ作られない (時間で課金) = nat, iface
```

図を読むのに必要な用語は 3 つです。

サブネット（subnet）は、VPC のアドレス範囲を切り分けたものです。1 つのサブネットは、1 つの Availability Zone（AZ）の中にあります。AZ は、リージョンの中にある、電源もネットワークも独立したデータセンターのまとまりです。

パブリックサブネット（public subnet）はインターネットへの経路があるサブネットで、プライベートサブネット（private subnet）はその経路がないサブネットです。2 つの違いは、ルートテーブル（route table）に書く 1 行の経路だけです。その 1 行は[しくみと実装](/ja/chapters/11-network/build.md)で見ます。

この章のプライベートサブネットは、既定では VPC の外へ出る経路をまったく持ちません。AWS のドキュメントは、外への経路がないサブネットを isolated subnet と呼び、NAT を通して外へ出られるものを private subnet と呼び分けています。この本では、設定の切り替えで NAT を足せるので、どちらもプライベートと呼ぶことにします。

VPC と、インターネットへの出入口を作るコードは次のとおりです。

<<< @/examples/11-network/infra/lib/network-stack.ts{vpc}

インターネットゲートウェイ（internet gateway）は VPC に取り付ける出入口で、それ自体に料金はかかりません。DNS の 2 つの設定は、後でインターフェースエンドポイントを足すときに必要になるので、最初から有効にしてあります。

### L1 で書いた理由

CDK には `Vpc` という高水準のコンストラクトがあり、数行で同じようなものを作れます。この章ではそれを使わず、`CfnVPC` や `CfnSubnet` のように、CloudFormation のリソースと 1 対 1 に対応するコンストラクト（L1）を並べました。

理由は 2 つあります。1 つは、ルートテーブルの 1 行がサブネットの性格を決めるところを隠したくなかったからです。もう 1 つは `Vpc` の既定値で、固定した版（aws-cdk-lib 2.273.0）の型定義には、`natGateways` の既定は「AZ ごとに 1 つ」と書いてあります。既定値を確かめずに `new ec2.Vpc(...)` と書くと、この章の構成なら月に USD 98 ほどの NAT Gateway が、頼んでいないのに作られます。

仕組みがわかったあとの本番のコードでは、`Vpc` に `natGateways: 0` とサブネットの種類を渡して書くほうが短く済みます。

## アドレスの割り当て

<!-- section: 11.cidr -->

VPC を作るときに最初に決めるのは、アドレスの範囲です。範囲は `10.20.0.0/16` のように書きます（CIDR 記法）。`/16` は「先頭の 16 ビットが共通」という意味で、この範囲には 65,536 個のアドレスが入ります。

設定は、Zod のスキーマで受け取ります。

<<< @/examples/11-network/src/config.ts{schema}

このスキーマには、型だけでは守れない条件がいくつも入っています。`cidr` の型は `string` ですが、範囲の先頭になっていない `"10.20.1.0/16"` も、プライベートな範囲ではない `"8.8.0.0/16"` も、型の上では同じ `string` です。スキーマはどちらも拒否します。サブネットの大きさが AZ の数に対して足りるかどうかも、スキーマで確かめます。

AZ は名前（`ap-northeast-1a`）で指定します。ただし東京リージョンでは、2025 年 11 月より前に作ったアカウントだと、同じ名前がアカウントごとに別の場所を指します。自分のアカウントで使える名前は、次のコマンドでわかります（認証情報が要ります）。

```bash
aws ec2 describe-availability-zones --region ap-northeast-1
```

既定の 2 つと違っていたら、`-c availabilityZones=...` で渡してください。

### CIDR の計算は純粋な関数に

「2 つの範囲が重なっているか」「この範囲に /20 はいくつ入るか」は、AWS とは関係のない算数です。そこで、純粋な関数にしてテストを書きました。

<<< @/examples/11-network/src/cidr.ts{relations}

この計算には落とし穴が 1 つあります。JavaScript のビット演算は符号つき 32 ビットなので、`192.168.0.0` のような大きなアドレスを `<<` で組み立てると負の数になります。このコードは掛け算と割り算で計算していて、テストは `128.0.0.0` より上のアドレスを数値にして元に戻せることを確かめています。

サブネットで実際に使えるアドレスは、範囲の大きさより 5 つ少なくなります。AWS が、どのサブネットでも先頭の 4 つと最後の 1 つを自分用に確保するからです。

<<< @/examples/11-network/src/cidr.ts{usable}

### 割り方

<<< @/examples/11-network/src/plan.ts{plan}

VPC の範囲を半分に割り、アドレスの小さいほうの半分をパブリックに、大きいほうの半分をプライベートに使います。それぞれの半分の中で、AZ ごとに /20 を 1 つずつ取ります。`10.20.0.0/16` なら、16 個ある /20 のうち 4 つしか使いません。

詰めて並べなかったのは、後から足せるようにするためです。3 つ目の AZ を足すときも、データベース専用のサブネットのような新しい層を足すときも、いまあるサブネットの番号を変えずに済みます。サブネットの CIDR を後から変えると、サブネットは中に置いたものごと作り直しになるので、最初に余らせておくのがいちばん安上がりです。

`planNetwork` は AWS を呼ばず、設定から計画を作るだけの関数です。スタックは、この計画をそのままリソースにします。テストは、設定をいろいろ変えても、どの 2 つのサブネットも重ならず、すべてが VPC の中に収まることを確かめています。
