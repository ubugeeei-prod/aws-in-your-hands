---
title: "46 Shield: 費用、注意点、片付け"
---

# 46 Shield: 費用、注意点、片付け

## 料金

<!-- section: 46.cost -->

このページでは、この章で足したものにいくらかかるかを見ます。金額は USD、定価、税別で、確認日は 2026 年 10 月 13 日です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

**既定の `AihShield` は、誰も呼ばなければ 0 です。** 関数、function URL、ディストリビューション、origin access control のどれにも、置いておくだけでかかる料金はありません。Shield Standard も無料です。

**`AihShieldEdge` は、リクエストが無くても月 6.10 です。** web ACL が 5.00、ルール 1 つが 1.00、アラーム 1 つが 0.10 です。web ACL の料金は、ディストリビューションに付けていなくても、作った時点から始まります。21章の web ACL（月 8.00）と両方を置く理由はないので、どちらかにしてください。us-east-1 のアラームが、CloudWatch の無料枠を ap-northeast-1 のアラームと共有するかどうかは確かめていないので、引いていません。

**Shield Advanced を契約すると、月 3,000.20、12 か月で 36,002.40 です。** 契約が 3,000.00、アラーム 2 つが 0.20 です。保護したディストリビューションの web ACL とルールは、Price List で 0 になる usage type が用意されているので、この計算には入れていません。データ転送の追加料金（CloudFront からは 1 GB あたり 0.025）と、SRT を呼ぶのに要るサポートプランの料金は含めていません。スタックを消しても、契約は続きます。

使ったときの料金は、リクエスト 1 件あたりで 21章の構成とほぼ同じです。web ACL を付けていれば、検査の料金が 100 万件あたり 0.60 加わります。大量のリクエストが届いた 1 時間と、それが 30 日続いた場合の金額は、[しくみと実装の「denial of wallet」](/ja/chapters/46-shield/build.md)にあります。

## Workers や Vercel から来た人へ

<!-- section: 46.compare -->

Cloudflare と Vercel では、DDoS の緩和はプラットフォームに含まれています。以下は 2026 年 10 月 13 日に公式ドキュメントで読んだ内容です。

| | Cloudflare | Vercel | この章（AWS） |
| --- | --- | --- | --- |
| DDoS の緩和 | レイヤー 3 から 7 まで、Free を含むすべてのプランに含まれる | レイヤー 3、4、7 を、すべてのプランで自動で緩和 | レイヤー 3、4 は Shield Standard。レイヤー 7 は、自分で web ACL、キャッシュ、歯止めを置く |
| 攻撃のぶんの料金 | DDoS の通信は、請求の仕組みが使用量から除く | ファイアウォールが止めた通信には料金がかからない。緩和が始まる前に返したリクエストと、DDoS と判定されなかったリクエストには、使用量がかかる | AWS WAF が止めたぶんは、CloudFront の料金がかからない。通ったぶんはすべてかかる |
| 送信元ごとの制限 | レート制限のルールが Free にもある。Free と Pro は IP で数える | Vercel WAF のレート制限が、すべてのプランにある | レートベースのルール。web ACL とルールに月額がかかる |
| 手で打つ非常手段 | この章では確認していません | Attack Mode。訪問者全員にチャレンジを出す。すべてのプランで無料 | 予約済み同時実行数を 0 にする。チャレンジは AWS WAF にあるが、この章では使っていない |
| 請求の天井 | Workers の CPU 時間に上限を設定できる | Spend Management。決めた金額でプロジェクトを止められる（Pro） | 予算は通知だけ。CloudFront の flat-rate pricing plan が、超過料金なしの月額 |
| 専門チーム | この章では確認していません | この章では確認していません | Shield Advanced の SRT。月 3,000 と、Business 以上のサポートプラン |

いちばん大きな違いは、オリジンという考え方です。Workers では、コードは Cloudflare のネットワークの中で動いていて、その後ろに別のオリジンを置きません。この章が最初に時間をかけて閉じたものが、最初から無いことになります。Workers から外のオリジン（自分のサーバーや AWS の API）を呼んでいる場合は別で、そのオリジンには、この章と同じ問題があります。

料金の考え方も違います。Cloudflare は、DDoS と判定した通信を請求から除く、と書いています。AWS で除かれるのは、AWS WAF がブロックしたリクエストの CloudFront の料金だけで、ブロックするルールを置くのも、その検査の料金を払うのも利用者です。flat-rate pricing plan に入れば近い形になりますが、プランが受け持つのは CloudFront の側だけです。

どちらの基盤でも変わらないこともあります。判定をすり抜けたリクエストは、ふつうの使用量として数えられます。Vercel のドキュメントは、そのことをはっきり書いています。攻撃と利用者の区別が付かない場面で請求とサービスのどちらを守るかは、どこにいても自分で決めることです。

アプリが Workers か Vercel の上で足りているなら、DDoS のために AWS へ移る理由はありません。AWS で同じ安心を得るには、この章のぶんだけ部品が増えます。

## つまずきやすいところ

| こうなったら | ここを見る |
| --- | --- |
| CloudFront の URL が 403 を返す | function URL の認証が `AWS_IAM` で、CloudFront に許可が無い状態です。`AWS::Lambda::Permission` が 2 つあり、どちらの `SourceArn` もこのディストリビューションを指しているかを見ます |
| POST が 403 になる | 仕様です。このスタックは GET と HEAD だけを通します。OAC の後ろに POST を通すには、送る側が `x-amz-content-sha256` を付ける必要があります |
| `/health` がキャッシュされない | 応答の `cache-control` を見ます。`no-store` なら、アプリの側で対象のルートと判定されていません。パスが `/health` と完全に一致したときだけ付きます |
| 利用者ごとに違う応答がキャッシュされた | `SHARED_CACHE` に入れてよいのは、誰が呼んでも同じ答えになるルートだけです。サインインが関わるルートを入れてはいけません |
| `shield:edge:infra:deploy` が synth で止まる | このスタックは us-east-1 にしか作れません。`-c shieldAdvanced=on` を付けたなら `-c distributionArn` も必要です |
| レートベースのルールが、上限ちょうどで止めない | 仕様です。見積もりで動き、遅れもあります。上限は、少し超えて通っても困らない値にします |
| 会社や学校からの利用者がまとめて止められた | 多くの人が 1 つの IP アドレスを共有しています。上限を上げるか、数える単位を変えます。単位の変え方は、この章では扱っていません |
| `-c reservedConcurrency` を付けたデプロイが断られる | アカウントの同時実行数のクォータです。32章の `vp run limits:quotas --service lambda` で値を見ます |
| 歯止めを付けたら、ふだんから 429 が出る | 予約済み同時実行数の 10 倍が、毎秒の上限です。ふだんの最大の流量より上に置きます |
| アラームが鳴らない | `-c alarmTopicArn` を渡していなければ、通知先がありません。渡せるのは us-east-1 のトピックです |
| `shield:origins` が `unknown` を出す | テンプレートだけでは判断できない、という意味です。セキュリティグループが別のスタックにあるか、値がデプロイ時に決まります。実物を見て確かめます |

## 本番にするなら

- 入口を 1 つにします。この本の API の章は HTTP API を直接公開しています。本番で CloudFront と web ACL の後ろに置くなら、オリジンを function URL か、VPC origin の後ろの ALB にするのが、この章で確かめた閉じ方です
- 書き込みを通します。OAC の後ろで POST を使うには、クライアントが本文の SHA-256 を送る必要があります。この章では作っていません
- レートベースのルールの数字を、自分のサービスの利用から決めます。まず `count` で 1 週間ほど様子を見て、止まるはずだった件数を確かめてから `block` にします
- 認証の前にあるルートを見直します。サインインしていなくても関数を動かせるルートが、攻撃の的になります。キャッシュできるものはキャッシュし、できないものは軽くします
- Anti-DDoS マネージドルールグループを検討します。分散した攻撃を、送信元の数ではなく振る舞いで見分けるためのものです。月額とリクエスト料金がかかり、この章では試していません
- web ACL のログを残します。攻撃のあとで何が届いたかを調べる材料になります。保存先と料金は 21章と 26章にあります
- 関数の後ろにある従量課金のものに、それぞれ上限を置きます。テーブルの request unit の上限（32章）、モデルの呼び出しの上限（17章）です
- 手順書を書き、誰が非常停止を判断するかを決めます。[デプロイのページ](/ja/chapters/46-shield/deploy.md)が出発点になります
- Shield Advanced を契約するなら、ヘルスチェック、proactive engagement の連絡先、SRT へのアクセスの許可まで設定します。契約しただけ、保護を付けただけでは、特典の多くは働きません
- 反映の経路を AWS CDK CLI と CloudFormation にします。理由は 02章に書いたとおりです

## 片付け

<!-- section: 46.cleanup -->

web ACL を付けている場合は、付けたときと逆の順に消します。先に `webAclArn` なしでデプロイして、ディストリビューションから外します。

```bash
vp run shield:infra:deploy
vp run shield:edge:infra:destroy
vp run shield:infra:destroy
```

2 行目で web ACL とアラームが消え、月額が止まります。3 行目でディストリビューション、関数、ロググループが消えます。

スタックと一緒に消えないものがあります。

- Shield Advanced の契約。スタックが作ったのは保護だけで、契約は残り、月額もかかり続けます。解約と自動更新の停止は、[概要のページの「料金と約束」](/ja/chapters/46-shield.md)に書いたとおり、サポートに頼みます
- flat-rate pricing plan。プランに入れたディストリビューションは、プランを解約するまで削除できない、とドキュメントにあります
- 自分で作った SNS のトピック
- 手で変えた予約済み同時実行数は、関数と一緒に消えます

ほかに残るのは、cdkd の bootstrap で作った保存場所（02章）だけです。us-east-1 にも作っていれば、そちらにも残ります。

## 分散システムとして見ると

DDoS への備えは、自分では持っていない状態に頼る設計です。

- 状態の持ち主: 送信元ごとの件数は AWS WAF が、キャッシュは CloudFront の拠点それぞれが、同時実行数は Lambda が持っています。どれも自分のコードからは読めず、見えるのはメトリクスだけで、それも遅れて届きます
- 不変条件: インターネットからオリジンに届くリクエストは、必ず CloudFront を通っている
- 不変条件を壊そうとするテスト: 認証なしの function URL、`SourceArn` の無い許可、すべての送信元を許可するセキュリティグループを、それぞれテンプレートにして検査にかけ、`closed` にならないことを確かめています。この章のスタックは、`closed` でなければ `check:all` が失敗します
- 数え方の正確さ: レートベースのルールの件数は見積もりで、効き始めるまでに遅れがあります。その遅れのあいだに届いたぶんは、オリジンまで進みます。シミュレーションでは、20 個のアドレスが止まるまでに 15 万 5,000 件が通りました
- 部分的な失敗: 歯止めは、攻撃と利用者を区別せずに断ります。関数は守れますが、サービスは利用者から見て止まっています。断られた利用者の再試行が負荷を増やすことは、32章で見たとおりです
- 整合性の範囲: キャッシュは拠点ごとです。ある拠点で切れても、ほかの拠点はまだ古い答えを返しています。5 秒のあいだは、拠点によって答えが違ってよいルートだけをキャッシュします

::: details この章の検証メモ

**手元で確かめたこと。** オリジンの検査、キャッシュのヘッダー、洪水のシミュレーション、料金の行とシナリオの一致、2 つのスタックのアサーション（6 ファイル、64 件）。型検査。`vp check --fix`（この章のパスだけ）。synth（esbuild のバンドル込み、2 つのテンプレート）。synth が作ったバンドルを Node.js で読み込み、function URL の形のイベントで `/health` と `/notes` を呼んで、`cache-control` が `public, max-age=5` と `no-store` になること。`vp run shield:infra:synth`、`vp run shield:origins:gate`、`vp run shield:flood`。本文の表は `shield:flood` の出力です。`shield:origins` は、スクリプト（`node examples/46-shield/scripts/origins.ts`）を、手元にあった 56 個のテンプレートに対して直接実行しました。タスクのほうは先に `infra:synth` で全章を synth しますが、それは実行していません。

**まだ確かめていないこと。** `shield:infra:deploy`、`shield:edge:infra:deploy`、`shield:infra:drift`、`shield:infra:destroy` は、実際の AWS では動かしていません。とくに次の点は、ドキュメントとテンプレートから読み取っただけです。

- function URL を直接呼ぶと 403 になること、`/health` が CloudFront でキャッシュされること、クエリ文字列を変えても同じオブジェクトになること
- レートベースのルールが、実際に何秒で効き始めるか。シミュレーションの 30 秒は仮定です。ブロックされたリクエストが数え続けられることも、文面からの読み取りです
- 予約済み同時実行数を付けた function URL が、10 倍の件数で 429 を返すこと。CloudFront がその 429 をどう扱うか。モデルのバーストの大きさは、この章の仮定です
- 断られた呼び出しに Lambda の料金がかかるかどうか。料金の計算では、関数が動いたぶんだけを数えています
- `AWS/WAFV2` の `BlockedRequests` を、CloudFront 用の web ACL に対して `WebACL` と `Rule` の 2 つのディメンションで引けること
- Shield Advanced に関するすべて。契約していません。`AWS::Shield::Protection` を cdkd が Cloud Control API 経由で作れること、CloudFront の保護を us-east-1 のスタックに書いてよいこと、`DDoSDetected` のディメンションの名前、契約前のデプロイの失敗のしかた。SRT、cost protection、proactive engagement、health-based detection は、ドキュメントを読んだだけです
- `AWS/DDoSProtection` に、契約していないアカウントで何か出るかどうか
- CloudFront の flat-rate pricing plan。この章のディストリビューションがプランに入れられるか、CloudFormation から指定できるか、量を超えたときの実際の挙動
- ALB を閉じる 3 つの形。テンプレートを synth して検査にかけただけで、デプロイしていません。ap-northeast-1 のプレフィックスリストの ID も調べていません
- Anti-DDoS マネージドルールグループ、Bot Control、AWS WAF のチャレンジ。名前と料金を読んだだけです
- Cloudflare と Vercel の記述は、公式ドキュメントのページを読んだものです。表の「この章では確認していません」は、読んだページに書かれていなかった、という意味です
- Shield の料金ページは、月額の数字がスクリプトで埋め込まれていて、取得した HTML には出ていませんでした。USD 3,000 は Price List の値です。1 年の約束は、料金ページの本文にあります

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 全体像 | `examples/46-shield/infra/bin/app.ts`、`src/defences.ts` | `shield:infra:synth` |
| オリジンを閉じる | `examples/46-shield/src/origins.ts`、`test/origins.test.ts`、`scripts/origins.ts`、`infra/lib/alb-origin.ts`、`infra/lib/shield-stack.ts` | `test:unit`、`shield:origins`、`shield:origins:gate` |
| エッジで減らす | `examples/46-shield/src/cache.ts`、`test/cache.test.ts`、`infra/lib/shield-stack.ts`、`infra/lib/edge-stack.ts`、`infra/test/` | `test:unit`、`shield:infra:synth` |
| オリジンの歯止め | `examples/46-shield/src/defences.ts`、`infra/lib/config.ts`、`infra/lib/shield-stack.ts` | `test:unit` |
| 大量のリクエストを流してみる | `examples/46-shield/src/flood.ts`、`src/runs.ts`、`test/flood.test.ts`、`scripts/flood.ts` | `test:unit`、`shield:flood` |
| denial of wallet | `examples/46-shield/src/bill.ts`、`test/pricing.test.ts` | `test:unit`、`shield:flood` |
| Advanced の保護をスタックに入れる | `examples/46-shield/infra/lib/edge-stack.ts`、`infra/lib/config.ts`、`infra/test/edge-stack.test.ts` | `test:unit`、`shield:edge:infra:deploy` |
| デプロイして確かめる | `examples/46-shield/infra/bin/app.ts`、`infra/lib/config.ts` | `shield:infra:diff`、`shield:infra:deploy`、`shield:edge:infra:deploy`、`shield:infra:drift` |
| 片付け | `tools/src/infra/` | `shield:infra:destroy`、`shield:edge:infra:destroy` |

**cdkd（0.296.28）での扱い。** 導入済みのパッケージの `dist/` で、プロバイダーの登録を確かめました。専用の実装があるもの: `AWS::CloudFront::Distribution`、`AWS::CloudFront::OriginAccessControl`、`AWS::IAM::Policy`、`AWS::IAM::Role`、`AWS::Lambda::Function`、`AWS::Lambda::Permission`、`AWS::Lambda::Url`、`AWS::Logs::LogGroup`、`AWS::WAFv2::WebACL`、`AWS::CloudWatch::Alarm`。既定の 2 つのスタックは、この 10 種類だけを使います。`-c shieldAdvanced=on` で入る `AWS::Shield::Protection` には登録が無く、Cloud Control API 経由になります。

**一次情報**（確認日は 2026-10-13）

- [How AWS Shield and Shield Advanced work](https://docs.aws.amazon.com/waf/latest/developerguide/ddos-overview.html)、[AWS Shield Standard overview](https://docs.aws.amazon.com/waf/latest/developerguide/ddos-standard-summary.html)、[AWS Shield Advanced overview](https://docs.aws.amazon.com/waf/latest/developerguide/ddos-advanced-summary.html)、[List of AWS resources that AWS Shield Advanced protects](https://docs.aws.amazon.com/waf/latest/developerguide/ddos-advanced-summary-protected-resources.html)、[AWS Shield Advanced capabilities and options](https://docs.aws.amazon.com/waf/latest/developerguide/ddos-advanced-summary-capabilities.html)、[Deciding whether to subscribe to AWS Shield Advanced](https://docs.aws.amazon.com/waf/latest/developerguide/ddos-advanced-summary-deciding.html)
- [AWS Shield detection logic for infrastructure layer threats](https://docs.aws.amazon.com/waf/latest/developerguide/ddos-event-detection-infrastructure.html)、[AWS Shield mitigation logic for CloudFront and Route 53](https://docs.aws.amazon.com/waf/latest/developerguide/ddos-event-mitigation-logic-continuous-inspection.html)、[Responding to DDoS events in AWS](https://docs.aws.amazon.com/waf/latest/developerguide/ddos-responding.html)
- [Managed DDoS event response with SRT support](https://docs.aws.amazon.com/waf/latest/developerguide/ddos-srt-support.html)、[Setting up proactive engagement](https://docs.aws.amazon.com/waf/latest/developerguide/ddos-srt-proactive-engagement.html)、[Health-based detection](https://docs.aws.amazon.com/waf/latest/developerguide/ddos-advanced-health-checks.html)、[Requesting a credit in AWS Shield Advanced after an attack](https://docs.aws.amazon.com/waf/latest/developerguide/ddos-request-service-credit.html)、[Automating application layer DDoS mitigation](https://docs.aws.amazon.com/waf/latest/developerguide/ddos-automatic-app-layer-response.html)、[Grouping your AWS Shield Advanced protections](https://docs.aws.amazon.com/waf/latest/developerguide/ddos-protection-groups.html)、[AWS Shield Advanced metrics](https://docs.aws.amazon.com/waf/latest/developerguide/shield-metrics.html)、[Subscribing to AWS Shield Advanced](https://docs.aws.amazon.com/waf/latest/developerguide/enable-ddos-prem.html)
- [AWS Shield Pricing](https://aws.amazon.com/shield/pricing/)、[DDoS Simulation Testing Policy](https://aws.amazon.com/security/ddos-simulation-testing/)
- [Rate-based rule high-level settings](https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based-high-level-settings.html)、[Rate-based rule caveats](https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based-caveats.html)、[Applying rate limiting to requests](https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based-request-limiting.html)、[Listing IP addresses that are being rate limited](https://docs.aws.amazon.com/waf/latest/developerguide/listing-managed-ips.html)、[AWS WAF DDoS prevention](https://docs.aws.amazon.com/waf/latest/developerguide/waf-anti-ddos.html)、[AWS WAF metrics and dimensions](https://docs.aws.amazon.com/waf/latest/developerguide/waf-metrics.html)
- [Restrict access to Application Load Balancers](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/restrict-access-to-load-balancer.html)、[Restrict access with VPC origins](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-vpc-origins.html)、[Restrict access to an AWS Lambda function URL origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html)、[Locations and IP address ranges of CloudFront edge servers](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/LocationsOfEdgeServers.html)、[AWS-managed prefix lists](https://docs.aws.amazon.com/vpc/latest/userguide/working-with-aws-managed-prefix-lists.html)
- [Use managed cache policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-cache-policies.html)、[Request and response behavior for custom origins](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/RequestAndResponseBehaviorCustomOrigin.html)、[Metric types for CloudFront](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/programming-cloudwatch-metrics.html)、[CloudFront flat-rate pricing plans](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html)、[Amazon CloudFront no longer charges for requests blocked by AWS WAF](https://aws.amazon.com/about-aws/whats-new/2024/10/amazon-cloudfront-charges-requests-blocked-aws-waf/)
- [Creating and managing Lambda function URLs](https://docs.aws.amazon.com/lambda/latest/dg/urls-configuration.html)、[Configuring reserved concurrency for a function](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html)
- AWS Best Practices for DDoS Resiliency: [Mitigation techniques](https://docs.aws.amazon.com/whitepapers/latest/aws-best-practices-ddos-resiliency/mitigation-techniques.html)、[Protecting your origin (BP1, BP5)](https://docs.aws.amazon.com/whitepapers/latest/aws-best-practices-ddos-resiliency/protecting-your-origin-bp1-bp5.html)、[Protecting API endpoints (BP4)](https://docs.aws.amazon.com/whitepapers/latest/aws-best-practices-ddos-resiliency/protecting-api-endpoints-bp4.html)
- [AWS::Shield::Protection](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-shield-protection.html)、[Resource types that support Cloud Control API](https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/supported-resources.html)、[@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)（導入済みのパッケージ）
- AWS Price List bulk API: [AWSShield](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSShield/current/index.json)、[awswaf](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/awswaf/current/index.json)、[CloudFrontPlans](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/CloudFrontPlans/current/index.json)、[AmazonCloudWatch（us-east-1）](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/us-east-1/index.json)
- [Cloudflare DDoS Protection](https://developers.cloudflare.com/ddos-protection/)、[FAQ](https://developers.cloudflare.com/ddos-protection/frequently-asked-questions/)、[Workers: Pricing](https://developers.cloudflare.com/workers/platform/pricing/)、[WAF: Rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)
- [Vercel Firewall](https://vercel.com/docs/vercel-firewall)、[Vercel: DDoS Mitigation](https://vercel.com/docs/vercel-firewall/ddos-mitigation)、[Vercel WAF: Rate Limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting)

:::
