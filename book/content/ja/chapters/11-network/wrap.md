---
title: "11 Network: 費用、注意点、片付け"
---

# 11 Network: 費用、注意点、片付け

この章の最後のページです。つまずきやすいところ、本番で変えること、片付けの手順をまとめ、末尾に検証の内訳を置きます。料金の内訳は[しくみと実装](/ja/chapters/11-network/build.md)の「置いてあるだけでかかる料金」にあります。

## つまずきやすいところ

| こうなったら | ここを見る |
| --- | --- |
| デプロイがサブネットの作成で失敗する | AZ の名前が、自分のアカウントで使えるものかどうか。`aws ec2 describe-availability-zones` で確認して、`-c availabilityZones=...` で渡す |
| プライベートサブネットのコンテナがイメージを取得できない、AWS の API がいつまでも返ってこない | 経路がありません。`vp run net:plan` の「From Private1」で、その宛先が `unreachable` になっていないか |
| インターフェースエンドポイントを足したのに届かない | エンドポイントのセキュリティグループが、呼ぶ側からの 443 番を許しているか。VPC の DNS の設定が 2 つとも有効か |
| S3 には届くのに、別のリージョンのバケットには届かない | ゲートウェイエンドポイントが効くのは、同じリージョンのサービスだけです |
| `net:infra:destroy` が `StackHasActiveImportsError` で止まる | この VPC を使っているスタックが残っています。そちらを先に消す |
| 使っていないのに請求がある | NAT Gateway、インターフェースエンドポイント、パブリック IPv4 アドレスは、通信がなくても課金されます。`vp run net:plan` に渡した設定と、実際にデプロイした設定が同じか |
| VPC に入れた Lambda が外部の API を呼べない | [しくみと実装](/ja/chapters/11-network/build.md)の「Lambda を VPC に入れる条件」のとおりです。パブリックサブネットにつないでも出られません |
| `Invalid network settings` で止まる | メッセージに、どの項目がなぜ駄目かが出ています。CIDR は範囲の先頭のアドレスで書く（`10.20.1.0/16` ではなく `10.20.0.0/16`） |

表の 1 行目から 4 行目の症状は、ドキュメントの記述から組み立てたもので、実際に起こして確かめたわけではありません。

## 本番にするなら

- CIDR は、ほかのネットワークと重ならないように決めます。社内のネットワークや別の VPC と後でつなぐ場合、重なった範囲どうしには経路を書けません。AWS のドキュメントは `172.17.0.0/16` を避けるようにも書いています
- 出口を AZ ごとに持つか、持たないかを決めます。NAT Gateway を 1 つにするなら、その AZ が止まったときに何が止まるかを書き出しておきます
- ゲートウェイエンドポイントとインターフェースエンドポイントにポリシーを付けます。いまは、エンドポイントを通ればどのバケットにも届きます。ポリシーで、使うバケットや操作に絞れます
- AZ を 3 つにします。東京リージョンには AZ が 3 つ以上あります。計画の関数は、3 つ目を足しても番号が変わらないようにしてあります
- default のセキュリティグループは使いません。VPC には最初から 1 つ付いてきて、セキュリティグループを指定し忘れたリソースはそこに入ります。用途ごとに自分で作ります（12章）
- 反映の経路を AWS CDK CLI と CloudFormation にします。cdkd の公式ドキュメントは、cdkd を開発・テスト用途向けとし、本番には AWS CDK CLI を勧めています（02章）
- 支出の通知を付けます。01章の budget は、NAT Gateway を消し忘れたときに気づくための最後の網です。上限ではなく、通知です

## 片付け

<!-- section: 11.cleanup -->

```bash
vp run net:infra:destroy
```

VPC、サブネット、ルートテーブル、インターネットゲートウェイ、エンドポイントが消えます。NAT Gateway と Elastic IP アドレスを足していれば、それらも一緒に消えます。スタックの外に残るリソースは無いようにしてあり、テストも、残す設定（`DeletionPolicy`）がどのリソースにも付いていないことを確かめています。

この VPC を使うスタック（12章以降）は、先に消してください。残っていると、destroy は拒否されます。

時間課金の部品を足したまま放置したくないだけなら、VPC ごと消さなくても、`-c` なしでもう一度デプロイすれば外せます。どちらの場合も、最後は次のコマンドで自分の目で確かめるのが確実です。

```bash
aws ec2 describe-nat-gateways --region ap-northeast-1 --filter Name=state,Values=available
aws ec2 describe-vpc-endpoints --region ap-northeast-1
```

1 つ目が空で、2 つ目に Interface 型のエンドポイントが無ければ、この章のぶんの時間課金は止まっています。

あとに残るのは、cdkd の bootstrap で作った保存場所（02章）だけです。

::: details この章の検証メモ

**手元で確かめたこと。** CIDR の計算、設定の検証、経路のモデル、料金の入力、スタックのアサーション、インポートとエクスポートの対応のユニットテスト。型検査。`net:infra:synth`（既定の構成と、`-c egress=nat-per-az -c interfaceEndpoints=ecr.api,ecr.dkr,logs`）。`net:plan`（既定、`egress=nat`、`egress=nat-per-az`、`interfaceEndpoints=ecr.api,ecr.dkr,logs`、不正な設定）。本文の金額は、Price List の単価から `tools/src/pricing/calc.ts` が計算した値で、`examples/11-network/test/pricing.test.ts` が照合しています。AWS CLI の flag（`--filters`、`describe-nat-gateways` の `--filter`）は、devShell の AWS CLI 2.35.11 の help で確かめました。

**まだ確かめていないこと。** `net:infra:diff`、`net:infra:deploy`、`net:infra:drift`、`net:infra:destroy` は、実際の AWS では動かしていません。したがって、次はすべて実環境での確認待ちです。cdkd 0.296.28 がこのスタックを作って消せること。`AWS::EC2::VPCEndpoint` が Cloud Control API 経由で作れること。プライベートサブネットから、ゲートウェイエンドポイントとインターフェースエンドポイントを通して実際に届くこと。セキュリティグループとネットワーク ACL の振る舞い。`-c` を外してデプロイし直すと NAT Gateway が消えること。別のアプリのスタックから `Fn::ImportValue` で読めること、使われている間は destroy が拒否されること。既定の AZ 名（`ap-northeast-1a`、`ap-northeast-1c`）がどのアカウントでも使えるかどうか。「つまずきやすいところ」の症状。VPC に入れた Lambda の挙動は、ドキュメントを読んだだけで、サンプルもありません。

一次情報で確かめられなかったこと。パブリック IPv4 アドレスの無料利用枠（750 時間）が NAT Gateway の Elastic IP アドレスに適用されるかどうか。Price List には Regional NAT Gateway という別の SKU（1 時間 USD 0.062、1 GB USD 0.062）もありますが、この章では扱っておらず、仕様も読んでいません。Cloudflare 側に VPC に当たる体験があるかどうかも調べていないので、比較は書いていません。

cdkd が扱うリソースの種類。`v0.296.28` タグの `src/provisioning/register-providers.ts` では、`AWS::EC2::VPC`、`Subnet`、`InternetGateway`、`VPCGatewayAttachment`、`RouteTable`、`Route`、`SubnetRouteTableAssociation`、`SecurityGroup`、`EIP`、`NatGateway` が専用の実装（EC2 のプロバイダー）に登録されています。`AWS::EC2::VPCEndpoint` は登録が無く、未対応の一覧にも無いので、Cloud Control API 経由です。cdkd は、専用の実装が書き込まないプロパティをテンプレートが使うと、そのリソースを Cloud Control API に回します。そのため、このスタックは専用の実装が扱うプロパティだけを使い、テストでその一覧を固定しています。なお、npm の tarball には TypeScript のソースが入っていないため、GitHub のタグの archive を読みました。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 全体像 | `examples/11-network/infra/lib/network-stack.ts`、`infra/bin/app.ts` | `net:infra:synth` |
| アドレスの割り当て | `examples/11-network/src/cidr.ts`、`src/config.ts`、`src/plan.ts`、`test/cidr.test.ts`、`test/plan.test.ts` | `test:unit`、`net:plan` |
| パブリックとプライベートを分ける、ルートテーブルの 1 行 | `examples/11-network/infra/lib/network-stack.ts`、`infra/test/network-stack.test.ts` | `test:unit`、`net:infra:synth` |
| セキュリティグループとネットワーク ACL | `examples/11-network/infra/lib/network-stack.ts` | なし |
| プライベートサブネットから AWS を呼ぶ 3 つの方法 | `examples/11-network/infra/lib/network-stack.ts`、`src/reach.ts`、`test/reach.test.ts` | `test:unit`、`net:plan` |
| 置いてあるだけでかかる料金 | `examples/11-network/src/cost.ts`、`test/pricing.test.ts`、`scripts/plan.ts`、`data/pricing/` | `test:unit`、`net:plan` |
| AZ が 2 つあっても、リージョンは 1 つ | `examples/11-network/src/reach.ts`、`test/reach.test.ts` | `test:unit` |
| 手元で確かめる | `examples/11-network/scripts/plan.ts`、`src/report.ts`、`infra/test/network-stack.test.ts` | `net:plan`、`test:unit`、`net:infra:synth` |
| ほかのスタックから使う | `examples/11-network/src/exports.ts`、`infra/lib/import-network.ts`、`infra/test/import-network.test.ts` | `test:unit` |
| デプロイする | `examples/11-network/infra/bin/app.ts`、`cdk.json`、`tools/src/infra/` | `net:infra:diff`、`net:infra:deploy`、`net:infra:drift` |
| 片付け | `tools/src/infra/` | `net:infra:destroy` |

**一次情報**（確認日はすべて 2026-10-11）

- [What is Amazon VPC?](https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html)、[Subnets for your VPC](https://docs.aws.amazon.com/vpc/latest/userguide/configure-subnets.html)、[Subnet CIDR blocks](https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html)、[VPC CIDR blocks](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-cidr-blocks.html)
- [Route table concepts](https://docs.aws.amazon.com/vpc/latest/userguide/RouteTables.html)、[Internet gateways](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html)、[NAT gateway basics](https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-basics.html)
- [Security groups](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html)、[Default security groups](https://docs.aws.amazon.com/vpc/latest/userguide/default-security-group.html)、[Network ACLs](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html)、[Infrastructure security in Amazon VPC](https://docs.aws.amazon.com/vpc/latest/userguide/infrastructure-security.html)
- [Gateway endpoints](https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html)、[Interface VPC endpoints](https://docs.aws.amazon.com/vpc/latest/privatelink/create-interface-endpoint.html)、[AWS services that integrate with AWS PrivateLink](https://docs.aws.amazon.com/vpc/latest/privatelink/aws-services-privatelink-support.html)、[AWS::EC2::VPCEndpoint](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-vpcendpoint.html)、[AWS::EC2::Subnet](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-subnet.html)、[Get exported outputs from a deployed CloudFormation stack](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-stack-exports.html)
- [Amazon VPC pricing](https://aws.amazon.com/vpc/pricing/)、[AWS PrivateLink pricing](https://aws.amazon.com/privatelink/pricing/)
- AWS Price List bulk API: [EC2](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/ap-northeast-1/index.json)（NAT Gateway。約 445 MB）、[VPC](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/current/ap-northeast-1/index.json)（インターフェイスエンドポイント、パブリック IPv4 アドレス）
- [Giving Lambda functions access to resources in an Amazon VPC](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html)
- [Amazon ECR interface VPC endpoints](https://docs.aws.amazon.com/AmazonECR/latest/userguide/vpc-endpoints.html)、[Fargate task networking](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html)、[VPC endpoints for Systems Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/setup-create-vpc.html)、[Working with a DB instance in a VPC](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html)、[Amazon VPCs and ElastiCache security](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/VPCs.html)
- [AWS Availability Zones](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-availability-zones.html)、[AZ IDs](https://docs.aws.amazon.com/global-infrastructure/latest/regions/az-ids.html)、AWS Fault Isolation Boundaries: [Availability Zones](https://docs.aws.amazon.com/whitepapers/latest/aws-fault-isolation-boundaries/availability-zones.html)、[Regions](https://docs.aws.amazon.com/whitepapers/latest/aws-fault-isolation-boundaries/regions.html)
- cdkd v0.296.28: [src/provisioning](https://github.com/go-to-k/cdkd/tree/v0.296.28/src/provisioning)、[Cross-Stack References](https://github.com/go-to-k/cdkd/blob/v0.296.28/docs/cross-stack-references.md)、[Introduction](https://cdkd.dev/introduction/)

:::
