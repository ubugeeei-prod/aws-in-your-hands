---
title: "11 Network: しくみと実装"
---

# 11 Network: しくみと実装

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
