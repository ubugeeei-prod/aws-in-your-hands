---
title: "42 Firewall Manager: 費用、注意点、片付け"
---

# 42 Firewall Manager: 費用、注意点、片付け

章の最後に、Cloudflare や Vercel との違い、料金、上限、つまずきやすいところ、本番に進めるときに足すもの、片付けをまとめます。検証した範囲と一次情報は、ページ末尾の検証メモにあります。

## Cloudflare や Vercel から来た人へ

<!-- section: 42.other-platforms -->

Cloudflare や Vercel を使ってきた人には、この章の問題そのものが見慣れないと思います。どちらも、プラットフォームの入口にファイアウォールが最初からあり、設定はその上に重ねるものだからです。確認日はどれも 2026-10-13 です。

```text
                    Cloudflare                                   Vercel                                       this chapter
rules for many      account-level WAF: rulesets deployed to      custom rules and managed rulesets are set    one Firewall Manager policy per policy type
sites at once       the zones of an account, Enterprise plan     per project; IP blocking also per account    and Region, over accounts and OUs
                                                                 on Enterprise
local additions     zone-level rulesets, which run after the     the project's own rules                      the account's own rules, between the
                    account-level ones                                                                        policy's first and last rule groups
several accounts    Organizations (Enterprise) groups accounts;  not examined                                 the whole point: AWS Organizations is required
                    whether WAF rules span them: not confirmed
```

Cloudflare でこの章にいちばん近いのは、アカウントレベルの WAF の設定です。ルールセット（ruleset）をアカウントに作り、式で対象のゾーンと通信を絞って、複数のゾーンに適用します。アカウントレベルのルールセットはゾーンレベルのものより先に実行されるので、Firewall Manager の「最初のルールグループ」と同じ位置づけです。ドキュメントは、ゾーンレベルで書いた例外はアカウントレベルの一致を止めない、とも書いています。この機能には Enterprise プランが要ります。それ以外のプランでは、ルールはゾーンごとに書きます。

Cloudflare には、複数のアカウントをまとめる Organizations もあります。Enterprise 向けの機能です。アカウントレベルの WAF のルールが、Organization の中の複数のアカウントにまたがって適用できるのかどうかは、確かめていません。

Vercel では、ファイアウォールの設定の単位はプロジェクトです。カスタムルールとマネージドルールセットは、プロジェクトごとに設定します。マネージドルールセットは Enterprise プランの機能です。IP アドレスのブロックだけは、プロジェクトの単位に加えて、Enterprise プランでアカウントの単位でも設定できます。DDoS の緩和は、すべてのプランで、設定なしで働きます。チームのすべてのプロジェクトに同じカスタムルールを配る仕組みは、読んだ範囲のドキュメントには見つかりませんでした。

違いのもとは、アカウントの意味です。Cloudflare や Vercel では、たいてい、1 つのアカウントやチームの中にすべてのサイトがあります。「どのアカウントにあるか」を気にする場面が少ないので、アカウントをまたぐ問題が、ふつうは生まれません。AWS では、アカウントが権限と請求の境界です。環境ごとにアカウントを分けると（分け方は [33章](/ja/chapters/33-production-readiness.md)が扱います）、境界を増やしたぶん、境界をまたいで揃える仕組みが別に要ります。Firewall Manager はその 1 つです。

サイトが 1 つのアカウントに収まっていて、プラットフォームのファイアウォールで足りているなら、この章の仕組みを持ち込む理由はありません。

## 料金

<!-- section: 42.cost -->

金額は USD、従量課金、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあり、`vp run fwm:cost` でも同じ数字が出ます。

置いてあるだけでかかるのは、ポリシーの料金です。Price List では、AWS WAF のポリシーも、セキュリティグループの content audit のポリシーも、1 つにつき月 USD 100 でした。料金ページは、これをリージョンごとの月額と説明しています。**2 つのスタックを置いておくと、範囲に入るリソースが 1 つも無くても、月 USD 200.00 です**。1 年で USD 2,400 になります。

ポリシーの料金は、Firewall Manager の料金のうち、Firewall Manager 自身に払うぶんです。料金ページによると、ポリシーが作った web ACL とルール、AWS Config のルールは、それぞれのサービスの料金で、リソースがあるアカウントに請求されます。

アカウント 5 つの小さな組織で計算してみます。管理アカウント、Firewall Manager の管理者アカウント、ワークロードのアカウント 3 つ（dev、staging、prod）があり、ポリシーの範囲は、ワークロードの 3 つが入る OU です。3 つのアカウントのそれぞれにディストリビューションがあり、自動修復を有効にしています。

```text
what                                                    quantity                          USD a month
AWS WAF policy for CloudFront                           1                                 100.00
security group content audit policy, ap-northeast-1     1                                 100.00
managed web ACLs in member accounts                     3 accounts x 1                     15.00
rule groups in those web ACLs, counted as rules         3 web ACLs x 2                      6.00
requests inspected                                      3 web ACLs x 1,000,000              1.80
AWS Config configuration items, us-east-1               4 accounts x 20                     0.24
AWS Config configuration items, ap-northeast-1          4 accounts x 200                    2.40
AWS Config rule evaluations, us-east-1                  3 accounts x 100                    0.30
AWS Config rule evaluations, ap-northeast-1             3 accounts x 100                    0.30
total at list price                                                                       226.04
```

合計は月 USD 226.04 です。件数のうち、configuration item と、ルールの評価の回数は仮定で、計った値ではありません。AWS Config の料金は、アカウントで何がどれだけ変わるかで決まります。デプロイのたびに多くのリソースが変わるアカウントでは、この例より 1 桁多くなることがあります。

この表に入れていないものがあります。0 ではなく、分からないものです。

- Security Hub CSPM の料金。この章の通知は Security Hub を通ります。料金は調べていません
- AWS Config が記録を置く S3 の料金
- ポリシーの料金が、月の途中で作ったり消したりしたときに日割りになるかどうか。AWS WAF の web ACL には「時間割り」と書いてありますが、Firewall Manager のポリシーには書いてありませんでした
- Firewall Manager がメンバーアカウントの web ACL に置くルールグループが、請求のうえでいくつのルールと数えられるか。表では、21章と同じく、ルールグループ 1 つをルール 1 つと数えました
- CloudFront 用の AWS WAF のポリシーが、Price List のどの usage type で請求されるか。候補の 3 つは、どれも USD 100 です
- 通知用の Lambda、SNS、EventBridge、CloudWatch Logs。finding の件数に比例しますが、この規模では小さいと見込んでいます。計算には入れていません

同じ 3 つのアカウントに、21章のやり方で web ACL を 1 つずつ置くと、21章の構成のまま（ルール 3 つ、検査するリクエストは同じく月 100 万件）で、1 つ USD 8.60、合わせて月 USD 25.80 です。Firewall Manager を使うと、その 9 倍ほどになります。差のおよそ USD 200 は、覚えておかなくて済むことと、1 か所で見られることの値段です。アカウントが 30 になると、同じ仮定で月 USD 454.46 で、ポリシーの USD 200 は変わりません。アカウントが増えるほど、1 アカウントあたりの割高さは薄まります。

Shield Advanced を契約している組織では、料金ページによると、Firewall Manager のポリシーの料金は契約に含まれます。この本では Shield Advanced を扱っていません。

## 上限と、ドキュメントが挙げている注意点

<!-- section: 42.limits -->

クォータは変わるものなので、確認した日付を添えます。次は 2026-10-13 に、Firewall Manager のクォータのページで読んだ値です。最新の値は同じページと、Service Quotas のコンソールで確かめてください。

```text
quota                                                          value                 adjustable
policies per organization, per Region                          50                    yes
OUs in scope per policy                                        20                    yes
tags that include or exclude resources per policy              8                     yes
accounts in scope, when accounts are named individually        200                   yes
accounts in scope, when they are not                           2,500                 yes
rule groups per AWS WAF policy                                 50                    yes
audit security groups per content audit policy                 1                     yes
administrators per organization                                10                    no
WCUs for the rule groups of one AWS WAF policy                 5,000                 no
```

ポリシーの数は、リージョンごとに数えます。Global と US East (N. Virginia) は同じリージョンとして合算されます。

範囲に使えるタグの数は、クォータのページでは 8 個ですが、API リファレンスの `ResourceTags` は、配列の最大を 50 個としています。この章のモデルは、少ないほうの 8 個で断ります。

ドキュメントが名前を挙げている注意点のうち、この章の 2 つのポリシーに関係するものを並べます。

- CloudFront の定額プラン。Firewall Manager が作った web ACL は、CloudFront の定額の料金プラン（flat-rate pricing plan）に参加できません。定額プランに入っている web ACL を管理しようとすると、そのディストリビューションとポリシーの準拠の状態は報告されず、Firewall Manager からは直せません
- Shield Advanced のポリシーとの重なり。Shield Advanced のポリシーが自動のアプリケーション層の緩和のために web ACL を付けたリソースには、AWS WAF のポリシーを適用できず、準拠していないとされます
- ログの設定。Firewall Manager が管理する web ACL のログの設定を AWS WAF の側から変えても、Firewall Manager は自動では気づきません
- セキュリティグループの変更の検出。先に書いたとおり、最長で 6 時間かかることがあります
- ほかの道具との競合。同じセキュリティグループを、Firewall Manager と別の道具の両方が直すと、修復が繰り返されます
- 管理者アカウントの閉鎖や取り消し。ポリシーが消えるか無効になり、保護が止まります

メンバーアカウントの持ち主が、ポリシーのもとでもできることは、次のとおりです。

- Firewall Manager が作った web ACL に、自分のルールとルールグループを足す。評価されるのは、ポリシーの最初の組と最後の組のあいだです。自分で足したルールのメトリクスとサンプリングの設定も、持ち主が決めます
- 自分のリソースにタグを付ける。例外のタグを付ければ、ポリシーの範囲から抜けられます
- 自動修復が無効のあいだは、何でもできます。ポリシーは報告するだけです

持ち主が、Firewall Manager の作った web ACL から、ポリシーのルールグループを外せるのかどうかは、確かめていません。ドキュメントは、利用者が自分の web ACL を手で関連付けても、ポリシーの web ACL で上書きされると書いています。

Firewall Manager を使えるリージョンの一覧は、確かめていません。Price List には、東京リージョンと us-east-1 の単価がありました。

## つまずきやすいところ

次の表は、実行して出会ったものではなく、ドキュメントとコードから詰まりそうだと分かっているものです。

| こうなったら | ここを見る |
| --- | --- |
| synth が `adminAccountId: is required` で止まる | この章のタスクには `-c adminAccountId=...` と `-c orgUnitIds=...` が要ります。形だけ確かめるなら `fwm:infra:synth:example` を使います |
| `fwm:edge:infra:deploy` がリージョンのエラーで止まる | CloudFront 用のポリシーは us-east-1 に作ります。スタックの `env` を変えていないか確かめます |
| `AWS::FMS::Policy` の作成が断られる | デプロイ先が Firewall Manager の管理者アカウントか、範囲のアカウントで AWS Config が有効かを確かめます。実際のエラーの文面は見ていません |
| ポリシーが Pending のまま | 作成には数分かかることがあります |
| 対象の OU のアカウントが範囲に出てこない | OU の ID の綴りと、管理者に渡された管理の範囲（アカウント、リージョン、ポリシーの種類）を確かめます。範囲の外のポリシーは `OUT_OF_ADMIN_SCOPE` になり、新しいリソースを守りません |
| 準拠の状態が、実際と合わない | AWS Config の記録が連続になっているか確かめます。合っていれば、そのポリシーの AWS Config のルールを再評価します |
| 「Account does not have AWS Config enabled in the Region」という finding が出る | そのアカウントとリージョンで AWS Config を有効にします |
| 通知が届かない | Security Hub CSPM が有効か、ルールを置いたリージョンに finding が来ているか、メールの購読を確認したかを見ます |
| 例外のタグを付けたのに、範囲に残る | タグはキーと値の両方が一致する必要があります。大文字と小文字、前後の空白を確かめます |
| 監査で、事務所の IP アドレスへのルールが違反になる | この章の基準は、許すものを並べる書き方です。例外のタグを付けるか、監査用のセキュリティグループにそのアドレスを足します |
| 修復で消えたルールが、次のデプロイで戻る | テンプレートにルールが残っています。コードを直します |
| 東京リージョンの Application Load Balancer が守られない | この章の AWS WAF のポリシーは CloudFront 用です。リージョンのリソースには、そのリージョンのポリシーが要ります |

## 本番にするなら

- 自動修復は、OU を 1 つずつ、報告を読んでから有効にします。最初から組織全体で有効にしません
- 例外のタグが付いたリソースを、定期的に一覧にします。範囲から外れたリソースは、どの報告にも出ません
- 例外のタグを付けられる人を、IAM と SCP で絞ります。AWS Config の recorder を止めさせない SCP は、21章のガードレールに入っています
- finding を、人が見る場所に流します。この章のトピックを、[19章](/ja/chapters/19-observability.md)の通知の経路につなぎます。リージョンが複数あるなら、Security Hub の集約を設定します
- AWS WAF のポリシーに、ログの設定を足します。ポリシーは、範囲に入るすべての web ACL のログを 1 か所に集める設定を持てます。この章のスタックは設定していません
- 管理者を分けるなら、範囲を絞って渡します。すべてを扱えるのは、デフォルトの管理者だけにします
- AWS Config を、すべてのアカウントとリージョンで揃えて有効にする手段を決めます。Firewall Manager は、有効になっていないアカウントを finding で知らせますが、有効にはしてくれません
- cdkd は開発とテストのための道具です。本番のポリシーは、AWS CDK CLI か CloudFormation で管理します

## 片付け

<!-- section: 42.cleanup -->

ポリシーの月額は、ポリシーを消すまで続きます。試し終えたら、2 つとも消します。

```bash
vp run fwm:edge:infra:destroy -c adminAccountId=<12 digits> -c orgUnitIds=<ou-id>
vp run fwm:infra:destroy -c adminAccountId=<12 digits> -c orgUnitIds=<ou-id>
```

ポリシーを消したときにメンバーアカウントに何が残るかは、`DeleteAllPolicyResources` で変わります。この章のスタックは `true` にしています。

`true` のとき、API リファレンスによると、AWS WAF のポリシーでは次のことが行われます。Firewall Manager が作ったルールグループを消す、範囲に入るリソースから web ACL を外す、ルールもルールグループも入っていない web ACL を消す、の 3 つです。外したあと、そのリソースは、このポリシーの web ACL では守られなくなります。ドキュメントは、変更がすべてのアカウントに行き渡るまで数分かかることがあると書いています。

この説明どおりなら、持ち主が自分のルールを足していた web ACL は、中身が空にならないので残ります。残った web ACL には、そのメンバーアカウントで月額がかかり続けます。実際にそうなるかどうかは、確かめていません。消したあとで、範囲に入っていたアカウントの AWS WAF のコンソールを us-east-1 で開き、`FMManagedWebACLV2-` で始まる web ACL が残っていないかを見てください。

`false` のときは、リソースに関連付いている web ACL がそのまま残り、保護も料金も続きます。どのリソースにも付いていない、Firewall Manager が作った web ACL は、`false` でも消されます。

セキュリティグループの監査のポリシーは、メンバーアカウントにリソースを作りません。消しても、自動修復がすでに書き換えたり削除したりしたルールは、元に戻りません。

cdkd が Cloud Control API 経由でポリシーを消すときに、テンプレートの `DeleteAllPolicyResources` が削除の動作に反映されるかどうかは、確かめていません。CloudFormation のリファレンスは、このプロパティを「ポリシーを削除するときに使われる」と説明しています。

スタックが作っていないものは、消えません。

- AWS Config。各アカウントで有効にした recorder は動き続け、configuration item の料金がかかります
- Security Hub CSPM。有効にしたなら、無効にするまで料金がかかります。finding も残ります
- Firewall Manager の管理者アカウントの指定と、各アカウントのサービスリンクロール
- メール購読の確認待ちや、確認済みの購読。トピックと一緒に消えるはずですが、確かめていません

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト 94 件（範囲の判定、セキュリティグループの監査のルールと CIDR の包含、テンプレートからのルールの読み取り、2 つのポリシーの managed service data、web ACL の関連付けのモデルと、乱数の種を固定した 2,000 手の検査、finding のイベントの形と通知、料金の計算、2 つのスタックのアサーションとコンテキスト）。モデルの判定をわざと緩めたときに、不変条件のテストが落ちること。型検査。この章のパスへの `vp check --fix`（awscdk-lint を含む）。固定した cdkd での synth（`vp run fwm:infra:synth:example`）と、コンテキストなしの synth が止まること。合成された通知用の関数のバンドルを、テストランナーの外の Node.js で読み込むこと。`vp run fwm:cost` と `vp run fwm:audit:templates`（その時点で `cdk.out` があった 46 個のテンプレート）。いずれも 2026-10-13、macOS（Apple silicon）です。

**まだ確かめていないこと。** AWS に触るものは、すべて未実行です。組織を持っていないので、`fwm:infra:deploy`、`fwm:edge:infra:deploy`、`fwm:infra:diff`、`fwm:infra:drift`、`fwm:infra:destroy`、`fwm:edge:infra:destroy` のどれも動かしていません。とくに次の点は、実環境での確認待ちです。

- Firewall Manager の実際の判定が、この章のモデルと同じかどうか。範囲、`IncludeMap` と `ExcludeMap` の優先、タグの一致、「許された幅に収まる」の意味、送信元がセキュリティグループやプレフィックスリストのルールの扱い、送信ルールの扱い
- cdkd 0.296.28 が、Cloud Control API 経由で `AWS::FMS::Policy` と `AWS::FMS::NotificationChannel` を作成、更新、削除できること。`IncludeMap` の `ORGUNIT` というキー、文字列の `ManagedServiceData`、`DeleteAllPolicyResources` が受け付けられ、意図どおりに働くこと
- この章の managed service data が、サービスに受け付けられること。とくに `optimizeUnassociatedWebACL` と自動修復が無効の組み合わせで、web ACL が作られないこと
- `overrideCustomerWebACLAssociation` が `false` のときに、アカウントが自分で付けた web ACL がどうなるか。ドキュメントの 2 か所の記述のどちらが当てはまるか
- 新しいディストリビューションやセキュリティグループが作られてから、準拠の報告に出るまで、また web ACL が付くまでの時間
- 自動修復が、受信ルールを書き換えるのか削除するのか、その基準
- サービスリンクロールがまだ無いアカウントで、トピックのポリシーと通知チャンネルの作成がどうなるか。通知チャンネルがアカウントとリージョンにいくつ持てるか。SNS に届くメッセージの内容
- Firewall Manager の finding がどのアカウントとリージョンの Security Hub に届くか、finding の実際のフィールド、製品名でのフィルターが一致すること
- ポリシーを消したあとにメンバーアカウントに残るもの。持ち主がルールを足した web ACL、AWS Config のルール
- ポリシーの料金の日割り、CloudFront 用のポリシーの usage type、メンバーアカウントの web ACL のルールの数え方、Security Hub CSPM の料金
- Firewall Manager を使えるリージョンの一覧
- Cloudflare のアカウントレベルの WAF が Organization の複数のアカウントにまたがるか、Vercel にチーム全体のカスタムルールがあるか

**cdkd との関係。** 固定した版の cdkd（0.296.28）の、インストールされたパッケージの `dist/` を読んで確かめました。`AWS::FMS::Policy` と `AWS::FMS::NotificationChannel` には専用の実装が登録されておらず、Cloud Control API に回されます。Cloud Control API の対応表には、どちらのタイプも載っています。ほかのリソースタイプ（`AWS::EC2::VPC`、`AWS::EC2::SecurityGroup`、`AWS::SNS::Topic`、`AWS::SNS::TopicPolicy`、`AWS::SNS::Subscription`、`AWS::Events::Rule`、`AWS::Lambda::Function`、`AWS::Lambda::Permission`、`AWS::IAM::Role`、`AWS::Logs::LogGroup`）には、専用の実装が登録されています。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| Firewall Manager が答える問い | `examples/42-firewall-manager/` | なし |
| 使い始める前に要るもの | `examples/42-firewall-manager/infra/lib/config.ts`、`infra/bin/app.ts` | `fwm:infra:synth:example` |
| ポリシーの種類 | `examples/42-firewall-manager/src/policies.ts` | なし |
| 全体像 | `examples/42-firewall-manager/infra/bin/app.ts`、`infra/lib/edge-waf-policy-stack.ts`、`infra/lib/firewall-manager-stack.ts` | `fwm:infra:synth:example` |
| 向いていない場面 | `examples/42-firewall-manager/scripts/audit-templates.ts` | `fwm:audit:templates` |
| 範囲 | `examples/42-firewall-manager/src/org.ts`、`src/scope.ts`、`src/policies.ts`、`infra/lib/scope-props.ts`、`test/scope.test.ts` | `test:unit` |
| AWS WAF のポリシー | `examples/42-firewall-manager/src/policies.ts`、`src/managed-service-data.ts`、`infra/lib/edge-waf-policy-stack.ts`、`test/managed-service-data.test.ts`、`infra/test/stacks.test.ts` | `test:unit`、`fwm:infra:synth:example` |
| セキュリティグループの監査ポリシー | `examples/42-firewall-manager/src/security-group-audit.ts`、`src/cidr.ts`、`infra/lib/firewall-manager-stack.ts`、`test/security-group-audit.test.ts`、`scripts/audit-templates.ts` | `test:unit`、`fwm:audit:templates` |
| ポリシーが届くまでのあいだ | `examples/42-firewall-manager/src/reconcile.ts`、`test/reconcile.test.ts` | `test:unit` |
| 準拠の報告と通知 | `examples/42-firewall-manager/src/finding.ts`、`src/notify.ts`、`src/lambda.ts`、`infra/lib/firewall-manager-stack.ts`、`test/finding.test.ts`、`test/fixtures/finding-events.ts` | `test:unit` |
| 手元で動かす | `examples/42-firewall-manager/test/`、`infra/test/stacks.test.ts`、`scripts/cost.ts`、`scripts/audit-templates.ts` | `test:unit`、`fwm:cost`、`fwm:audit:templates`、`fwm:infra:synth:example` |
| デプロイして確かめる | `examples/42-firewall-manager/infra/bin/app.ts`、`infra/lib/config.ts` | `fwm:infra:deploy`、`fwm:edge:infra:deploy`、`fwm:infra:drift` |
| 料金 | `examples/42-firewall-manager/src/cost.ts`、`test/cost.test.ts`、`scripts/cost.ts`、`data/pricing/` | `fwm:cost`、`test:unit` |
| 上限と、ドキュメントが挙げている注意点 | `examples/42-firewall-manager/src/scope.ts`、`src/managed-service-data.ts` | なし |
| 片付け | `examples/42-firewall-manager/infra/lib/edge-waf-policy-stack.ts`、`infra/lib/firewall-manager-stack.ts` | `fwm:edge:infra:destroy`、`fwm:infra:destroy` |

**一次情報**（確認日はすべて 2026-10-13）

- Firewall Manager（AWS WAF, AWS Firewall Manager, and AWS Shield Advanced Developer Guide）: [概要](https://docs.aws.amazon.com/waf/latest/developerguide/fms-chapter.html)、[前提](https://docs.aws.amazon.com/waf/latest/developerguide/fms-prereq.html)、[Organizations への参加](https://docs.aws.amazon.com/waf/latest/developerguide/join-aws-orgs.html)、[デフォルトの管理者](https://docs.aws.amazon.com/waf/latest/developerguide/enable-integration.html)、[AWS Config の有効化](https://docs.aws.amazon.com/waf/latest/developerguide/enable-config.html)、[AWS RAM での共有](https://docs.aws.amazon.com/waf/latest/developerguide/enable-ram.html)、[管理者](https://docs.aws.amazon.com/waf/latest/developerguide/fms-administrators.html)、[管理者の作成](https://docs.aws.amazon.com/waf/latest/developerguide/fms-creating-administrators.html)、[デフォルトの管理者の変更](https://docs.aws.amazon.com/waf/latest/developerguide/fms-change-administrator.html)、[管理者の資格を失う変更](https://docs.aws.amazon.com/waf/latest/developerguide/disqualified-admin-account.html)、[ポリシーの種類](https://docs.aws.amazon.com/waf/latest/developerguide/working-with-policies.html)、[ポリシーの作成](https://docs.aws.amazon.com/waf/latest/developerguide/create-policy.html)、[ポリシーの範囲](https://docs.aws.amazon.com/waf/latest/developerguide/policy-scope.html)、[ポリシーの削除](https://docs.aws.amazon.com/waf/latest/developerguide/policy-deleting.html)、[AWS WAF のポリシー](https://docs.aws.amazon.com/waf/latest/developerguide/waf-policies.html)、[ルールグループの管理](https://docs.aws.amazon.com/waf/latest/developerguide/waf-policies-rule-groups.html)、[web ACL の管理](https://docs.aws.amazon.com/waf/latest/developerguide/how-fms-manages-web-acls.html)、[ログ](https://docs.aws.amazon.com/waf/latest/developerguide/waf-policies-logging-config.html)、[AWS WAF のポリシーの始め方](https://docs.aws.amazon.com/waf/latest/developerguide/getting-started-fms.html)、[セキュリティグループのポリシー](https://docs.aws.amazon.com/waf/latest/developerguide/security-group-policies.html)、[content audit](https://docs.aws.amazon.com/waf/latest/developerguide/security-group-policies-audit.html)、[common](https://docs.aws.amazon.com/waf/latest/developerguide/security-group-policies-common.html)、[usage audit](https://docs.aws.amazon.com/waf/latest/developerguide/security-group-policies-usage.html)、[Shield Advanced のポリシー](https://docs.aws.amazon.com/waf/latest/developerguide/shield-policies.html)、[network ACL のポリシー](https://docs.aws.amazon.com/waf/latest/developerguide/network-acl-policies.html)、[Network Firewall のポリシー](https://docs.aws.amazon.com/waf/latest/developerguide/network-firewall-policies.html)、[DNS Firewall のポリシー](https://docs.aws.amazon.com/waf/latest/developerguide/dns-firewall-policies.html)、[準拠の状態](https://docs.aws.amazon.com/waf/latest/developerguide/fms-compliance.html)、[Security Hub CSPM との連携](https://docs.aws.amazon.com/waf/latest/developerguide/fms-findings.html)、[AWS WAF のポリシーの finding](https://docs.aws.amazon.com/waf/latest/developerguide/waf-policy-findings.html)、[content audit の finding](https://docs.aws.amazon.com/waf/latest/developerguide/security-group-content-audit-policy-findings.html)、[AWS Config の finding](https://docs.aws.amazon.com/waf/latest/developerguide/aws-config-firewall-manager-findings.html)、[クォータ](https://docs.aws.amazon.com/waf/latest/developerguide/fms-limits.html)、[通知](https://docs.aws.amazon.com/waf/latest/developerguide/set-fms-alarms.html)、[サービスリンクロール](https://docs.aws.amazon.com/waf/latest/developerguide/fms-using-service-linked-roles.html)、[IAM との関係](https://docs.aws.amazon.com/waf/latest/developerguide/fms-security_iam_service-with-iam.html)
- Firewall Manager の API リファレンス: [Policy](https://docs.aws.amazon.com/fms/2018-01-01/APIReference/API_Policy.html)、[SecurityServicePolicyData](https://docs.aws.amazon.com/fms/2018-01-01/APIReference/API_SecurityServicePolicyData.html)、[ResourceTag](https://docs.aws.amazon.com/fms/2018-01-01/APIReference/API_ResourceTag.html)、[DeletePolicy](https://docs.aws.amazon.com/fms/2018-01-01/APIReference/API_DeletePolicy.html)、[PutNotificationChannel](https://docs.aws.amazon.com/fms/2018-01-01/APIReference/API_PutNotificationChannel.html)
- CloudFormation: [AWS::FMS::Policy](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-fms-policy.html)、[IEMap](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-fms-policy-iemap.html)、[AWS::FMS::NotificationChannel](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-fms-notificationchannel.html)、[Cloud Control API が対応するリソースタイプ](https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/supported-resources.html)
- AWS Organizations: [Firewall Manager との連携](https://docs.aws.amazon.com/organizations/latest/userguide/services-that-can-integrate-fms.html)、[OrganizationalUnit](https://docs.aws.amazon.com/organizations/latest/APIReference/API_OrganizationalUnit.html)、[SCP](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html)
- Security Hub CSPM: [AWS のサービスとの連携](https://docs.aws.amazon.com/securityhub/latest/userguide/securityhub-internal-providers.html)、[EventBridge のイベントの形式](https://docs.aws.amazon.com/securityhub/latest/userguide/securityhub-cwe-event-formats.html)、[イベントの種類](https://docs.aws.amazon.com/securityhub/latest/userguide/securityhub-cwe-integration-types.html)、[finding 用のルール](https://docs.aws.amazon.com/securityhub/latest/userguide/securityhub-cwe-all-findings.html)、[ASFF の必須の属性](https://docs.aws.amazon.com/securityhub/latest/userguide/asff-required-attributes.html)、[ASFF の任意の属性](https://docs.aws.amazon.com/securityhub/latest/userguide/asff-top-level-attributes.html)、[AwsSecurityFinding](https://docs.aws.amazon.com/securityhub/1.0/APIReference/API_AwsSecurityFinding.html)
- AWS WAF と SNS: [ルールの動作](https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-action.html)、[baseline rule groups](https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-baseline.html)、[IP reputation rule groups](https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-ip-rep.html)、[SNS の Publish](https://docs.aws.amazon.com/sns/latest/api/API_Publish.html)
- 料金: [Firewall Manager の料金](https://aws.amazon.com/firewall-manager/pricing/)、AWS Price List の [AWSFMS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSFMS/current/index.json)、[AWSConfig（us-east-1）](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSConfig/current/us-east-1/index.json)、[AWSConfig（ap-northeast-1）](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSConfig/current/ap-northeast-1/index.json)、[AWSNetworkFirewall（ap-northeast-1）](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSNetworkFirewall/current/ap-northeast-1/index.json)。AWS WAF の単価は 21章が 2026-10-12 に確認したものを使っています
- そのほか: [RFC 1918](https://www.rfc-editor.org/rfc/rfc1918.txt)（プライベートアドレスの 3 つのブロック）、[@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)（インストールされたパッケージの `dist/`）、[aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0)（`aws-fms` の型定義）
- Cloudflare: [アカウントレベルの WAF の設定](https://developers.cloudflare.com/waf/account/)、[アカウントレベルのマネージドルールセット](https://developers.cloudflare.com/waf/account/managed-rulesets/)、[Organizations](https://developers.cloudflare.com/fundamentals/organizations/)
- Vercel: [Vercel Firewall](https://vercel.com/docs/vercel-firewall)、[Vercel WAF](https://vercel.com/docs/vercel-firewall/vercel-waf)、[IP blocking](https://vercel.com/docs/vercel-firewall/vercel-waf/ip-blocking)

:::
