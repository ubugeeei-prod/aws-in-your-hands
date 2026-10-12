---
title: "42 Firewall Manager: 複数アカウントの WAF、security group、Network Firewall をまとめて管理する"
revision: 1
---

# 42 Firewall Manager: 複数アカウントの WAF、security group、Network Firewall をまとめて管理する

[21章](/ja/chapters/21-security.md)では、web ACL を 1 つ作って、1 つのディストリビューションに付けました。守られているのは、付けることを誰かが覚えていた、その 1 つだけです。アカウントが 3 つ、5 つと増えると、確かめたいことが変わります。すべてのアカウントの、すべての公開の入口が、昨日作られたものも含めて、同じルールの後ろにあるかどうかです。

AWS Firewall Manager は、この問いに、覚えておくことではなくポリシーで答えるサービスです。ポリシーを 1 つ書くと、範囲に入るアカウントとリソースに、あとから増えたものにも適用されます。

料金を先に書いておきます。**Firewall Manager のポリシーは、1 つにつき、リージョンごとに月 USD 100 です**。この章の 2 つのスタックはポリシーを 1 つずつ作るので、置いてあるだけで月 USD 200 かかります。これに、ポリシーがメンバーアカウントに作る web ACL と、前提になる AWS Config の料金が、アカウントの数だけ加わります。アカウント 5 つの組織の例では、月 USD 226.04 でした。web ACL を 1 つ持つだけの 21章の構成は、月 USD 8.00 です。消すときは `vp run fwm:edge:infra:destroy` と `vp run fwm:infra:destroy` を実行します。内訳と、消したあとに残るものは、[費用、注意点、片付けのページ](/ja/chapters/42-firewall-manager/wrap.md)にあります。

アカウントを 1 つしか持っていない読者は、Firewall Manager を使えません。AWS Organizations の組織が前提だからです。その場合は 21章の内容で足りていて、この章は、アカウントが増えたときに何が変わるかを知るための読み物になります。

この章の AWS 側の手順は、一度も実際に動かしていません。組織を持っていないので、動かせるのは手元のモデルとテスト、synth までです。モデルは、ドキュメントに書かれた動作をこの本が読み取って書いたもので、サービスそのものではありません。内訳は[章末の検証メモ](/ja/chapters/42-firewall-manager/wrap.md)にあります。

前提は [21章](/ja/chapters/21-security.md)、[11章](/ja/chapters/11-network.md)、[01章](/ja/chapters/01-account.md)です。アカウントと環境の分け方そのものは [33章](/ja/chapters/33-production-readiness.md)が扱います。コードは `examples/42-firewall-manager/` にあります。

## Firewall Manager が答える問い

<!-- section: 42.problem -->

21章のやり方では、web ACL を付けるかどうかは、スタックを書く人が決めます。同じリポジトリの同じチームなら、付け忘れはレビューで見つかります。別のチームが別のアカウントで作ったディストリビューションは、そもそも目に入りません。

Firewall Manager では、決める場所が変わります。組織の中の 1 つのアカウントを Firewall Manager の管理者アカウントにして、そこにポリシーを置きます。ポリシーには、保護の内容と、適用する範囲を書きます。範囲は、アカウント、OU（organizational unit）、リソースタイプ、タグで決めます。

```figure
caption: 管理者アカウントに置いた 1 つのポリシーが、範囲に入るアカウントのリソースに届く
node policy: Firewall Manager のポリシー | 管理者アカウント
node config: AWS Config | 各アカウント、各リージョン
node dev: dev アカウント | ディストリビューション
node prod: prod アカウント | ディストリビューション
node sandbox: sandbox アカウント | 範囲の外
edge config --> policy: 設定の変化
edge policy -> dev: web ACL を関連付ける
edge policy -> prod: web ACL を関連付ける
group org: AWS Organizations の組織 = policy, config, dev, prod, sandbox
mark policy
```

リソースが作られたり変わったりしたことは、各アカウントの AWS Config が記録します。Firewall Manager は、その記録をもとに、範囲に入るリソースがポリシーに合っているかを調べます。合っていなければ、設定によって、報告だけをするか、自分で直します。直す設定を自動修復（automatic remediation）と呼びます。

ポリシーが適用されるのは、ポリシーを作った時点のリソースだけではありません。ドキュメントは、範囲に入るアカウントやリソースがあとから増えたときにも、Firewall Manager が自動で適用すると書いています。「昨日作られたディストリビューション」に答えているのは、この部分です。

ただし、作られた瞬間に守られるわけではありません。設定の変化が Firewall Manager に届き、ポリシーが適用されるまでには時間がかかります。そのあいだに何が見えるかは、[しくみと実装のページ](/ja/chapters/42-firewall-manager/build.md)で、モデルを使って確かめます。

## 使い始める前に要るもの

<!-- section: 42.prerequisites -->

Firewall Manager のドキュメントは、前提を順番に挙げています（確認日 2026-10-13）。

1 つ目は AWS Organizations です。使うアカウントが組織に入っていて、その組織で「すべての機能（all features）」が有効になっている必要があります。請求をまとめるだけの設定（consolidated billing）では使えません。

2 つ目は、Firewall Manager の管理者アカウントです。21章に出てきた組織の管理アカウント（management account）とは別のもので、名前が似ているので注意してください。最初の管理者アカウントを指定できるのは、組織の管理アカウントだけです。最初に指定したアカウントがデフォルトの管理者（default administrator）になり、すべてのアカウント、すべてのリージョン、すべての種類のポリシーを扱えます。このとき Firewall Manager は、そのアカウントを Organizations の委任された管理者（delegated administrator）として登録します。

管理者は、あとから増やせます。組織につき 10 個までで、この上限は変えられません。追加の管理者には、扱えるアカウントや OU、リージョン、ポリシーの種類を絞って渡せます。デフォルトの管理者だけにできるのは、サードパーティのファイアウォールの管理です。

3 つ目は AWS Config です。組織のメンバーアカウントのすべてで、Firewall Manager の管理者アカウントも含めて、有効にします。守りたいリソースがあるリージョンごとに必要で、記録の頻度は連続（Continuous）でなければなりません。すべてのリソースタイプを記録しないなら、ポリシーの種類ごとに決まったリソースタイプを記録します。この章の 2 つのポリシーなら、次のとおりです。

- AWS WAF のポリシー: CloudFront のディストリビューション、Application Load Balancer、API Gateway、WAF と WAFv2 の web ACL。CloudFront のディストリビューションを記録できるのは us-east-1 だけです
- セキュリティグループの内容の監査（content audit）: EC2 のセキュリティグループ、ネットワークインターフェース、インスタンス

AWS Config には料金がかかります。21章で調べたとおり、連続記録では configuration item 1 件につき USD 0.003 です。Firewall Manager がポリシーごとに各アカウントへ作る AWS Config のルールにも、評価 1 回につき USD 0.001（最初の 10 万回まで）がかかります。Config の recorder に自分で作った IAM ロールを使っていて、権限が足りずに記録できていない場合、Firewall Manager からはそのことが見えません。

このほかに、Network Firewall と DNS Firewall のポリシーには AWS RAM での組織内共有の有効化が、サードパーティのファイアウォールには AWS Marketplace での契約が、既定で無効のリージョンにはリージョンの有効化が要ります。この章では使いません。

Security Hub CSPM は、前提には入っていません。ただ、この章が通知に使う経路は Security Hub を通るので、通知まで動かすなら有効にします。

この章のスタックは、管理者アカウントの ID と、対象にする OU を、CDK のコンテキストで受け取ります。

<<< @/examples/42-firewall-manager/infra/lib/config.ts{context}

この 2 つには既定値がありません。ほかの章のスイッチと違って、付け忘れたら安いほうになるという逃げ道が無いからです。誰かの例の ID のままポリシーができてしまうより、synth で止まるほうがましです。

管理者アカウントは、外すときにも影響が出ます。管理者が自分のアカウントを管理者から外すと、そのアカウントが作ったポリシーはすべて削除されます。管理者アカウントを閉鎖すると、ポリシーは無効になって保護が止まり、ポリシーのデータは 90 日間だけ残ります。

## ポリシーの種類

<!-- section: 42.policy-types -->

ポリシーは種類ごとに作ります。1 つのポリシーが扱うのは 1 種類で、同じ種類を複数作れます。ドキュメントと API リファレンスが挙げている種類は、次のとおりです（確認日 2026-10-13）。

```text
policy type                    API type                       what it enforces
AWS WAF                        WAFV2                          rule groups that run first and last in the web ACL of each in-scope resource
AWS WAF Classic                WAF                            one rule group in an AWS WAF Classic web ACL
Shield Advanced                SHIELD_ADVANCED                Shield Advanced protection on the chosen resource types
security group, common         SECURITY_GROUPS_COMMON         replicas of primary security groups, associated with in-scope resources
security group, content audit  SECURITY_GROUPS_CONTENT_AUDIT  which rules the security groups in scope may contain
security group, usage audit    SECURITY_GROUPS_USAGE_AUDIT    no unused and no redundant security groups
network ACL                    NETWORK_ACL_COMMON             first and last rules in the network ACLs of in-scope subnets
Network Firewall               NETWORK_FIREWALL               a Network Firewall firewall for the VPCs in scope
                               IMPORT_NETWORK_FIREWALL        existing firewalls, managed under one policy
DNS Firewall                   DNS_FIREWALL                   rule group associations on in-scope VPCs, before and after the account's own
third-party firewall           THIRD_PARTY_FIREWALL           Palo Alto Networks Cloud NGFW or Fortigate CNF, from AWS Marketplace
```

セキュリティグループのポリシーは 3 種類あり、やることが違います。common は、管理者アカウントに作った元のセキュリティグループを各アカウントの VPC に複製して、リソースに付けます。content audit は、すでにあるセキュリティグループのルールを調べて、許していない内容のルールを見つけます。usage audit は、使われていないものと、中身が重複しているものを見つけます。

この章で作るのは、AWS WAF のポリシーと、セキュリティグループの content audit のポリシーです。21章の web ACL と [11章](/ja/chapters/11-network.md)のセキュリティグループを、それぞれ複数のアカウントに広げたものにあたります。

Network Firewall のポリシーは作りません。分散型（distributed）のポリシーは、範囲に入る VPC ごとにファイアウォールを作り、エンドポイントを置きます。東京リージョンのエンドポイントは 1 つ 1 時間あたり USD 0.395 で、1 か月置くと USD 288.35 です。これがエンドポイントの数だけかかり、ほかに処理したデータ量の料金と、ポリシーの月額が加わります。練習で置いておける金額ではありません。

## 全体像

<!-- section: 42.architecture -->

スタックは 2 つで、どちらも Firewall Manager の管理者アカウントにデプロイします。メンバーアカウントにデプロイするものはありません。

```figure
caption: 2 つのスタックは管理者アカウントに置き、ポリシーがメンバーアカウントのリソースを調べる
node edge: AihFirewallManagerEdge | us-east-1, AWS WAF のポリシー
node regional: AihFirewallManager | ap-northeast-1, 監査のポリシー
node dist: CloudFront のディストリビューション | 対象の OU
node groups: セキュリティグループ | 対象の OU
node hub: Security Hub CSPM | finding
node rule: EventBridge のルール
node notifier: Notifier | Lambda
node topic: SNS のトピック
edge edge -> dist: web ACL
edge regional -> groups: ルールを調べる
edge dist --> hub: 準拠していない
edge groups --> hub: 準拠していない
edge hub -> rule: Findings - Imported
edge rule -> notifier
edge notifier -> topic: 1 件ずつ送る
group admin: 管理者アカウント = edge, regional, rule, notifier, topic
group members: メンバーアカウント = dist, groups
```

<<< @/examples/42-firewall-manager/infra/bin/app.ts{stacks}

`AihFirewallManagerEdge` は、CloudFront のディストリビューションに向けた AWS WAF のポリシー 1 つだけのスタックです。CloudFront 用のポリシーは、コンソールでは「Global」というリージョンを選んで作ります。クォータのページは、Global と US East (N. Virginia) が同じリージョンを指すと書いているので、スタックは us-east-1 に置きます。21章の web ACL のスタックと同じ事情です。CloudFront 以外のリソース、たとえば Application Load Balancer を守るには、リージョンごとに別のポリシーが要ります。

`AihFirewallManager` は東京リージョンに置きます。中身は、セキュリティグループの監査のポリシー、その基準になる監査用のセキュリティグループ、準拠の変化を人に届けるための SNS のトピック、EventBridge のルール、Lambda 関数です。

固定した版の cdkd（0.296.28）は、`AWS::FMS::Policy` と `AWS::FMS::NotificationChannel` に専用の実装を持っていません。この 2 つは Cloud Control API を通して作られます。Cloud Control API がこの 2 つのタイプに対応していることは、対応表で確かめました。実際にデプロイして確かめてはいません。

## 向いていない場面

<!-- section: 42.when-not -->

Firewall Manager は、アカウントが 1 つなら使えませんし、使えても要りません。21章のスタックに web ACL を足せば済みます。

アカウントが複数あっても、すべてのリソースが 1 つのリポジトリの CDK のコードから、[20章](/ja/chapters/20-shipping.md)のパイプラインを通ってデプロイされているなら、同じことをデプロイの前に強制できます。このリポジトリは、CDK のコードを awscdk-lint で検査し、21章の lint で IAM のワイルドカードを止め、33章の点検で合成したテンプレートを読んでいます。同じ流れに、この章の監査のルールも載せられます。

```bash
vp run fwm:audit:templates
```

このタスクは、この本のすべての章の `cdk.out` を読み、セキュリティグループの受信ルールに、ポリシーと同じ監査のルールを当てます。デプロイの前に、料金なしで分かります。

Firewall Manager が要るのは、この前提が崩れるときです。コンソールから手で作られるリソースがある、チームごとにリポジトリもパイプラインも違う、買収や委託で中身を知らないアカウントが組織に入ってくる、といった場合です。テンプレートを読む検査は、パイプラインを通らなかったものを見られません。Firewall Manager は、どう作られたかに関係なく、アカウントにあるものを見ます。

SCP とも役割が違います。21章で見たとおり、SCP（service control policy）は、メンバーアカウントの IAM ユーザーとロールに許せる権限の上限を決めます。操作が行われる前に、API の呼び出しを拒否する予防の仕組みです。Firewall Manager は、リソースが作られたり変えられたりしたあとで、その設定を調べ、報告するか直します。検出と修復の仕組みです。

どちらか一方では足りません。SCP は「この操作をさせない」と書く道具で、「すべてのディストリビューションに、このルールグループが付いていること」のような、あるべき状態は書けません。Firewall Manager のほうは、合っていない状態が、見つかるまでのあいだ存在することを防げません。

2 つが重なるところに、注意が 1 つあります。SCP はサービスリンクロールに効きません。Firewall Manager がメンバーアカウントで使うのは `AWSServiceRoleForFMS` というサービスリンクロールなので、自動修復による変更を SCP で止めることはできません。一方、Firewall Manager の管理者アカウントにメンバーアカウントを指定していれば、そこで作業する人には SCP が効きます。

最後に金額です。ポリシー 2 つで月 USD 200 は、守る入口が 2 つか 3 つの組織には高すぎます。その規模なら、各アカウントのスタックに web ACL を書き、テンプレートの検査で揃っていることを確かめるほうが安く済みます。
