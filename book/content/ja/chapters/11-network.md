---
title: "11 本当に必要なネットワーク: VPC、subnet、NAT、endpoint"
revision: 1
---

# 11 本当に必要なネットワーク: VPC、subnet、NAT、endpoint

ここまでの章は、ネットワークを 1 行も設計せずに来ました。この章で初めて、自分のネットワークを作ります。

作るのは、2 つの Availability Zone にまたがる小さな VPC です。12章のコンテナ、13章のデータベース、23章の EC2 が、この上に乗ります。

先にお金の話を 1 つ。この章の既定の構成には、**置いてあるだけで料金がかかるものが 1 つもありません**。そうなるように作りました。ただし、切り替え 1 つで NAT Gateway や interface endpoint を足せるようにもしてあって、足したぶんは使っていなくても時間で課金されます。NAT Gateway を 1 つ足すと月におよそ USD 49、interface endpoint を 3 つ足すと月におよそ USD 61 です（東京、730 時間、内訳は「置いてあるだけでかかるお金」に）。試したら、その日のうちに消してくださいね。

前提は [02章](/ja/chapters/02-toolchain.md)だけです。コードは `examples/11-network/` にあります。

## VPC が要るのはいつ？

<!-- section: 11.when -->

03章から 06章で使ったのは、CloudFront、S3、API Gateway、Lambda、DynamoDB、Cognito でした。どれも、AWS が用意した入口に HTTPS で話しかけるサービスです。あなたの側にネットワークは要りません。Lambda も、何も設定しなければインターネットに出られます。

VPC（Virtual Private Cloud）は、リージョンの中に作る自分専用の IP ネットワークです。要るのは、**VPC の中にしか置けないもの**を使うときです。

- RDS や Aurora のデータベース（13章）
- ElastiCache の node ベースの cluster（14章の予定。ElastiCache Serverless には、VPC の設定が要らない public endpoint もあります）
- ECS の task（12章）
- EC2 の instance（23章）

これらは IP アドレスを持って、どこかの subnet に住みます。住む場所が要るわけです。

逆に言うと、Lambda と DynamoDB と S3 と API Gateway で足りているなら、VPC は作らないのが正解です。作っても速くも安全にもなりません。設計するものと、お金のかかる部品が増えるだけです。

VPC そのものに料金はありません。かかるのは、中に置く一部の部品です。この章の後半は、ほぼその話になります。

## 全体像

<!-- section: 11.architecture -->

```text
Region ap-northeast-1
└─ VPC AihNetwork  10.20.0.0/16
   ├─ internet gateway                                    (no charge)
   ├─ zone ap-northeast-1a
   │   ├─ Public1   10.20.0.0/20    route table: 0.0.0.0/0 -> internet gateway
   │   └─ Private1  10.20.128.0/20  route table: no route out of the VPC
   ├─ zone ap-northeast-1c
   │   ├─ Public2   10.20.16.0/20   route table: 0.0.0.0/0 -> internet gateway
   │   └─ Private2  10.20.144.0/20  route table: no route out of the VPC
   ├─ gateway endpoints: S3, DynamoDB                     (no charge)
   │     a route in the two private route tables
   └─ not created unless asked for                        (billed by the hour)
         NAT gateway + Elastic IP     -c egress=nat | nat-per-az
         interface endpoints          -c interfaceEndpoints=ecr.api,ecr.dkr,logs
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

理由は 2 つ。1 つは、route table の 1 行が subnet の性格を決める、というところを隠したくなかったから。もう 1 つは、`Vpc` の既定値です。固定した版（aws-cdk-lib 2.273.0）の型定義には、`natGateways` の既定は「AZ ごとに 1 つ」と書いてあります。何も考えずに `new Vpc(...)` と書くと、この章の構成なら月に USD 98 ほどの NAT Gateway が黙って付いてきます。

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

## public と private を分けるのは、route table の 1 行

<!-- section: 11.routes -->

subnet には route table を 1 つ関連付けます。「この宛先はここへ送る」という規則の表です。

<<< @/examples/11-network/infra/lib/network-stack.ts{subnets}

public subnet も private subnet も、ここまではまったく同じ作りです。違いが出るのは次のループだけ。

<<< @/examples/11-network/infra/lib/network-stack.ts{routes}

`0.0.0.0/0`（すべての宛先）を internet gateway へ送る 1 行。これがある route table を持つ subnet が public で、ない subnet が private です。「private」という設定項目がどこかにあるわけではありません。

どの route table にも、VPC の中どうしで話すための経路（local route）は最初から入っています。なので、private subnet のリソースは、同じ VPC の public subnet のリソースとは話せます。出られないのは VPC の外だけです。

subnet ごとに route table を作っているのにも理由があります。VPC には最初から main route table というものがあって、どの route table にも関連付けていない subnet は、それに従います。誰かが main route table にインターネットへの経路を足すと、関連付けを忘れた subnet が全部 public になる。それを避けるために、4 つとも明示的に関連付けています。

もう 1 つ、public subnet で `mapPublicIpOnLaunch` を `false` にしています。public subnet に置いただけでは、リソースはインターネットと話せません。public IPv4 アドレスも要ります。そしてそのアドレスは、1 つにつき 1 時間 USD 0.005、月に USD 3.65 かかります。自動で配らず、必要なリソースが自分で頼む形にしました。

テストは、既定の構成で、インターネットへの経路が public の 2 つの route table にしかないことを見ています。

## security group は返事を覚えている

<!-- section: 11.firewall -->

経路があることと、通信が許されることは別の話です。route table が決めるのは「どこへ届けられるか」。届いたものを受け取るかどうかは、security group が決めます。

security group は、instance などのリソースに付ける規則で、書けるのは許可だけです。そして stateful です。許可した通信の返事は、逆向きの規則がなくても通ります。

この章で security group が出てくるのは、interface endpoint を足したときだけです。

<<< @/examples/11-network/infra/lib/network-stack.ts{interface-endpoints}

入ってくる向きに「VPC の中から、443 番」を許しているだけです。endpoint からの返事を通す規則は書いていません。stateful なので、要らないんです。

似た名前のものに network ACL があります。こちらは subnet の境界に付き、許可と拒否の両方を書けて、番号順に評価されます。そして stateless です。行きを許しても、帰りは別に許さないと通りません。

VPC には、すべてを許可する network ACL が最初から付いています。この章はそれに手を入れていません。AWS のドキュメントも、security group だけでリソースを守れると書いています。network ACL が要るのは、「この範囲からの通信は subnet ごと拒否したい」のように、拒否を書きたいときです。

正直に言うと、この節の振る舞い（返事が通ること、network ACL との違い）は、実際の AWS で通信して確かめたわけではありません。ドキュメントで読んだ内容です。

## private subnet から AWS を呼ぶ 3 つの道

<!-- section: 11.egress -->

private subnet に置いたコンテナが、S3 からファイルを読みたい。ECR から image を取ってきたい。CloudWatch Logs にログを送りたい。どれも AWS のサービスですが、入口は VPC の外にあります。経路がなければ届きません。

道は 3 つあります。

**gateway endpoint。** S3 と DynamoDB だけに使える道です。route table に「このサービス宛てはここへ」という経路が 1 行入ります。追加料金はありません。なので、既定で作っています。

<<< @/examples/11-network/infra/lib/network-stack.ts{gateway-endpoints}

**interface endpoint。** サービスへの入口を、subnet の中に private IP アドレスつきで置くものです（AWS PrivateLink）。対応しているサービスは多いのですが、サービスごと、AZ ごとに、1 時間 USD 0.014 かかります。通したデータにも 1 GB あたり USD 0.01。コードはさっき見たとおりで、`privateDnsEnabled` のおかげで、SDK がいつもどおりのホスト名を呼べば endpoint に届きます。

**NAT Gateway。** private subnet から、インターネット全体へ出られるようにする中継点です。public subnet に置いて、Elastic IP アドレスを 1 つ持たせます。AWS のサービスだけでなく、外部の API や npm のレジストリにも届きます。1 つにつき 1 時間 USD 0.062、通したデータに 1 GB あたり USD 0.062。

<<< @/examples/11-network/infra/lib/network-stack.ts{nat}

何を選ぶかは、何を呼びたいかで決まります。

| | 届く先 | 置いてあるだけの料金 | 通したデータ |
| --- | --- | --- | --- |
| gateway endpoint | 同じリージョンの S3 と DynamoDB | なし | なし |
| interface endpoint | 足したサービスだけ | 1 つ・1 AZ あたり USD 0.014／時 | USD 0.01／GB |
| NAT Gateway | インターネット全体 | 1 つ USD 0.062／時、加えて public IPv4 が USD 0.005／時 | USD 0.062／GB |

12章の Fargate を private subnet で動かすなら、ECR から image を取るのに `ecr.api` と `ecr.dkr` の 2 つの interface endpoint と S3 の gateway endpoint、ログを送るのに `logs` の interface endpoint が要ります。23章の Session Manager なら `ssm`、`ssmmessages`、`ec2messages`。この章の stack が足せる interface endpoint は、その 2 つの章が使うものに `secretsmanager` を加えた 7 つに絞ってあります。

<<< @/examples/11-network/src/config.ts{options}

「private subnet からどこへ届くか」も、関数にしました。計画の route table を読むだけで、AWS には問い合わせません。

<<< @/examples/11-network/src/reach.ts{reach}

security group や DNS までは見ていない、簡単なモデルです。それでも「既定の構成で、private subnet から ECR には届かない。S3 には届く」をテストで固定できます。これ、実際にハマる人が多いところなんです。

## 置いてあるだけでかかるお金

<!-- section: 11.cost -->

金額は USD、東京リージョン、従量課金、税別、1 か月は 730 時間です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

| 構成 | 時間で課金されるもの | 通信がなくてもかかる月額 | 月 10 GB 通したとき |
| --- | --- | --- | --- |
| 既定 | なし | 0 | 0 |
| `-c egress=nat` | NAT Gateway 1、public IPv4 1 | 48.91 | 49.53 |
| `-c egress=nat-per-az` | NAT Gateway 2、public IPv4 2 | 97.82 | 98.44 |
| `-c interfaceEndpoints=ecr.api,ecr.dkr,logs` | interface endpoint 3 × 2 AZ | 61.32 | 61.42 |

既定の 0 は、料金がわからないから 0 と書いたのではありません。VPC、subnet、route table、internet gateway、gateway endpoint には、もともと料金がないんです。

表から読み取れることが 3 つあります。

**NAT Gateway は、通信がなくても月 USD 45.26。** それに Elastic IP アドレスの USD 3.65 が乗ります。public IPv4 アドレスは、使っていてもいなくても同じ単価で課金されます。

**interface endpoint は、数と AZ で掛け算になる。** 1 つを 2 つの AZ に置くと月 USD 20.44。3 つ置けば、通信がなくても NAT Gateway 1 つより高くなります。endpoint のほうが得になるのは、通すデータが多いときです。この 2 つの構成で比べると、月におよそ 240 GB を超えたあたりで逆転します（1 GB あたりの差が USD 0.052、固定費の差が USD 12.41）。

**1 時間に満たなくても 1 時間ぶん。** NAT Gateway も interface endpoint も、作って 5 分で消しても 1 時間として請求されます。

この表に入れていないものもあります。インターネットへ出ていくデータ転送の料金、AZ をまたぐデータ転送の料金です（0 という意味ではなく、未算入です）。10 GB という通信量も仮定にすぎません。public IPv4 アドレスには無料利用枠の記述がドキュメントにありますが、NAT Gateway の Elastic IP が対象になるかは確かめられなかったので、引いていません。

時間で課金されるものの数え方は、コードにしてあります。

<<< @/examples/11-network/src/cost.ts{billable}

テストは、この関数が出す時間数が料金データのシナリオと一致すること、そして上の表の金額が計算結果と一致することを見ています。構成を変えたのに本文の金額を直し忘れると、テストが落ちます。

## Lambda を VPC に入れる？

<!-- section: 11.lambda -->

入れるのは、VPC の中にあるものと話す必要があるときだけです。たとえば RDS のデータベース。DynamoDB や S3 を呼ぶだけの関数を VPC に入れる理由は、ありません。

入れると、失うものがあります。

**インターネットへの経路。** 何も設定していない Lambda はインターネットに出られますが、VPC につないだ関数は、その VPC から届く範囲にしか届きません。public subnet につないでも駄目です。Lambda のドキュメントははっきり書いていて、public subnet につないでも、インターネットへの接続も public IP アドレスも得られません。

つまり、VPC に入れた関数から Secrets Manager や SQS を呼ぶには、さっきの 3 つの道のどれかが要ります。DynamoDB と S3 は gateway endpoint で届くので、この章の既定の構成のままで大丈夫です。それ以外は、interface endpoint か NAT Gateway。ここで初めて、Lambda の構成に「置いてあるだけでかかるお金」が入ってきます。

**絞った権限。** VPC につなぐには、実行 role に network interface を作る・消すための EC2 の権限が 6 つ要ります。ドキュメントは、これを全リソース（`"Resource": "*"`）に対して許すように求めています。そしてこの権限は、関数のコードにも渡ります。04章からずっと「`*` を使わない」で来ましたが、ここは例外になります。

**すぐ使えること。** 最初に VPC につないだとき、Lambda は network interface を用意します。その間、関数は Pending の状態で、呼び出せません。ドキュメントによると数分かかることがあります。14 日間呼ばれなかった関数は、network interface を回収されて Inactive になり、次の呼び出しは失敗します。

この章には、VPC に入れた Lambda のサンプルはありません。VPC の中に話し相手がまだいないので。13章で、データベースと一緒に扱います。

## AZ が 2 つあっても、リージョンは 1 つ

<!-- section: 11.zones -->

subnet を 2 つの AZ に分けたのは、片方の AZ が止まっても、もう片方で動き続けられるようにするためです。AZ どうしは電源もネットワークも別で、同時に壊れにくいように作られています。RDS も、2 つの異なる AZ の subnet を要求します。

ただ、「AZ を 2 つにしたから安心」と言う前に、確かめたいことが 2 つあります。

1 つ目。AZ をまたいで共有しているものはありませんか。`-c egress=nat` は、NAT Gateway を 1 つだけ、1 つ目の AZ に置きます。安く済みますが、こうなります。

```text
layout: -c egress=nat  (one NAT gateway, in ap-northeast-1a)

step  event                  Private1 (1a) -> internet   Private2 (1c) -> internet
1     both zones up          via NAT gateway in 1a       via NAT gateway in 1a
2     zone 1a goes down      down with its zone          no way out: its NAT gateway was in 1a
3     same, traffic to S3    down with its zone          still works: gateway endpoint, no NAT involved

layout: -c egress=nat-per-az  (one NAT gateway per zone)

2'    zone 1a goes down      down with its zone          via NAT gateway in 1c

any layout

4     the whole region is impaired: nothing in this VPC is reachable; a second zone does not help
```

2 行目を見てください。止まったのは 1a なのに、無事なはずの 1c がインターネットに出られなくなります。出口を 1a に頼っていたからです。AZ を 2 つに分けた意味が、NAT Gateway 1 つで消えています。

テストは、この順序をそのまま再現します。

<<< @/examples/11-network/test/reach.test.ts{zone-failure}

`nat-per-az` なら 1c は出口を失いません。そのかわり、固定費は倍です。開発用なら 1 つ、止まると困るなら AZ ごと、と決めればよくて、どちらが正しいという話ではありません。大事なのは、選んだ構成で何が道連れになるかを知っていることです。

2 つ目。4 行目です。AZ は**リージョンの中の**区切りです。VPC は 1 つのリージョンにしか存在しません。リージョン全体に障害が起きたら、AZ がいくつあっても、この VPC の中のものは全部届かなくなります。複数 AZ が守ってくれるのは AZ 1 つぶんの障害までで、リージョンの障害ではありません。そちらに備えるなら、別のリージョンにもう 1 式、という別の設計になります。この章の範囲の外です。

この節の invariant を 1 文で書くと、「止まっていない AZ の private subnet は、ほかの AZ が止まっても、止まる前に届いていた先に届く」。`nat-per-az` と既定の構成はこれを満たし、`nat` は満たしません。それをテストで固定してあります。

1 つ断っておくと、このテストが壊しているのは、計画のモデルです。本物の AZ を止めたわけではありません。

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

## ハマりどころ

| こうなったら | ここを見る |
| --- | --- |
| deploy が subnet の作成で失敗する | AZ の名前が、あなたのアカウントで使えるものですか。`aws ec2 describe-availability-zones` で確認して、`-c availabilityZones=...` で渡す |
| private subnet のコンテナが image を取れない、AWS の API がいつまでも返ってこない | 経路がありません。`vp run net:plan` の「From Private1」で、その宛先が `unreachable` になっていないか |
| interface endpoint を足したのに届かない | endpoint の security group が、呼ぶ側からの 443 番を許していますか。VPC の DNS の設定が 2 つとも有効ですか |
| S3 には届くのに、別のリージョンの bucket には届かない | gateway endpoint が効くのは、同じリージョンのサービスだけです |
| `net:infra:destroy` が `StackHasActiveImportsError` で止まる | この VPC を使っている stack が残っています。そちらを先に消す |
| 使っていないのに請求がある | NAT Gateway、interface endpoint、public IPv4 アドレスは、通信がなくても課金されます。`vp run net:plan` に渡した設定と、実際に deploy した設定が同じか |
| VPC に入れた Lambda が外部の API を呼べない | 「Lambda を VPC に入れる？」のとおりです。public subnet につないでも出られません |
| `Invalid network settings` で止まる | メッセージに、どの項目がなぜ駄目かが出ています。CIDR は範囲の先頭のアドレスで書く（`10.20.1.0/16` ではなく `10.20.0.0/16`） |

1 行目から 4 行目の症状は、ドキュメントの記述から組み立てたもので、実際に起こして確かめたわけではありません。

## 本番にするなら

- **CIDR を、ほかのネットワークと重ならないように決める。** 社内のネットワークや別の VPC と後でつなぐなら、重なった範囲どうしは経路を書けません。AWS のドキュメントは `172.17.0.0/16` を避けるようにも書いています
- **出口を AZ ごとに持つか、持たないと決める。** NAT Gateway を 1 つにするなら、その AZ が止まったときに何が止まるかを書き出しておく
- **gateway endpoint と interface endpoint に policy を付ける。** いまは、endpoint を通ればどの bucket にも届きます。使う bucket や操作に絞れます
- **AZ を 3 つにする。** 東京リージョンには AZ が 3 つ以上あります。計画の関数は 3 つ目を足しても番号が変わらないようにしてあります
- **default の security group を使わない。** VPC には最初から 1 つ付いてきて、security group を指定し忘れたリソースはそれに入ります。用途ごとに自分で作ります（12章）
- **反映の経路を AWS CDK CLI と CloudFormation にする。** cdkd の公式ドキュメントは、cdkd を開発・テスト用途向けとし、本番には AWS CDK CLI を勧めています（02章）
- **支出の通知を付ける。** 01章の budget は、NAT Gateway を消し忘れたときに気づくための最後の網です。上限ではなく、通知です

## 片付け

<!-- section: 11.cleanup -->

```bash
vp run net:infra:destroy
```

VPC、subnet、route table、internet gateway、endpoint が消えます。NAT Gateway と Elastic IP アドレスを足していたら、それも一緒です。stack の外に残るリソースは無いようにしてあって、テストも、残す設定（`DeletionPolicy`）がどのリソースにも付いていないことを見ています。

この VPC を使う stack（12章以降）を先に消してください。残っていると、destroy は拒否されます。

時間課金の部品を足したまま寝かせたくないだけなら、VPC ごと消さなくても、`-c` なしでもう一度 deploy すれば外せます。ただ、どちらの場合も、最後は自分の目で確かめるのが確実です。

```bash
aws ec2 describe-nat-gateways --region ap-northeast-1 --filter Name=state,Values=available
aws ec2 describe-vpc-endpoints --region ap-northeast-1
```

1 つ目が空で、2 つ目に Interface 型の endpoint が無ければ、この章のぶんの時間課金は止まっています。

残るのは、cdkd の bootstrap で作った保存場所（02章）だけです。

::: details この章の検証メモ

**手元で確かめたこと。** CIDR の計算、設定の検証、経路のモデル、料金の入力、stack の assertion、import と export の対応のユニットテスト。型検査。`net:infra:synth`（既定の構成と、`-c egress=nat-per-az -c interfaceEndpoints=ecr.api,ecr.dkr,logs`）。`net:plan`（既定、`egress=nat`、`egress=nat-per-az`、`interfaceEndpoints=ecr.api,ecr.dkr,logs`、不正な設定）。本文の金額は、Price List の単価から `tools/src/pricing/calc.ts` が計算した値で、`examples/11-network/test/pricing.test.ts` が照合しています。AWS CLI の flag（`--filters`、`describe-nat-gateways` の `--filter`）は、devShell の AWS CLI 2.35.11 の help で確かめました。

**まだ確かめていないこと。** `net:infra:diff`、`net:infra:deploy`、`net:infra:drift`、`net:infra:destroy` は、実際の AWS では動かしていません。したがって、次はすべて実環境での確認待ちです。cdkd 0.296.28 がこの stack を作って消せること。`AWS::EC2::VPCEndpoint` が Cloud Control API 経由で作れること。private subnet から gateway endpoint と interface endpoint を通して実際に届くこと。security group と network ACL の振る舞い。`-c` を外して deploy し直すと NAT Gateway が消えること。別のアプリの stack から `Fn::ImportValue` で読めること、使われている間は destroy が拒否されること。既定の AZ 名（`ap-northeast-1a`、`ap-northeast-1c`）がどのアカウントでも使えるかどうか。「ハマりどころ」の症状。VPC に入れた Lambda の挙動は、ドキュメントを読んだだけで、サンプルもありません。

一次情報で確かめられなかったこと。public IPv4 アドレスの無料利用枠（750 時間）が NAT Gateway の Elastic IP アドレスに適用されるかどうか。Price List には Regional NAT Gateway という別の SKU（1 時間 USD 0.062、1 GB USD 0.062）もありますが、この章では扱っておらず、仕様も読んでいません。Cloudflare 側に VPC に当たる体験があるかどうかも調べていないので、比較は書いていません。

cdkd が扱うリソースの種類。`v0.296.28` タグの `src/provisioning/register-providers.ts` では、`AWS::EC2::VPC`、`Subnet`、`InternetGateway`、`VPCGatewayAttachment`、`RouteTable`、`Route`、`SubnetRouteTableAssociation`、`SecurityGroup`、`EIP`、`NatGateway` が専用の実装（EC2 の provider）に登録されています。`AWS::EC2::VPCEndpoint` は登録が無く、未対応の一覧にも無いので、Cloud Control API 経由です。専用の実装が書き込まない property を template が使うと、そのリソースは Cloud Control API に回される仕組みなので、この stack は専用の実装が扱う property だけを使い、テストでその一覧を固定しています。なお、npm の tarball には TypeScript のソースが入っていないため、GitHub のタグの archive を読みました。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 全体像 | `examples/11-network/infra/lib/network-stack.ts`、`infra/bin/app.ts` | `net:infra:synth` |
| アドレスを割る | `examples/11-network/src/cidr.ts`、`src/config.ts`、`src/plan.ts`、`test/cidr.test.ts`、`test/plan.test.ts` | `test:unit`、`net:plan` |
| public と private を分けるのは、route table の 1 行 | `examples/11-network/infra/lib/network-stack.ts`、`infra/test/network-stack.test.ts` | `test:unit`、`net:infra:synth` |
| security group は返事を覚えている | `examples/11-network/infra/lib/network-stack.ts` | なし |
| private subnet から AWS を呼ぶ 3 つの道 | `examples/11-network/infra/lib/network-stack.ts`、`src/reach.ts`、`test/reach.test.ts` | `test:unit`、`net:plan` |
| 置いてあるだけでかかるお金 | `examples/11-network/src/cost.ts`、`test/pricing.test.ts`、`scripts/plan.ts`、`data/pricing/` | `test:unit`、`net:plan` |
| AZ が 2 つあっても、リージョンは 1 つ | `examples/11-network/src/reach.ts`、`test/reach.test.ts` | `test:unit` |
| 手元で確かめる | `examples/11-network/scripts/plan.ts`、`src/report.ts`、`infra/test/network-stack.test.ts` | `net:plan`、`test:unit`、`net:infra:synth` |
| ほかの stack から使う | `examples/11-network/src/exports.ts`、`infra/lib/import-network.ts`、`infra/test/import-network.test.ts` | `test:unit` |
| デプロイする | `examples/11-network/infra/bin/app.ts`、`cdk.json`、`tools/src/infra/` | `net:infra:diff`、`net:infra:deploy`、`net:infra:drift` |
| 片付け | `tools/src/infra/` | `net:infra:destroy` |

**一次情報**（確認日はすべて 2026-10-11）

- [What is Amazon VPC?](https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html)、[Subnets for your VPC](https://docs.aws.amazon.com/vpc/latest/userguide/configure-subnets.html)、[Subnet CIDR blocks](https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html)、[VPC CIDR blocks](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-cidr-blocks.html)
- [Route table concepts](https://docs.aws.amazon.com/vpc/latest/userguide/RouteTables.html)、[Internet gateways](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html)、[NAT gateway basics](https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-basics.html)
- [Security groups](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html)、[Default security groups](https://docs.aws.amazon.com/vpc/latest/userguide/default-security-group.html)、[Network ACLs](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html)、[Infrastructure security in Amazon VPC](https://docs.aws.amazon.com/vpc/latest/userguide/infrastructure-security.html)
- [Gateway endpoints](https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html)、[Interface VPC endpoints](https://docs.aws.amazon.com/vpc/latest/privatelink/create-interface-endpoint.html)、[AWS services that integrate with AWS PrivateLink](https://docs.aws.amazon.com/vpc/latest/privatelink/aws-services-privatelink-support.html)、[AWS::EC2::VPCEndpoint](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-vpcendpoint.html)、[AWS::EC2::Subnet](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-subnet.html)、[Get exported outputs from a deployed CloudFormation stack](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-stack-exports.html)
- [Amazon VPC pricing](https://aws.amazon.com/vpc/pricing/)、[AWS PrivateLink pricing](https://aws.amazon.com/privatelink/pricing/)
- AWS Price List bulk API: [EC2](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/ap-northeast-1/index.json)（NAT Gateway。約 445 MB）、[VPC](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/current/ap-northeast-1/index.json)（interface endpoint、public IPv4 アドレス）
- [Giving Lambda functions access to resources in an Amazon VPC](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html)
- [Amazon ECR interface VPC endpoints](https://docs.aws.amazon.com/AmazonECR/latest/userguide/vpc-endpoints.html)、[Fargate task networking](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html)、[VPC endpoints for Systems Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/setup-create-vpc.html)、[Working with a DB instance in a VPC](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html)、[Amazon VPCs and ElastiCache security](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/VPCs.html)
- [AWS Availability Zones](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-availability-zones.html)、[AZ IDs](https://docs.aws.amazon.com/global-infrastructure/latest/regions/az-ids.html)、AWS Fault Isolation Boundaries: [Availability Zones](https://docs.aws.amazon.com/whitepapers/latest/aws-fault-isolation-boundaries/availability-zones.html)、[Regions](https://docs.aws.amazon.com/whitepapers/latest/aws-fault-isolation-boundaries/regions.html)
- cdkd v0.296.28: [src/provisioning](https://github.com/go-to-k/cdkd/tree/v0.296.28/src/provisioning)、[Cross-Stack References](https://github.com/go-to-k/cdkd/blob/v0.296.28/docs/cross-stack-references.md)、[Introduction](https://cdkd.dev/introduction/)

:::
