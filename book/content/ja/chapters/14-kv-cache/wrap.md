---
title: "14 Cache: 費用、注意点、片付け"
---

# 14 Cache: 費用、注意点、片付け

## Workers KV や Durable Objects から来た人へ

<!-- section: 14.cloudflare -->

章の最後のページでは、Cloudflare の製品との対応、4 つの置き場所の選び方、料金、片付けをまとめます。

Cloudflare の側でも、KV にあたるものは 1 種類ではありません。確かめた範囲で並べます。

Workers KV は、ドキュメントの言葉では「結果整合の、エッジの key-value ストア」です。書いた拠点ではたいていすぐに見えますが、ほかの拠点に届くまでに 60 秒以上かかることがあります。読み取りが多くてキャッシュしやすいデータに向いていて、atomic な操作が要るなら向かないので Durable Objects を検討するように、とも書かれています。

Workers KV を AWS の 3 つのどれかに対応づけたくなりますが、重なり方がそれぞれ違うので、対応づけはしません。

- DynamoDB は、Worker にあたるコードから読み書きできる点が同じです。ただし 1 つのリージョンにあり、強い整合性の読み取りと条件付きの更新ができます。性質は、Workers KV よりもずっとデータベースに近いものです
- CloudFront KeyValueStore は、エッジで読める点と、更新が遅れて届く点が似ています。ただし関数からは書けず、桁違いに小さなデータしか置けません（値は 1 KB まで。Workers KV は 25 MiB まで）
- Valkey は、どちらにも似ていません。1 つのリージョンにある、メモリの上のサーバーです

レート制限のように正確に数える仕事は、Cloudflare でも Workers KV の役目ではありません。Durable Objects は、名前で一意に決まる、single-thread の小さな実体で、それぞれが強い整合性の保存領域を持ちます。同時に来たリクエストを 1 つずつ処理するので、この章が DynamoDB の条件式や Valkey のスクリプトで得た保証を、別の形で得ています。AWS には、Durable Objects に直接あたる部品はありません。

Workers には、レート制限専用のbinding（Rate Limiting binding）もあります。ドキュメントによると、数えるのは Cloudflare の拠点ごとで、「寛容で、結果整合で、正確な計数のためのものではない」とされています。この章の DynamoDB 版は、その逆を選び、1 つのリージョンで、リクエストごとに 1 回書き込んで、正確に数えます。速さと手軽さではbindingが上で、厳密さでは DynamoDB 版が上です。どちらが要るかは、何を守りたいかで決まります。

料金の形も違います。Workers KV は、Free プランで 1 日あたり読み取り 10 万回・書き込み 1,000 回、Paid プランで月に読み取り 1,000 万回・書き込み 100 万回を含み、その先は読み取り 100 万回あたり USD 0.50、書き込み 100 万回あたり USD 5.00 です。置いてあるだけでかかる料金は、保存量が 1 GB を超えるまでありません。Cloudflare から来た人にとっては、置いてあるだけで料金がかかる ElastiCache が、いちばん違和感のあるところだと思います。Durable Objects の料金は、この章では確かめていません。

## どれを選ぶか

<!-- section: 14.choose -->

ここまでの内容を、1 つの表にまとめます。

| | DynamoDB | ElastiCache Serverless（Valkey） | CloudFront KeyValueStore | Lambda のメモリ |
| --- | --- | --- | --- | --- |
| 向いている目的 | 持ち主になるデータ。正確な数。消えては困る期限つきの記録 | 高頻度の読み書き。消えてもよい数と写し。ランキングなどの専用の操作 | エッジで読む小さな設定 | 自分の実行環境だけの写し |
| 一貫性 | 強い整合性の読み取りを選べる。条件付き更新が 1 ステップ | 1 コマンド、1 スクリプトが 1 ステップ。AZ への複製は非同期 | 更新は遅れて届く。数字は未確認 | 共有されない |
| データの寿命 | 消すまで。TTL の削除は数日遅れうる | 期限まで（誤差 0〜1 ミリ秒）。追い出しと障害で消えうる | 書き換えるまで | 実行環境が捨てられるまで |
| 置き場所 | 1 リージョン。VPC 不要 | 1 リージョン。VPC の中かパブリックエンドポイント | すべてのエッジロケーション | 実行環境の中 |
| 使っていないときの料金 | 保存量ぶんだけ（この章の構成で USD 0.00） | 月 USD 7.37 から | この章では 0（10章） | 0 |
| Lambda から書けるか | はい | はい | いいえ | その実行環境だけ |

この表から、おおよその判断は次のようになります。

迷ったら DynamoDB を選びます。置いてあるだけの料金がほとんど無く、VPC も要らず、Lambda と同じ権限の仕組みで守れます。レート制限もキャッシュも、この章で見たとおりに作れます。弱点は、1 回の操作に数ミリ秒から十数ミリ秒かかることと、書き込みのたびに料金がかかることです。なお、手元の DynamoDB Local では 1 回の操作が 10 ミリ秒前後でしたが、これは実物の数字ではありません。

Valkey を選ぶのは、理由を言えるときです。1 リクエストで何度も読み書きする。1 ミリ秒を争う。sorted set や pub/sub のような、DynamoDB に無い操作が要る。書き込みが多すぎて、DynamoDB の従量課金が月 USD 7.37 を大きく超える。このどれかが当てはまるなら、Valkey を使う理由になります。どれも当てはまらないなら、常時かかる料金と、消えうるデータと、運用する対象を 1 つ、理由なく抱えることになります。

CloudFront KeyValueStore は、エッジの関数が読む設定にだけ使います。

Lambda のメモリは、追加の料金なしで使える 1 段目のキャッシュで、正しさは預けません。

## 料金

<!-- section: 14.cost -->

金額は USD、東京リージョン、従量課金、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

**置いてあるだけの月。**

| 構成 | 月額（730 時間） |
| --- | --- |
| 既定のスタック（DynamoDB） | 0.00 |
| `-c store=valkey`（ElastiCache Serverless、Valkey） | 7.37 |
| 比較: ノードベースの Valkey、`cache.t4g.micro` 1 台 | 14.60 |

Serverless の 7.37 は、最小課金のぶんです。Valkey の Serverless は、保存量が 100 MB 未満でも 100 MB として課金されます。単価は 1 GB 時間あたり USD 0.101 なので、0.1 GB × 730 時間 × 0.101 で 7.37 になります。Redis OSS と Memcached の最小は 1 GB で、単価も USD 0.151 と高くなります。この章が Valkey を選んでいる理由の 1 つです。

ノードベースの 14.60 は、この章のスタックが作る構成ではなく、比べるために計算したものです。レプリカなしの 1 台なので、その 1 台が落ちたらキャッシュは空になります。

無料枠について補足します。ElastiCache の料金ページによると、2025 年 7 月 15 日より前に作ったアカウントには `cache.t3.micro` の 750 時間が 12 か月付きますが、Serverless は対象外です。それ以降のアカウントは credits の形になります。この表では、どちらも引いていません。

**月 100 万リクエスト呼ばれた月。** Lambda は arm64、256 MB、平均 30 ミリ秒、ログは 1 リクエスト 0.5 KB という仮定です。

| 対象 | DynamoDB 版の定価 | Valkey 版の定価 |
| --- | --- | --- |
| API Gateway HTTP API のリクエスト（100 万件） | 1.29 | 1.29 |
| Lambda のリクエストと実行時間 | 0.30 | 0.30 |
| CloudWatch Logs | 0.36 | 0.36 |
| DynamoDB の書き込み（1,262,800 単位） | 0.90 | - |
| DynamoDB の読み取り（543,800 単位） | 0.08 | - |
| ElastiCache の保存量（最小の 73 GB 時間） | - | 7.37 |
| ElastiCache の ECPU（1,000 万、仮定） | - | 0.03 |
| 小計（定価） | **2.94** | **9.36** |
| 小計（毎月の無料枠の適用後） | **2.27** | **8.69** |

無料枠は、Lambda と CloudWatch Logs のものだけを引いています（どちらもアカウント全体で共有されます）。HTTP API の無料枠は確認できていないので、引いていません。

DynamoDB の書き込みの内訳は、レート制限の加算が 100 万回と、キャッシュの詰め直しが 87,600 回 × 3 回（ロックを取る、写しを書く、ロックを外す）です。詰め直しの回数は、「TTL の 30 秒が切れるたびに必ず 1 回起きる」という、多めの仮定で出しました。滑る窓にすると、リクエストごとに強い整合性の読み取りが 1 回増えるので、読み取りが 100 万単位（USD 0.14）増えます。

Valkey 版の ECPU は、1 リクエストあたり 10 ECPU と多めに置きました。単純な読み書きは 1 KB あたり 1 ECPU ですが、スクリプトがいくつ消費するかは計っていません。多めに置いても USD 0.03 なので、この規模では保存量の最小課金がほぼすべてです。

2 つの小計を比べると、月 100 万リクエストでは DynamoDB 版のほうがずっと安くなります。DynamoDB の書き込みが月 USD 7.37 に届くのは、およそ 1,000 万回の書き込みからです。キャッシュには Valkey、と決めてしまう前に、一度この計算をしておく価値があります。

表に入れていないものもあります。0 という意味ではなく、算入していないという意味です。1 つは、応答をインターネットへ送るデータ転送です。もう 1 つはパブリックエンドポイントへのデータ転送で、料金ページによると、同じリージョンの中ではアプリの側に 1 GB あたり USD 0.01 がかかります。

**叩かれたら。** この API には認証がなく、URL を知っていれば誰でも呼べます。大量のリクエストを止めるものは 3 つあります。ステージのスロットリング（全体で 1 秒に 10 件）、アプリのレート制限（アドレスごとに 1 分 5 回）、テーブルの上限です。

スロットリングの上限いっぱいの 1 秒 10 件が、30 日続いたとします。リクエストは 2,592 万件です。上の表と同じ仮定（平均 30 ミリ秒、ログ 0.5 KB）で、DynamoDB 版の定価は次のようになります。

| 対象 | 定価 |
| --- | --- |
| API Gateway HTTP API のリクエスト（2,592 万件） | 33.44 |
| Lambda のリクエストと実行時間 | 7.78 |
| CloudWatch Logs | 9.39 |
| DynamoDB の書き込み（26,182,800 単位） | 18.72 |
| DynamoDB の読み取り（13,003,800 単位） | 1.85 |
| 合計（定価） | **71.18** |

月に USD 71 ほどです。スロットリングが効いているかぎり、この金額がこのスタックの上限の目安になります。アプリが 429 で断ったリクエストにも、API Gateway と、Lambda と、条件に失敗した書き込みの料金がかかります。そのため、ほとんどのリクエストが 429 でも、この金額はあまり下がりません。スロットリングの 429 に API Gateway の料金がかかるかどうかは、確かめていません。応答のデータ転送も入れていません。

アドレスを変えながら呼び続ける相手には、アプリのレート制限は効きません。アドレスごとに新しい枠があるからです。そのとき増えるのはカウンターの項目で、多くて 1 秒に 10 個です。小さな項目で、TTL が数日以内に消しますが、どこまで溜まるかは計っていません。

スロットリングが効いていなかった場合（デプロイして確かめるまで、わかりません）、残るのはテーブルの上限で、1 秒に書き込み 40 単位、読み取り 60 単位です。30 日ずっと上限に張り付いても、DynamoDB のぶんは書き込み USD 74.13、読み取り USD 22.16 で止まります。API Gateway と Lambda のぶんは止まりません。デプロイしたら、コンソールでステージのスロットリングの値を一度確かめてください。

Valkey 版では、数える先が ElastiCache に替わり、上限は `cacheUsageLimits` になります。1 秒に 1,000 ECPU に 30 日張り付くと USD 7.00、保存量が上限の 1 GB のままだと 730 時間で USD 73.73 です。

本物の利用者を迎える前に足すものは、認証（06章）と、必要なら AWS WAF です。ただし WAF は HTTP API には付けられないので、手前に CloudFront を置く構成になります。[21章](/ja/chapters/21-security.md)の web ACL（ルール 3 つ）は月 USD 8.00 で、ほかにリクエスト 100 万件あたり USD 0.60 がかかります。HTTP API を CloudFront の後ろに置く構成は、この本では作っていません。

スタックを消せば、この章のぶんの料金は止まります。

## つまずきやすいところ

| こうなったら | ここを見る |
| --- | --- |
| `dev:kv` が `Invalid environment` で止まる | `examples/14-kv-cache/.env` があるかを確かめてください。必要な変数は `KV_STORE` ごとに違います |
| 手元では 6 回目で 429 なのに、デプロイ後はもっと通る | `KV_STORE=memory` のままデプロイしていないかを確かめてください。メモリでは実行環境ごとに数えます |
| 429 なのに `ratelimit-limit` ヘッダーが付いていない | 断ったのはアプリではなく、API Gateway のスロットリングです。API 全体で 1 秒に 10 件を超えました |
| 自分はまだ 5 回呼んでいないのに 429 | 同じ出口の IP アドレスを使う誰かが、先に呼んでいます。数えているのは人ではなくアドレスです |
| 期限を過ぎた項目が、DynamoDB のコンソールに残っている | 正常です。TTL の削除は数日遅れることがあり、期限は読む側が確かめています |
| `x-cache` がずっと `miss` | キャッシュに書けていません。`vp run kv:logs` で `cache store failed` を探してください |
| ログに `WRONGPASS` | 公式の Troubleshooting によると、トークンの期限切れ、ユーザー名の違い、`elasticache:Connect` の不足、キャッシュ名が小文字でない、のどれかです |
| ログに `NOAUTH` | クライアントが認証の前にコマンドを送っています。iovalkey は、ソースを読むかぎり最初に `AUTH` を送りますが、実機では未確認です |
| TLS のハンドシェイクに失敗する | パブリックエンドポイントが受け付けるのは TLS 1.3 だけです。クライアントの設定で古い版に固定していないかを確かめてください |
| `Valkey did not answer within 1000 ms` | キャッシュに届いていないか、応答が遅くなっています。API は元データから答え続けます |
| 滑る窓で、思ったより 1 回少なく断られる | 小数の計算を切り捨てています。上限ちょうどを保証する方式ではなく、近似です |

## 本番にするなら

- 利用者を見分けるなら、検証済みの ID で数えます。IP アドレスは、同じ出口の全員をひとまとめにし、アドレスをたくさん持つ相手を別々に数えます（06章）
- スロットリングの値を、自分の API に合わせます。1 秒に 10 件は練習用の値で、上げるならテーブルの上限も一緒に上げます。AWS WAF は HTTP API には付けられないので、必要なら構成から選び直すことになります（[04章](/ja/chapters/04-http-api.md)）。アプリのレート制限は回数を公平に配るためのもので、攻撃を受け止めるためのものではありません
- `RATE_ON_ERROR` を、守るものに合わせます。一覧なら `allow`、ログインの試行のように守りが外れると困るものなら `deny` にします
- テーブルの `removalPolicy` を見直します。この章のテーブルには消えてよいものしか入っていませんが、持ち主のデータと同じテーブルに置くなら `RETAIN` にします
- TTL を、言葉で説明できる長さにします。この章の設定なら、「一覧は最大 36 秒古い」（30 秒と、揺らぎの 20%）と説明できます
- キャッシュのヒット率を見ます。`x-cache` はログに出してあります。ログから数えてアラームにする方法は [19章](/ja/chapters/19-observability.md)にあります
- Valkey を使うなら、パブリックエンドポイントでよいかを決めます。IAM で守られてはいますが、組織によっては、インターネットから届くデータストアを認めていません。その場合は接続の種類を VPC にして、関数ごと 11章の VPC に入れます。`elasticache:ConnectionType` という条件キーで、パブリックなキャッシュを作れなくすることもできます
- Valkey のユーザーを、用途ごとに分けます。この章は、何でもできる `default.iam-user` を使っています。本番では、使えるコマンドとキーを絞ったユーザーを作ります
- 反映の経路を、AWS CDK CLI と CloudFormation にします。理由は 02章に書いたとおりです

## 片付け

<!-- section: 14.cleanup -->

```bash
vp run kv:infra:destroy
```

Valkey 版をデプロイしたなら、同じコンテキストを付けます。

```bash
vp run kv:infra:destroy -c store=valkey
```

テーブル、関数、ロール、API、ロググループ、そして ElastiCache のキャッシュが消えます。最終スナップショットの名前を指定していないので、スナップショットは残らない設定です。消えたかどうかは、ElastiCache のコンソールでキャッシュの一覧が空になっていることで確かめてください。キャッシュが残っていると、料金がかかり続けます。

手元のコンテナも止めておきます。

```bash
vp run kv:local:stop
```

残るのは、cdkd の bootstrap で作った保存場所（02章）と、そこに置かれたデプロイ用のファイルだけです。

## 分散システムとして見ると

この章には、状態の持ち主が 2 つあります。レート制限の数の持ち主は共有のストア（DynamoDB か Valkey）で、一覧の持ち主は元データです。キャッシュは、何の持ち主でもありません。

守りたいことを、1 文ずつにしておきます。

- 1 つの区間で通るリクエストは、同時に何件来ても上限までである。壊そうとするテストは、「読んでから書く」ストアで 2 件を同時に通すものと、50 件を同時に本物のストアへ送るもの
- 誰の回数として数えるかを、呼ぶ側は選べない。壊そうとするテストは、同じアドレスから、名乗る名前と `x-forwarded-for` を毎回変えて呼ぶものと、読めないアドレスを渡すもの
- 期限を過ぎた写しは、ストアに残っていても返さない。壊そうとするテストは、期限切れの項目を返す DynamoDB
- キャッシュが無くても、遅くても、壊れていても、応答は元データと同じである。壊そうとするテストは、読み書きが必ず失敗するストア、読めない値が入ったストア、戻ってこないロックの持ち主
- 写しの古さは、TTL を超えない。壊そうとするテストは、更新と削除をまたぐ遅い読み取り

最後の 1 つは、「古い値を返さない」という意味ではありません。古い値は返しますが、その古さに上限があります。

2 つ目にも、但し書きがあります。呼ぶ側が選べないのは「どのアドレスから来たことにするか」で、アドレスをいくつも持つ相手は、そのぶんだけ枠を持ちます。全員の合計を抑えているのは、アプリではなくステージのスロットリングです。

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト（レートリミッターの境界と同時実行、ストアのコントラクト、DynamoDB と Valkey へ送るリクエストの形、TTL の読み取り側の判定、stale read、スタンピード、揺らぎ、トークンの署名、アプリ、スタックのアサーション）。型検査。synth（既定と `-c store=valkey`、esbuild のバンドル込み）。バンドルしたハンドラーを Node.js で読み込み、API Gateway の形のイベントで呼び出し。ストアのコントラクト 22 件を、Valkey 9.1.2 と DynamoDB Local 3.3.1 に対して実行。`dev:kv` を memory、valkey、dynamodb の 3 通りで起動して、本文の `curl` を実行。数える相手を送信元のアドレスに変えたあとは、memory で起動し直して、ヘッダーを変えても同じ枠で数えられることを確かめました（valkey と dynamodb では流し直していません）。

**まだ確かめていないこと。** `kv:infra:deploy`、`kv:smoke`、`kv:logs`、`kv:infra:drift`、`kv:infra:destroy` は、実際の AWS では動かしていません。ステージのスロットリングとテーブルの上限は、テンプレートに入っていることをテストで固定し、cdkd 0.296.28 のソースがそれを AWS の API に渡していることを読んだだけです。実際に反映されること、スロットリングが返す 429 の形とその課金、テーブルの上限に当たったときの振る舞い、API Gateway のイベントに入る `sourceIp` の実際の値は、確かめていません。`kv:local:start` と `kv:local:stop` は、Docker のデーモンが無く実行していません（Valkey と DynamoDB Local は、nixpkgs の `valkey-server` と AWS が配布する jar を、プロセスとして起動しました）。ElastiCache については、何も実機で確かめていません。内訳は、CloudFormation と Cloud Control API が `ConnectionType: public` と `UserGroupId: default.iam-user-group` を受け付けること、`CacheUsageLimits` の ECPU の上限 1,000 が有効な値であること（上限の最小値はドキュメントに見つからず、1,000 は公式の例が下限に使っている値です）、自作の SigV4 トークンが通ること、iovalkey の `Cluster` がパブリックエンドポイントでクラスターの構成を読めること、TLS 1.3 での接続、スクリプトの ECPU 消費、キャッシュの作成と削除にかかる時間です。DynamoDB については、TTL で項目が消えるまでの実際の時間と、実物での応答時間を確かめていません。`@valkey/valkey-glide` は npm の情報を読んだだけで、インストールも実行もしていません。Durable Objects の料金は確かめていません。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 2 つの題材と、差し替えられるストア | `examples/14-kv-cache/src/stores.ts`、`test/store-contracts.ts` | `test:unit` |
| レート制限の数え方 | `examples/14-kv-cache/src/rate-limit.ts`、`test/rate-limit.test.ts` | `test:unit` |
| 読んでから書くと数え間違える | `examples/14-kv-cache/src/dynamodb-store.ts`、`test/dynamodb-store.test.ts`、`test/rate-limit.test.ts` | `test:unit`、`kv:test:local` |
| TTL による削除は遅れる | `examples/14-kv-cache/src/dynamodb-store.ts`、`test/dynamodb-store.test.ts` | `test:unit` |
| Valkey での実装 | `examples/14-kv-cache/src/valkey-store.ts`、`test/valkey-store.test.ts`、`test/local-stores.test.ts` | `test:unit`、`kv:test:local` |
| ElastiCache で増える決めごと | `examples/14-kv-cache/src/elasticache-token.ts`、`src/valkey-client.ts`、`test/elasticache-token.test.ts` | `test:unit` |
| キャッシュに置けるのは、消えても困らないもの | `examples/14-kv-cache/src/read-through.ts`、`src/catalog.ts`、`src/contract.ts`、`test/read-through.test.ts` | `test:unit` |
| 期限切れの瞬間に集中する読み込み | `examples/14-kv-cache/src/read-through.ts`、`test/read-through.test.ts` | `test:unit` |
| Lambda のメモリをキャッシュに使う | `examples/14-kv-cache/src/memory-store.ts`、`src/lambda.ts`、`test/memory-store.test.ts` | `test:unit` |
| エッジの設定と CloudFront KeyValueStore | `examples/10-edge/` | - |
| 手元で動かす | `examples/14-kv-cache/src/app.ts`、`src/caller.ts`、`test/caller.test.ts`、`src/compose.ts`、`src/env.ts`、`src/dev.ts`、`scripts/local-stores.ts`、`scripts/test-local.ts`、`.env.example` | `dev:kv`、`kv:local:start`、`kv:local:migrate`、`kv:test:local`、`kv:local:stop` |
| AWS にのせる準備 | `examples/14-kv-cache/infra/lib/kv-cache-stack.ts`、`infra/bin/app.ts`、`infra/test/kv-cache-stack.test.ts`、`cdk.json` | `kv:infra:synth`、`test:unit` |
| デプロイして確かめる | `examples/14-kv-cache/scripts/smoke.ts`、`scripts/logs.ts` | `kv:infra:diff`、`kv:infra:deploy`、`kv:smoke`、`kv:logs`、`kv:infra:drift` |
| 料金 | `data/pricing/` | `test:unit` |
| 片付け | `tools/src/infra/` | `kv:infra:destroy`、`kv:local:stop` |

**一次情報**（確認日は、とくに書いていなければ 2026-10-12）

- DynamoDB: [Using time to live (TTL)](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html)、[Working with expired items and TTL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ttl-expired-items.html)、[Working with items and attributes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/WorkingWithItems.html)、[Update expressions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.UpdateExpressions.html)、[Deploying DynamoDB locally](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.DownloadingAndRunning.html)
- ElastiCache: [What is Amazon ElastiCache?](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/WhatIs.html)、[Choosing between deployment options](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/WhatIs.deployment.html)、[Amazon VPCs and ElastiCache security](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/VPCs.html)、[Create a Valkey serverless cache with a public endpoint](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/serverless-public-endpoints-chapter.html)、[Connect to a cache with a public endpoint](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/connecting-public-endpoint.html)、[Authenticating with IAM](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/auth-iam.html)、[Role-Based Access Control](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/Clusters.RBAC.html)、[In-transit encryption](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/in-transit-encryption.html)、[Supported and restricted commands](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/SupportedCommands.html)、[Scaling ElastiCache Serverless](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/Scaling-serverless.html)、[Engine versions](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/engine-versions.html)、[Amazon ElastiCache pricing](https://aws.amazon.com/elasticache/pricing/)、[AWS::ElastiCache::ServerlessCache](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticache-serverlesscache.html)
- AWS Price List bulk API: [ElastiCache](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonElastiCache/current/ap-northeast-1/index.json)、[DynamoDB](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonDynamoDB/current/ap-northeast-1/index.json)（DynamoDB、Lambda、API Gateway、CloudWatch の単価は 2026-10-11 に記録されたもの。DynamoDB の読み書きの単価は 2026-10-12 に同じ値であることを確かめた）
- Lambda: [Understanding the Lambda execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html)、[Understanding Lambda function scaling](https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html)
- Valkey: [README](https://github.com/valkey-io/valkey/blob/unstable/README.md)、[Scripting with Lua](https://valkey.io/topics/eval-intro/)、[SET](https://valkey.io/commands/set/)、[EXPIRE](https://valkey.io/commands/expire/)、[INCR](https://valkey.io/commands/incr/)、[valkey/valkey のイメージのタグ](https://hub.docker.com/r/valkey/valkey/tags)
- client: [iovalkey 0.4.0](https://www.npmjs.com/package/iovalkey/v/0.4.0)、[@valkey/valkey-glide 2.5.3](https://www.npmjs.com/package/@valkey/valkey-glide/v/2.5.3)
- CloudFront KeyValueStore: 10章の出典（確認日 2026-10-11。この章では読み直していません）
- Cloudflare: [How KV works](https://developers.cloudflare.com/kv/concepts/how-kv-works/)、[KV limits](https://developers.cloudflare.com/kv/platform/limits/)、[KV pricing](https://developers.cloudflare.com/kv/platform/pricing/)、[What are Durable Objects?](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/)、[Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- cdkd: [v0.296.28 の `register-providers.ts`](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts) と、同じ版の npm の tarball

:::
