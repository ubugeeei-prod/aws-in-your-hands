---
title: "46 Shield: DDoS への備え、Standard と Advanced"
revision: 1
---

# 46 Shield: DDoS への備え、Standard と Advanced

AWS のアカウントは、何も設定しなくても AWS Shield Standard で DDoS から守られています。有料の Shield Advanced は月額 USD 3,000 で、1 年の約束が付きます。この本の読者のほとんどに要るのは、Advanced の契約ではありません。Standard が守る範囲を知ったうえで、その外側を構成で埋めることです。この章では、その構成を作って確かめます。

確かめる方法は 2 つあります。1 つは、synth したテンプレートを読んで、CloudFront を通らずに届くオリジンが無いかを調べる検査です。もう 1 つは、乱数の種を固定したシミュレーションで、大量のリクエストがレートベースのルール、キャッシュ、関数の歯止めのどこで止まり、どれだけが関数まで届き、その 1 時間がいくらになるかを数えます。

**Shield Advanced を契約すると、12 か月で USD 36,000 かかります。** この章のスタックは契約をしません。契約済みのアカウント向けに、保護を足すフラグを用意してあるだけで、既定ではオフです。

前提は [03章](/ja/chapters/03-spa.md)の CloudFront、[12章](/ja/chapters/12-containers.md)の ALB、[21章](/ja/chapters/21-security.md)の web ACL です。スロットリングと再試行は [32章](/ja/chapters/32-limits.md)で扱ったので、ここでは繰り返しません。コードは `examples/46-shield/` にあります。

## 全体像

<!-- section: 46.overview -->

```figure
caption: リクエストが関数に届くまでに通るもの。攻撃のリクエストを落とせる場所が、手前から順に並んでいる
node client: Client | 利用者も、攻撃者も
node shield: Shield Standard | レイヤー 3、4。常時、無料
node waf: AWS WAF | レートベースのルール。任意、月額
node cf: CloudFront | /health はキャッシュから返す
node url: function URL | AWS_IAM。署名できるのは CloudFront だけ
node fn: Lambda | 04章のアプリ。予約済み同時実行数は任意
edge client -> shield: HTTPS
edge shield -> waf
edge waf -> cf
edge cf -> url: SigV4 で署名
edge url -> fn
edge client -x url: 直接呼ぶと 403
group edge: AWS のエッジ = shield, waf, cf
group region: ap-northeast-1 = url, fn
mark url
```

スタックは 2 つです。

<<< @/examples/46-shield/infra/bin/app.ts{stacks}

`AihShield` は、[04章](/ja/chapters/04-http-api.md)のノート API を Lambda に載せ、CloudFront だけが呼べる function URL の後ろに置きます。置いておくだけなら料金はかかりません。`AihShieldEdge` は us-east-1 に作る web ACL とアラームで、月額がかかるので、名前を指定したときだけデプロイします。

2 つのスタックとシミュレーションは、同じ定義を読みます。テストで流す大量のリクエストが当たるのは、デプロイされるのと同じ数字です。

<<< @/examples/46-shield/src/defences.ts{defences}

## すでに持っている防御

<!-- section: 46.standard -->

DDoS（distributed denial of service）は、多数の送信元から通信を送りつけて、本来の利用者が使えない状態にする攻撃です。Shield のドキュメントは、攻撃を 3 つに分けています。回線やリソースの容量を埋めるネットワーク層（レイヤー 3）の攻撃、TCP の SYN フラッドのようにプロトコルの状態を使い切らせるトランスポート層（レイヤー 4）の攻撃、そして正しい形の HTTP リクエストを大量に送るアプリケーション層（レイヤー 7）の攻撃です。

Shield Standard は、AWS を使うすべてのアカウントに、追加料金なしで最初から付いています。有効にする操作はありません。守るのは、よくあるレイヤー 3 と 4 の攻撃です。

守られ方は、入口がどこにあるかで変わります。ドキュメントによると、CloudFront と Route 53 では、届くパケットすべてを経路の途中にある緩和の仕組みが検査していて、攻撃はその場で緩和されます。Shield Advanced を契約しているかどうかは関係ありません。CloudFront は Web アプリとして正しい通信だけを通し、TLS もエッジで終端するので、オリジンに届くのは形の整った HTTP リクエストだけになります。

リージョンに置いた ALB や Elastic IP アドレスでは、仕組みが違います。Shield は 1 分ごとにリソースへの通信量を評価し、そのリソースの容量を超えたと判断したときに緩和を置きます。ドキュメントは、この緩和が DDoS の通信を減らすが、なくすとは限らない、と書いています。

このことから、最初の指針が決まります。インターネットに向ける入口は CloudFront にして、ALB や関数を直接さらさない、というものです。CloudFront を入口にすれば、レイヤー 3 と 4 については、契約なしで AWS の用意したいちばん強い防御に入れます。

Standard がしないこともあります。レイヤー 7 の、正しい形のリクエストによる攻撃です。ドキュメントは、アプリケーション層の攻撃について、AWS は検知して Shield Advanced の利用者に知らせようとするが、正当な利用者を止めないよう、既定では緩和を自動で適用しない、と書いています。正しい形のリクエストが大量に届いたとき、それを数えて止めるのは利用者の側の仕事です。[しくみと実装](/ja/chapters/46-shield/build.md)は、ほとんどがこの話です。

## Advanced が足すもの

<!-- section: 46.advanced -->

Shield Advanced は、契約したうえで、守りたいリソースを 1 つずつ指定して使います。契約しただけでは何も保護されません。指定できるのは、CloudFront のディストリビューション、Route 53 のホストゾーン、Global Accelerator の標準アクセラレーター、Elastic IP アドレス、ALB、Classic Load Balancer です。EC2 インスタンスと Network Load Balancer は、Elastic IP アドレスを通じて保護します。

指定したリソースに足されるものを、ドキュメントから拾うと次のとおりです。

- 検知の閾値が下がります。リージョンのリソースでは、計算した容量の半分で緩和が置かれます。Route 53 のヘルスチェックを結び付けると（health-based detection）、アプリが不調なときには、より小さな変化で検知されます
- Shield Response Team（SRT）に連絡できます。DDoS への対応を専門にするチームで、AWS WAF のログを分析し、承認を得たうえで web ACL にルールを足すこともします。ただし、**SRT を使うには Business か Enterprise のサポートプランが別に必要です**
- proactive engagement を設定すると、ヘルスチェックが不調になったときに、SRT のほうから連絡が来ます
- 攻撃で増えた料金の一部が、あとからクレジットで補填されます（cost protection）。対象は、CloudFront のリクエストとデータ転送、Route 53 のクエリ、ALB の capacity unit、攻撃に応じてオートスケーリングが起動した EC2 インスタンスなどに限られます
- 保護したリソースの AWS WAF の標準料金（web ACL、ルール、リクエスト）が、月 500 億件まで契約に含まれます
- protection group で、複数のリソースを 1 つのまとまりとして検知できます
- 検知と緩和のメトリクスが CloudWatch の `AWS/DDoSProtection` に出ます

cost protection には条件があります。攻撃の前から保護を付けていること、CloudFront と ALB では web ACL にブロックするレートベースのルールを入れてあること、DDoS への備えのベストプラクティスを実装していることです。申請は、攻撃のあった請求月が終わってから 15 日以内に、サポートのケースとして出します。クレジットは Shield Advanced の料金にしか使えません。Lambda の実行料金は、対象の一覧にありません。

レイヤー 7 の攻撃を自動で緩和する機能は、2026 年 3 月 26 日から形が変わっています。それまでの Shield Advanced の機能（automatic application layer DDoS mitigation）に代わって、AWS WAF の Anti-DDoS マネージドルールグループ（`AWSManagedRulesAntiDDoSRuleSet`）が既定になりました。このルールグループは Shield Advanced を契約していなくても使えます。CloudFront では月 USD 20 と、処理したリクエスト 100 万件あたり USD 0.15 が、web ACL の料金に加わります。この章のスタックには入れていません。

### 料金と約束

料金ページと Price List から読める内容は次のとおりです。確認日は 2026 年 10 月 13 日です。

- 月額は USD 3,000 です。同じ組織の一括請求にまとまっているアカウントなら、いくつ契約しても 1 つぶんです
- 契約には 1 年の約束が付き、毎年自動で更新されます。更新をやめるには、更新日の 30 日前から 5 日前までのあいだに、サポートに連絡します。途中で解約するにもサポートへの連絡が必要です
- 月額とは別に、保護したリソースからのデータ転送に料金がかかります。CloudFront からは、最初の 100 TB が 1 GB あたり USD 0.025 です
- cost protection を含むすべての特典は、1 年の約束を果たすことが条件です

### 契約しなくてよい場合

この本のサンプルを動かしているアカウントには、要りません。月に数ドルのスタックを、月 USD 3,000 で守ることになります。

本物のサービスでも、次のどれかに当てはまるなら、先にこの章の構成を整えるほうが効きます。

- 1 時間止まったときの損失が、月額よりずっと小さい
- 攻撃を受けている最中に SRT とやり取りできる人がいない。または Business 以上のサポートプランを契約していない
- 入口が CloudFront だけで、オリジンは閉じてあり、レートベースのルールと歯止めが入っている。この構成なら、レイヤー 3 と 4 は Standard が受け持ち、料金の上振れは[しくみと実装](/ja/chapters/46-shield/build.md)で見るとおり小さく抑えられます

AWS は、契約を検討する条件として次を挙げています。利用者への可用性を約束している、攻撃のときに専門家へすぐ連絡したい、攻撃を AWS の側から知らせてほしい、攻撃があっても費用を予測できるようにしたい、というものです。可用性が売上や契約に直結していて、対応する体制があるサービスが、これにあたります。

## この章が要らない場合

アプリがすべて Cloudflare Workers か Vercel の上にあるなら、DDoS の緩和はプラットフォームの仕事で、契約のプランを問わず付いています。違いは[最後のページ](/ja/chapters/46-shield/wrap.md)にまとめました。その場合でも、歯止めは利用者を攻撃と区別しない、という[シミュレーション](/ja/chapters/46-shield/build.md)の結果は、どの基盤でも同じように当てはまります。

AWS で公開しているものが、CloudFront と private な S3 バケットだけ（03章）の場合も、足すものはほとんどありません。関数も ALB も無ければ、守るオリジンも、膨らむ実行料金もありません。残るのは CloudFront のリクエスト料金とデータ転送だけで、その抑え方は[しくみと実装の「denial of wallet」](/ja/chapters/46-shield/build.md)にあります。
