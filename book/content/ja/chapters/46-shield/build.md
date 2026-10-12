---
title: "46 Shield: しくみと実装"
---

# 46 Shield: しくみと実装

[前のページ](/ja/chapters/46-shield.md)では、Shield Standard が受け持つのはレイヤー 3 と 4 で、正しい形のリクエストが大量に届く攻撃は利用者の側で止める、というところまで見ました。このページでは、その止める場所を手前から順に作ります。オリジンを閉じ、エッジで減らし、オリジンに歯止めを付け、最後に大量のリクエストを流して、何が届いていくらになるかを数えます。

## オリジンを閉じる

<!-- section: 46.origins -->

web ACL もキャッシュも、CloudFront に付いています。オリジンにインターネットから直接届く道が残っていると、攻撃する側は CloudFront を通らずにそこへ送るだけで、どちらも素通りできます。前のページで見た Shield Standard の強い防御も、CloudFront の側にあります。そのため、オリジンを閉じることが、ほかのすべての前提になります。

この章の不変条件は、**インターネットからオリジンに届くリクエストは、必ず CloudFront を通っている**、です。

閉じ方は、オリジンの種類で違います。

### function URL

Lambda の function URL は、認証の種類を `AWS_IAM` にすると、SigV4 で署名されたリクエストしか受け付けなくなります。署名するのは CloudFront の origin access control（OAC）です。09章と 21章で使った構成と同じです。

<<< @/examples/46-shield/infra/lib/shield-stack.ts{origin}

`withOriginAccessControl` は、CloudFront のサービスプリンシパルに関数の呼び出しを許可する `AWS::Lambda::Permission` を 2 つ作ります。どちらにも、このディストリビューションの ARN が `SourceArn` として入ります。`SourceArn` の無い許可は、どのアカウントのどのディストリビューションからでも呼べる許可になるので、あとで作る検査はここも見ます。

制約が 1 つあります。OAC を使うと、POST や PUT のリクエストでは、送る側が本文の SHA-256 を `x-amz-content-sha256` ヘッダーに入れなければなりません。Lambda が、署名されていない本文を受け付けないためです。このスタックは 09章や 21章と同じく、GET と HEAD だけを通します。書き込みを通すには、クライアントにこのヘッダーを付けさせる必要があり、この章では作っていません。

### ALB

12章の ALB はインターネットに向いていて、セキュリティグループはすべての送信元を許可していました。CloudFront を前に置いても、ALB の DNS 名を知っていれば直接届きます。

<<< @/examples/46-shield/infra/lib/alb-origin.ts{open}

CloudFront のドキュメントには、ALB を閉じる方法が 3 つあります。

1 つ目は、秘密のヘッダーです。CloudFront がオリジンへのリクエストに独自のヘッダーを足し、ALB のリスナーは、そのヘッダーがあるリクエストだけをターゲットへ転送して、ほかには 403 を返します。ヘッダーの名前と値が漏れると意味がなくなるので、ドキュメントは、認証情報と同じように扱うことと、CloudFront と ALB のあいだを HTTPS にすることを求めています。ALB はリクエストを受け取ってから断るので、ネットワークとしては開いたままです。

2 つ目は、セキュリティグループで、CloudFront のマネージドプレフィックスリスト（managed prefix list）だけを許可する方法です。`com.amazonaws.global.cloudfront.origin-facing` は、CloudFront がオリジンへ接続するサーバーの IP アドレス範囲を AWS がまとめたもので、中身は AWS が更新します。

<<< @/examples/46-shield/infra/lib/alb-origin.ts{prefix-list}

注意が 2 つあります。このプレフィックスリストは、セキュリティグループのルール 55 件ぶんとして数えられます。既定のクォータは 60 件なので、同じセキュリティグループに足せるルールは、あと 5 件です。また、このリストが通すのは CloudFront 全体です。ほかの人のディストリビューションも、同じ範囲から届きます。自分のディストリビューションに限るには、1 つ目のヘッダーと組み合わせます。

3 つ目は VPC origin で、AWS の DDoS 対策のホワイトペーパーが、新しく、推奨する方法として挙げているものです。ALB をプライベートサブネットに置き、パブリックなアドレスを持たせません。CloudFront は、VPC の中に作った自分用のネットワークインターフェースから ALB に接続します。追加料金はかからない、とホワイトペーパーにあります。

<<< @/examples/46-shield/infra/lib/alb-origin.ts{vpc-origin}

ドキュメントにある条件は次のとおりです。VPC にインターネットゲートウェイが付いていること（経路には使われません）、ALB のセキュリティグループが CloudFront のプレフィックスリストか、CloudFront が作るセキュリティグループを許可していること、そして対応しているリージョンであることです。ap-northeast-1 は対応していますが、アベイラビリティゾーン `apne1-az3` は除かれています。

この 3 つの関数は、テストと本文のためのもので、この章のどのスタックにも入っていません。ALB は時間課金なので、デプロイできる形にはしませんでした。12章のスタックを直すときの材料として使ってください。

### API Gateway

API Gateway の API は、閉じられません。HTTP API にはセキュリティグループもリソースポリシーも無く、API Gateway が用意するエンドポイントは、インターネットから直接呼べます。ホワイトペーパーが REST API について勧めているのは、リージョンのエンドポイントの前に自分の CloudFront を置き、CloudFront が足す `x-api-key` ヘッダーで直接のアクセスを断り、メソッドごとにレートの上限を付けることです。これは、ALB の 1 つ目の方法と同じ種類の対策です。

この本の API の章（04章から 32章の多く）は HTTP API を直接公開しています。それらの歯止めは、32章で見たステージのスロットリングです。CloudFront も web ACL も前に無いので、この章の構成には入っていません。

### テンプレートで確かめる

オリジンが閉じているかどうかは、デプロイする前に、synth したテンプレートから読めます。判定は 4 つです。

<<< @/examples/46-shield/src/origins.ts{finding}

function URL は、認証の種類と、関数に付いた許可を見ます。

<<< @/examples/46-shield/src/origins.ts{function-url}

ALB は、`Scheme` と、セキュリティグループの受信ルールを見ます。

<<< @/examples/46-shield/src/origins.ts{load-balancer}

`bypassable` と `direct` の違いは、同じテンプレートの中のディストリビューションが、そのリソースをオリジンに指しているかどうかです。開いているオリジンの前に CloudFront があるのが `bypassable` で、web ACL を付けて安心しているぶん、こちらのほうが気づきにくくなります。

<<< @/examples/46-shield/src/origins.ts{check}

テストでは、手書きの JSON だけでなく、CDK が実際に出力したテンプレートにもこの検査をかけています。前の節の 3 つの ALB は、順に `bypassable`、`closed`、`closed` になります。

この本のスタックすべてにかけるタスクもあります。

```bash
vp run shield:origins
```

2026 年 10 月 13 日に、手元にあった 56 個のテンプレートに対して実行した結果の一部です。

```text
AihSecurity  (examples/21-security/cdk.out)
  closed     HandlerFunctionUrl003AF664  AWS::Lambda::Url
             AuthType AWS_IAM, and no permission for an unnamed caller
AihLimits  (examples/32-limits/cdk.out)
  direct     ApiF70053CD  AWS::ApiGatewayV2::Api
             API Gateway serves it on a public endpoint of its own; its throttle is the only brake
AihFargate  (examples/41-fargate/cdk.out)
  direct     LoadBalancerBE9EEC3A  AWS::ElasticLoadBalancingV2::LoadBalancer
             internet-facing, and its security group admits 0.0.0.0/0 or ::/0
AihShield  (examples/46-shield/cdk.out)
  closed     HandlerFunctionUrl003AF664  AWS::Lambda::Url
             AuthType AWS_IAM, and no permission for an unnamed caller

56 templates, 28 function URLs, load balancers and APIs looked at.
report only: no stack was asked to be closed (--gate <stack>)
```

見つかった 28 個のうち、22 個が `direct`、6 個が `closed` でした。`direct` のほとんどは HTTP API で、練習用のスタックとしては意図どおりです。この章のスタックだけは、`closed` でなければ失敗する判定を `check:all` に入れてあります。

```bash
vp run shield:origins:gate
```

この検査に見えないものもあります。

- テンプレートの外にあるもの。別のスタックのセキュリティグループや、デプロイ時に決まる値は `unknown` になります
- プレフィックスリストの中身。ID が CloudFront のものかどうかは、テンプレートからは分かりません
- すべての送信元より狭い CIDR。誰の範囲なのかを判断できないので `unknown` にします
- パブリック IP アドレスを持つ EC2 インスタンスと、S3 バケット。インスタンスのセキュリティグループは [42章](/ja/chapters/42-firewall-manager.md)が、バケットの公開設定は [33章](/ja/chapters/33-production-readiness.md)が見ます
- 実物。テンプレートが閉じていても、あとからコンソールでルールを足せば開きます。それを見つけるのはドリフト検出です

## エッジで減らす

<!-- section: 46.edge -->

オリジンを閉じたら、次は CloudFront の側で、オリジンへ進むリクエストを減らします。方法は 2 つあります。キャッシュは、誰が送ったかに関係なく、同じ答えを返せるリクエストを吸収します。レートベースのルールは、送りすぎている送信元を止めます。

### キャッシュ

誰に対しても同じ答えになるルートは、CloudFront に答えさせられます。このアプリでは `/health` がそうです。アプリを包む関数を 1 つ足して、そのルートの成功した GET にだけ、共有してよいことを示すヘッダーを付けます。

<<< @/examples/46-shield/src/cache.ts{cache}

ほかのすべての応答には `no-store` を付けます。ヘッダーを付けないでおくと、キャッシュするかどうかがディストリビューションの既定の TTL に任されてしまうからです。

ディストリビューションの側では、このルートだけにキャッシュポリシーを当てます。

<<< @/examples/46-shield/infra/lib/shield-stack.ts{distribution}

使っているのは、マネージドポリシーの `CachingOptimized` です。このポリシーは、クエリ文字列も cookie もキャッシュキーに入れません。`/health?x=1`、`/health?x=2` と値を変えて送っても、CloudFront にとっては同じオブジェクトで、オリジンには進みません。自分で作ったポリシーでクエリ文字列をキーに入れると、この性質がなくなります。

キャッシュが切れた瞬間に同じルートへのリクエストが重なっても、オリジンへ進むのは 1 件です。CloudFront は、最初の 1 件の答えを待って、残りにも同じ答えを返します。ドキュメントは、この動作を request collapsing と呼んでいます。

知っておくことが 2 つあります。キャッシュは CloudFront の拠点ごとにあるので、オリジンに届くのは「5 秒に 1 件」ではなく「拠点ごとに 5 秒に 1 件」です。また、キャッシュされた応答は丸ごと使い回されるので、04章のアプリが付ける `x-request-id` も、最初の 1 件のものがそのまま返ります。

### レートベースのルール

キャッシュできないルートには、送信元ごとの上限を置きます。

<<< @/examples/46-shield/infra/lib/edge-stack.ts{web-acl}

1 つの IP アドレスからのリクエストが、直近 60 秒で 300 件を超えたら、そのアドレスをブロックします。21章の web ACL は 5 分で 300 件でした。ここでは、振り返る時間を短くして、ならして毎秒 5 件までにしています。会社や学校のように、多くの人が 1 つのアドレスを共有している送信元を止めにくくするためです。数字は、自分のサービスの利用のしかたに合わせて決めます。

アクションは、数えるだけの `count` ではなく `block` です。Shield Advanced の cost protection も、ブロックするレートベースのルールを条件にしています。

このルールは、正確な制限ではありません。AWS WAF のドキュメントは次のように書いています。レートは見積もりで、設定した上限の近くで制限するが、ぴったり一致することは保証しない。上限を超えてから検知して制限するまでに、数分かかることがあり、ふつうは 30 秒未満である。設定を変えると数え直しになり、最大で 1 分、制限が止まることがある。1 つのルールが同時に制限できる IP アドレスは 10,000 個までで、それより多くが上限を超えたときは、レートの高いものから制限される。

ルールがブロックを始めたら、気づけるようにしておきます。

<<< @/examples/46-shield/infra/lib/edge-stack.ts{alarm}

CloudFront 用の web ACL のメトリクスは us-east-1 に出るので、アラームもこのスタックに置きます。アラームが知らせるのは、誰かが上限を超えた、という事実だけです。壊れたスクリプトのことも、攻撃の最初の 1 分のこともあります。

## オリジンの歯止め

<!-- section: 46.brake -->

エッジを通り抜けたリクエストは、すべて関数を動かします。最後の歯止めは、関数が同時に動く数の上限です。

<<< @/examples/46-shield/infra/lib/shield-stack.ts{function}

予約済み同時実行数を付けた function URL について、Lambda のドキュメントは次のように書いています。1 秒あたりに受け付けるリクエストの上限は、予約済み同時実行数の 10 倍である。同時実行数かこの上限を超えると、function URL は 429 を返す。設定に追加の料金はかからない。

<<< @/examples/46-shield/src/defences.ts{brake}

`-c reservedConcurrency=20` なら、関数まで届くのは毎秒 200 件までです。あとのシミュレーションでは、この上限をトークンバケットとして扱います。レートはドキュメントの値で、バーストの大きさはこの章の仮定です。

既定でオフにしてある理由は、32章と同じです。予約できるのは、アカウントの同時実行数から 100 を引いた数までなので、クォータが小さいアカウントではデプロイが断られます。

`-c reservedConcurrency=0` は、設定の検査で断るようにしてあります。0 は、すべてのリクエストを 429 にする値です。スタックの設定として残すものではなく、攻撃の最中に手で打つ非常停止として、[デプロイのページの手順](/ja/chapters/46-shield/deploy.md)に置きました。

## 大量のリクエストを流してみる

<!-- section: 46.flood -->

ここまでの 3 つが、どんな攻撃に効いて、どんな攻撃に効かないのかを、シミュレーションで確かめます。32章のものと同じく、乱数の種を固定してあり、何度実行しても同じ結果になります。トークンバケットと乱数は 32章のコードを使います。

<<< @/examples/46-shield/src/flood.ts{scenario}

送信元は、同じ振る舞いをするアドレスのまとまりで表します。利用者は 200 アドレスで、それぞれ 2 秒に 1 件、合わせて毎秒 100 件を送ります。攻撃は、どの場合も合わせて毎秒 5,000 件で、違うのは、それを何個のアドレスで分けるかと、どのルートに送るかです。

<<< @/examples/46-shield/src/flood.ts{scenarios}

1 秒ごとに、レートベースのルール、キャッシュ、歯止めの順に通します。

<<< @/examples/46-shield/src/flood.ts{run}

```bash
vp run shield:flood
```

```text
One hour. 100 requests a second from users; 5,000 a second of attack for 50 minutes.

attack                            defences                      blocked      cached       throttled    ran function users*       USD
20 addresses                      none                          0            0            0            15360000     100.0%       25.73
20 addresses                      rate rule                     14845000     0            0            515000       100.0%       10.08
20,000 addresses                  rate rule                     0            0            0            15360000     100.0%       34.95
20,000 addresses                  rate rule, brake              0            0            14699981     660019       4.0%         27.96
20,000 addresses, cached route    cache                         0            15071280     0            288720       100.0%       20.21

The same 5,000 a second for 30 days with nothing in front: USD 21660.02
  cloudfront.jp.request.https   15552.00
  cloudfront.jp.transfer        1356.01
  lambda.request.arm            2592.00
  lambda.duration.arm           2160.01

* The share of the users' requests answered while the attack runs.
USD is the list price of that hour's usage: CloudFront, AWS WAF where attached, Lambda.
A model with stated assumptions (src/flood.ts, src/bill.ts), not a measurement.
```

表の行を、上から読みます。

1 行目は、何も置かなかった場合です。1,500 万件すべてが関数を動かします。利用者は困りません。Lambda はこの流量を処理できる前提で、モデルにはアカウントの同時実行数の上限を入れていないからです。困るのは請求のほうです。

2 行目は、同じ攻撃にレートベースのルールを置いた場合です。20 個のアドレスはどれも 2 秒で上限を超え、30 秒後にブロックされます。関数に届く攻撃は 15 万 5,000 件で止まり、利用者は 1 件も止められません。少ない送信元からの攻撃には、このルールがよく効きます。

3 行目は、同じ毎秒 5,000 件を、20,000 個のアドレスに分けた場合です。1 つのアドレスは 4 秒に 1 件しか送らないので、60 秒で 15 件にしかならず、上限の 300 件には遠く届きません。ルールは 1 件も止めず、検査の料金だけが増えます。送信元ごとに数えるルールは、十分に分散した攻撃を見つけられません。

4 行目は、そこに歯止めを足した場合です。関数に届くのは毎秒 200 件までになります。ただし、歯止めは誰が送ったかを見ません。毎秒 5,100 件のうち 200 件が通るだけなので、攻撃のあいだ、利用者のリクエストも 4.0% しか通りません。**歯止めが守るのは、関数とその後ろにあるものであって、利用者ではありません。**

5 行目は、同じ分散した攻撃が、キャッシュされるルートに向かった場合です。このルートのために関数が動くのは、5 秒ごとの入れ直しの 720 回だけで、残りは CloudFront が答えます。ルールも歯止めも要りません。

分散した攻撃を、利用者を止めずに止めるには、送信元の数ではなく、リクエストの中身や振る舞いで見分ける仕組みが要ります。AWS でそれにあたるのが、前のページで触れた Anti-DDoS マネージドルールグループと、Bot Control、そして Shield Advanced の SRT です。どれも、この章では試していません。

このモデルが置いている仮定は、次のとおりです。

- レートベースのルールは、アドレスが上限を超えた状態が 30 秒続いたら、そのアドレスをブロックします。30 秒は、ドキュメントが「ふつうはそれ未満」と書いている値です。実際の遅れは計っていません
- ルールは、ブロックしたリクエストも数え続けます。送り続けているアドレスは、ブロックされたままです。これは、ドキュメントの文面からの読み取りです
- CloudFront の拠点は 1 つとして扱います。実際のキャッシュは拠点ごとです
- 断られたリクエストは、オリジンに負荷をかけません。遅延も再試行も入れていません。断られた利用者が再試行すると何が起きるかは、32章のシミュレーションが扱っています

テストは、この表の性質を固定しています。すべてのリクエストがどれか 1 つの結果に数えられること、ルールが上限ちょうどでは止めず、超えたら止めること、歯止めを超えて関数が動く秒が無いこと、攻撃が終わった 1 秒後には利用者が元どおり通ること、などです。

## denial of wallet

<!-- section: 46.wallet -->

従量課金のサービスでは、攻撃の目的が、止めることではなく請求を膨らませることになりえます。これを denial of wallet と呼びます。サービスは動き続けるので、最初に気づくのが請求書になりやすい攻撃です。

シミュレーションの結果を、料金の行に直します。

<<< @/examples/46-shield/src/bill.ts{items}

金額は、この行を `data/pricing/` の単価に掛けて出しています。応答 1 件を 1,024 バイト、関数の 1 回の実行を 256 MB で 50 ms と仮定しました。どちらも計った値ではありません。

さきほどの表の USD の列から、3 つのことが読めます。

1 つ目は、このスタックでいちばん高いのが関数ではなく、CloudFront のリクエスト料金だということです。1 行目の USD 25.73 のうち、18.43 が CloudFront のリクエストで、Lambda は 5.63 です。

2 つ目は、歯止めが CloudFront の料金を減らさないことです。4 行目で関数の実行は 23 分の 1 になりましたが、429 を返したリクエストにも CloudFront のリクエスト料金はかかるので、合計は USD 27.96 で、ルールだけの 3 行目（34.95）から 6.99 しか下がりません。

3 つ目は、AWS WAF がブロックしたリクエストには、CloudFront の料金がかからないことです。2024 年 10 月 25 日からそうなっています。2 行目の USD 10.08 のうち 9.22 は AWS WAF の検査の料金で、こちらはブロックしたぶんにもかかります。21章が「確かめていません」としていた点は、これで埋まりました。

1 時間なら、どの行も数十ドルです。問題は、止めるものが無いまま続いたときです。同じ毎秒 5,000 件が 30 日続くと、定価で **USD 21,660.02** になり、そのうち 15,552.00 が CloudFront のリクエストです。Shield Advanced の月額の 7 倍を超えます。

請求に天井を作る方法を、効く順に並べます。

- web ACL でブロックする。ブロックしたぶんは CloudFront の料金が消え、残るのは検査の 100 万件あたり USD 0.60 です。ただし、ルールが見つけられる攻撃にしか効きません
- CloudFront の flat-rate pricing plan に入る。ディストリビューションごとの月額のプランで、ドキュメントは、トラフィックの急増や攻撃があっても超過料金はかからない、と書いています。Free は月 100 万リクエストと 100 GB、Pro は月 USD 15 で 1,000 万リクエストと 50 TB が目安の量です。AWS WAF がブロックしたリクエストは、この量に数えられません。量を大きく超える状態が続くと、遠い拠点から配信されるなど、性能が落とされることがあります
- オリジンの歯止めを付ける。CloudFront の料金は減りませんが、関数と、その後ろにある従量課金のもの（[17章](/ja/chapters/17-ai.md)のモデルの呼び出し、[05章](/ja/chapters/05-dynamodb.md)のテーブルへの書き込み）に天井ができます。後ろにあるものが高いほど、効き目が大きくなります

flat-rate pricing plan には制約があります。Shield Advanced を有効にしたディストリビューションは入れません。AWS Free Tier を使っているアカウントも対象外です。プランには web ACL が必須で、プランが受け持つのは CloudFront、AWS WAF、Route 53 などの料金だけなので、Lambda の実行料金は別にかかります。この章ではプランを試していません。

予算（01章、32章）は、ここには入りません。予算は通知であって、止める仕組みではなく、更新も 1 日に数回です。気づくための道具としては要りますが、天井にはなりません。

## Advanced の保護をスタックに入れる

<!-- section: 46.advanced-stack -->

Shield Advanced を契約済みのアカウントのために、保護を足す部分を用意してあります。

<<< @/examples/46-shield/infra/lib/edge-stack.ts{advanced}

`-c shieldAdvanced=on` と `-c distributionArn=<ARN>` の両方を付けたときだけ、この部分がテンプレートに入ります。ARN だけを渡してもオンにはなりません。

**このフラグは、契約をしません。** 契約は、コンソールか API から人が行う操作で、CloudFormation のリソースにはありません。契約していないアカウントでこのフラグを付けてデプロイすると、保護の作成が失敗するはずです。どう失敗するかは、確かめていません。

入れたのは、ディストリビューションの保護 1 つと、`DDoSDetected` のアラームだけです。AWS は、保護したリソースごとに、このメトリクスが 0 でなくなったら知らせるアラームを勧めています。値が 0 でないことは、必ずしも攻撃を意味しない、とも書いています。

入れなかったものと、その理由は次のとおりです。

- ヘルスチェック（`HealthCheckArns`）。health-based detection と proactive engagement の前提ですが、何をもって健全とするかはサービスごとに決めるもので、Route 53 のヘルスチェックにも料金がかかります
- 以前の自動緩和（`ApplicationLayerAutomaticResponseConfiguration`）。前のページのとおり、新しく契約した利用者は既定で使えません
- protection group。リソースが 1 つでは意味がありません
- SRT にアカウントへのアクセスを許すロールと、proactive engagement の連絡先。人の連絡先と権限の話で、練習用のスタックに既定値を置けません

`AWS::Shield::Protection` には、固定した版の cdkd に専用の実装がありません。Cloud Control API の対応表には載っているので、その経路で作られるはずですが、試していません。
