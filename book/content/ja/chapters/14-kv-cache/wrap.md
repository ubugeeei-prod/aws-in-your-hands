---
title: "14 Cache: 費用、注意点、片付け"
---

# 14 Cache: 費用、注意点、片付け

## Workers KV や Durable Objects から来た人へ

<!-- section: 14.cloudflare -->

Cloudflare の側も、KV は 1 種類ではありません。確かめた範囲で並べます。

**Workers KV** は、ドキュメントの言葉で「結果整合の、edge の key-value store」です。書いた場所ではたいていすぐ見え、ほかの拠点では 60 秒以上かかることがある。読み取りが多くて cache しやすいデータ向けで、「atomic な操作が要るなら向かない。Durable Objects を検討して」とも書かれています。

これを AWS の 3 つのどれかに対応づけたくなりますが、やめておきます。重なり方が、それぞれ違うからです。

- DynamoDB は、Worker にあたるコードから読み書きできる点は同じ。ただし 1 つのリージョンにあり、強い整合性の読み取りと条件付きの更新ができる。性質は KV よりずっと「データベース」です
- CloudFront KeyValueStore は、edge で読める点と、遅れて届く点が似ています。でも関数からは書けず、桁違いに小さい（値は 1 KB、KV は 25 MiB）
- Valkey は、どちらにも似ていません。メモリの上の、1 つのリージョンのサーバーです

rate limit のような「正確に数える」仕事は、Cloudflare でも Workers KV の仕事ではありません。**Durable Objects** は、名前で一意に決まる、single-thread の小さな実体で、それぞれが強い整合性の保存領域を持ちます。「同時に来ても 1 つずつ処理される」ことで、この章が DynamoDB の条件式や Valkey の script で得た保証を、別の形で得ています。AWS には、これに直接あたる部品はありません。

Workers には、rate limit 専用の binding もあります。ドキュメントによると、数えるのは Cloudflare の拠点ごとで、「寛容で、結果整合で、正確な計数のためのものではない」。この章の DynamoDB 版は、その逆を選んでいます。1 つのリージョンで、リクエストごとに 1 回書き込んで、正確に数える。速さと手軽さでは binding が上で、厳密さではこちらが上です。どちらが要るかは、何を守りたいかで決まります。

料金の形も違います。Workers KV は、Free プランで 1 日あたり読み取り 10 万回・書き込み 1,000 回、Paid プランで月に読み取り 1,000 万回・書き込み 100 万回を含み、その先は読み取り 100 万回あたり USD 0.50、書き込み 100 万回あたり USD 5.00 です。置いてあるだけの料金は、保存量が 1 GB を超えるまでありません。「置いてあるだけで料金がかかる KV」は、Cloudflare から来ると、いちばん違和感のあるところだと思います。Durable Objects の料金は、この章では確かめていません。

## どれを選ぶか

<!-- section: 14.choose -->

ここまでを、1 枚にまとめます。

| | DynamoDB | ElastiCache Serverless（Valkey） | CloudFront KeyValueStore | Lambda のメモリ |
| --- | --- | --- | --- | --- |
| 向いている目的 | 持ち主になるデータ。正確な数。消えては困る期限つきの記録 | 高頻度の読み書き。消えてもよい数と写し。ランキングなどの専用の操作 | edge で読む小さな設定 | 自分の実行環境だけの写し |
| 一貫性 | 強い整合性の読み取りを選べる。条件付き更新が 1 ステップ | 1 コマンド、1 script が 1 ステップ。AZ への複製は非同期 | 更新は遅れて届く。数字は未確認 | 共有されない |
| データの寿命 | 消すまで。TTL の削除は数日遅れうる | 期限まで（誤差 0〜1 ミリ秒）。追い出しと障害で消えうる | 書き換えるまで | 実行環境が捨てられるまで |
| 置き場所 | 1 リージョン。VPC 不要 | 1 リージョン。VPC の中か public endpoint | 全 edge location | 実行環境の中 |
| 使っていないときの料金 | 保存量ぶんだけ（この章の構成で USD 0.00） | 月 USD 7.37 から | この章では 0（10章） | 0 |
| Lambda から書けるか | はい | はい | いいえ | その実行環境だけ |

この表から、だいたいの判断はこうなります。

**迷ったら DynamoDB。** 置いてあるだけの料金がほぼ無く、VPC も要らず、Lambda と同じ権限の仕組みで守れます。rate limit も cache も、この章で見たとおり作れます。弱点は 2 つ。1 回の操作が数ミリ秒から十数ミリ秒かかること（手元の DynamoDB Local では 10 ミリ秒前後でしたが、これは実物の数字ではありません）と、書き込みのたびに料金がかかることです。

**Valkey にするのは、理由が言えるとき。** 1 リクエストで何度も読み書きする。1 ミリ秒を争う。sorted set や pub/sub のような、DynamoDB に無い操作が要る。あるいは、書き込みが多すぎて DynamoDB の従量課金が月 USD 7.37 を大きく超える。どれかが当てはまるなら、Valkey の出番です。当てはまらないなら、常時かかる料金と、消えうるデータと、もう 1 つの運用対象を、理由なく抱えることになります。

**KeyValueStore は、edge の関数が読む設定にだけ。**

**メモリは、ただで付いてくる 1 段目の cache。** 正しさを預けない。

## お金の話

<!-- section: 14.cost -->

金額は USD、東京リージョン、従量課金、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

**置いてあるだけの月。**

| 構成 | 月額（730 時間） |
| --- | --- |
| 既定の stack（DynamoDB） | 0.00 |
| `-c store=valkey`（ElastiCache Serverless、Valkey） | 7.37 |
| 比較: node ベースの Valkey、`cache.t4g.micro` 1 台 | 14.60 |

Serverless の 7.37 は、最小課金のぶんです。Valkey の Serverless は、保存量が 100 MB 未満でも 100 MB として課金されます。単価は 1 GB 時間あたり USD 0.101 なので、0.1 GB × 730 時間 × 0.101 で 7.37。ちなみに Redis OSS と Memcached の最小は 1 GB で、単価も USD 0.151 と高くなります。Valkey を選んでいるのは、そのためでもあります。

node ベースの 14.60 は、この章の stack が作る構成ではありません。比べるために計算しました。replica なしの 1 台なので、その 1 台が落ちたら cache は空になります。

無料枠について。ElastiCache の料金ページによると、2025 年 7 月 15 日より前に作ったアカウントには `cache.t3.micro` の 750 時間が 12 か月付きますが、Serverless は対象外です。それ以降のアカウントは credits の形になります。この表では、どちらも引いていません。

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

無料枠は、Lambda と CloudWatch Logs のものだけを引いています（アカウント全体で共有）。HTTP API の無料枠は確認できていないので、引いていません。

DynamoDB の書き込みの内訳は、rate limit の加算が 100 万回と、cache の詰め直しが 87,600 回 × 3 回（lock を取る、写しを書く、lock を外す）。詰め直しの回数は、「TTL の 30 秒が切れるたびに必ず 1 回起きる」という、多めの仮定です。滑る窓にすると、リクエストごとに強い整合性の読み取りが 1 回増えて、読み取りが 100 万単位（USD 0.14）増えます。

Valkey 版の ECPU は、1 リクエストあたり 10 ECPU と多めに置きました。単純な読み書きは 1 KB あたり 1 ECPU ですが、script がいくつ消費するかは計っていません。それでも USD 0.03 なので、この規模では保存量の最小課金がほぼすべてです。

2 つの小計を見比べてください。月 100 万リクエストでは、DynamoDB 版のほうがずっと安い。DynamoDB の書き込みが月 USD 7.37 に届くのは、およそ 1,000 万回の書き込みからです。「cache といえば Valkey」と決めてかかる前に、一度この計算をしてみる価値があります。

表に入れていないものもあります（0 という意味ではなく、未算入です）。応答をインターネットへ送るデータ転送。それと、public endpoint へのデータ転送で、料金ページによると、同じリージョンの中ではアプリの側に 1 GB あたり USD 0.01 がかかります。

**叩かれ続けた月。** この API に認証はありません。URL を知っていれば、誰でも呼べます。止めるものは 3 つです。stage の throttling（全体で 1 秒に 10 件）、アプリの rate limit（アドレスごとに 1 分 5 回）、table の上限。

throttling いっぱいの 1 秒 10 件が、30 日続いたとします。2,592 万件です。上の表と同じ仮定（平均 30 ミリ秒、ログ 0.5 KB）で、DynamoDB 版の定価はこうなります。

| 対象 | 定価 |
| --- | --- |
| API Gateway HTTP API のリクエスト（2,592 万件） | 33.44 |
| Lambda のリクエストと実行時間 | 7.78 |
| CloudWatch Logs | 9.39 |
| DynamoDB の書き込み（26,182,800 単位） | 18.72 |
| DynamoDB の読み取り（13,003,800 単位） | 1.85 |
| 合計（定価） | **71.18** |

月に USD 71 ほど。throttling が効いているかぎり、これがこの stack の天井の目安です。アプリが 429 で断ったリクエストも、API Gateway と Lambda と、条件に失敗した書き込みの料金を払います。だから、ほとんどが 429 でも、この数字はあまり下がりません。throttling の 429 に API Gateway の料金がかかるかどうかは、確かめていません。応答のデータ転送も入れていません。

アドレスを変えながら叩く相手には、アプリの rate limit は効きません。アドレスごとに新しい枠があるからです。そのとき増えるのは counter の item で、多くて 1 秒に 10 個。小さな item で、TTL が数日以内に消しますが、どこまで溜まるかは計っていません。

throttling が効いていなかったら（デプロイして確かめるまで、わかりません）、残るのは table の上限です。1 秒に書き込み 40 単位、読み取り 60 単位。30 日ずっと張り付いても、DynamoDB のぶんは書き込み USD 74.13、読み取り USD 22.16 で止まります。API Gateway と Lambda のぶんは止まりません。デプロイしたら、コンソールで stage の throttling の値を一度見てください。

Valkey 版は、数える先が ElastiCache に替わります。そちらの天井は `cacheUsageLimits` です。1 秒に 1,000 ECPU に 30 日張り付くと USD 7.00、保存量が上限の 1 GB のままだと 730 時間で USD 73.73。

本物の利用者を迎える前に足すものは、認証（06章）と、要るなら AWS WAF です。ただし WAF は HTTP API には付けられないので、手前に CloudFront を置く構成になります。[21章](/ja/chapters/21-security.md)の web ACL（rule 3 つ）は月 USD 8.00 で、ほかにリクエスト 100 万件あたり USD 0.60。HTTP API を CloudFront の裏に置く構成は、この本では作っていません。

stack を消せば、この章のぶんの料金は止まります。

## ハマりどころ

| こうなったら | ここを見る |
| --- | --- |
| `dev:kv` が `Invalid environment` で止まる | `examples/14-kv-cache/.env` はありますか。`KV_STORE` ごとに必要な変数が違います |
| 手元では 6 回目で 429 なのに、デプロイ後はもっと通る | `KV_STORE=memory` のままデプロイしていませんか。実行環境ごとに数えています |
| 429 なのに `ratelimit-limit` ヘッダーが付いていない | アプリではなく、API Gateway の throttling が断っています。API 全体で 1 秒に 10 件を超えました |
| 自分はまだ 5 回呼んでいないのに 429 | 同じ出口の IP アドレスを使う誰かが、先に呼んでいます。数えているのは人ではなくアドレスです |
| 期限を過ぎた item が、DynamoDB のコンソールに残っている | それで正常です。TTL の削除は数日遅れることがあります。読む側が期限を見ています |
| `x-cache` がずっと `miss` | cache に書けていません。`vp run kv:logs` で `cache store failed` を探す |
| ログに `WRONGPASS` | 公式の Troubleshooting によると、token の期限切れ、利用者名の違い、`elasticache:Connect` の不足、cache 名が小文字でない、のどれか |
| ログに `NOAUTH` | client が認証の前にコマンドを送っています。iovalkey は、ソースを読むかぎり最初に `AUTH` を送りますが、実機では未確認です |
| TLS の握手に失敗する | public endpoint は TLS 1.3 だけ。client の設定で古い版に固定していませんか |
| `Valkey did not answer within 1000 ms` | cache に届いていないか、応答が遅い。API は元データから答え続けます |
| 滑る窓で、思ったより 1 回少なく断られる | 小数の計算を切り捨てています。上限ちょうどを保証する方式ではなく、近似です |

## 本番にするなら

- **利用者を見分けるなら、検証済みの ID で数える。** IP アドレスは、同じ出口の全員をひとまとめにし、アドレスをたくさん持つ相手を別々に数えます（06章）
- **throttling の数字を、自分の API に合わせる。** 1 秒に 10 件は、練習用の値です。上げるなら、table の上限も一緒に上げます。AWS WAF は HTTP API には付けられないので、要るなら構成から選び直しです（[04章](/ja/chapters/04-http-api.md)）。アプリの rate limit は、公平に配るためのもので、攻撃を受け止めるためのものではありません
- **`RATE_ON_ERROR` を、守るものに合わせる。** 一覧なら `allow`、ログインの試行のように守りが外れると困るものなら `deny`
- **table の `removalPolicy` を見直す。** この章の table は消えていいものしか入っていませんが、持ち主のデータと同じ table に置くなら `RETAIN` です
- **TTL を、言葉で説明できる長さにする。** 「一覧は最大 36 秒古い」と言えますか（30 秒 + 揺らぎ 20%）
- **cache の hit 率を見る。** `x-cache` をログに出してあります。ログから数えてアラームにする方法は [19章](/ja/chapters/19-observability.md)
- **Valkey を使うなら、public endpoint でよいかを決める。** IAM で守られてはいますが、組織によっては「インターネットから届くデータストアは不可」です。その場合は接続の種類を VPC にして、11章の VPC に関数ごと入れます。`elasticache:ConnectionType` という条件キーで、public な cache を作れなくすることもできます
- **Valkey の利用者を、用途ごとに分ける。** この章は、何でもできる `default.iam-user` を使っています。本番では、使えるコマンドと key を絞った利用者を作ります
- **反映の経路を AWS CDK CLI と CloudFormation にする。** 02章で話したとおりです

## 片付け

<!-- section: 14.cleanup -->

```bash
vp run kv:infra:destroy
```

Valkey 版をデプロイしたなら、同じ context を付けます。

```bash
vp run kv:infra:destroy -c store=valkey
```

table、関数、role、API、log group、そして ElastiCache の cache が消えます。最終 snapshot の名前を指定していないので、snapshot は残らない設定です。消えたかどうかは、ElastiCache のコンソールで cache の一覧が空になっていることを見てください。ここが残っていると、料金が続きます。

手元のコンテナも止めておきましょう。

```bash
vp run kv:local:stop
```

残るのは、cdkd の bootstrap で作った保存場所（02章）と、そこに置かれたデプロイ用のファイルだけです。

## 分散システムとして見ると

この章の状態の持ち主は、2 人います。rate limit の数の持ち主は、共有の store（DynamoDB か Valkey）。一覧の持ち主は、元データ。cache は誰の持ち主でもありません。

守りたいことを、1 文ずつにしておきます。

- **1 つの区間で通るリクエストは、同時に何件来ても上限まで。** 壊そうとするテスト: 「読んでから書く」store で 2 件を同時に通す。50 件を同時に本物の store へ送る
- **誰の回数として数えるかを、呼ぶ側は選べない。** 壊そうとするテスト: 同じアドレスから、名乗る名前と `x-forwarded-for` を毎回変えて呼ぶ。読めないアドレスを渡す
- **期限を過ぎた写しは、store に残っていても返さない。** 壊そうとするテスト: 期限切れの item を返す DynamoDB
- **cache が無くても、遅くても、壊れていても、応答は元データと同じ。** 壊そうとするテスト: 読み書きが必ず失敗する store、読めない値が入った store、帰ってこない lock の持ち主
- **写しの古さは、TTL を超えない。** 壊そうとするテスト: 更新と削除をまたぐ遅い読み取り

最後の 1 つは、「古い値を返さない」ではないことに注意してください。返します。上限があるだけです。

2 つ目にも、但し書きがあります。選べないのは「どのアドレスから来たことにするか」で、アドレスをいくつも持つ相手は、そのぶんだけ枠を持ちます。全員の合計に蓋をしているのは、アプリではなく stage の throttling です。

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト（rate limiter の境界と同時実行、store の contract、DynamoDB と Valkey へ送るリクエストの形、TTL の読み取り側の判定、stale read、stampede、揺らぎ、token の署名、アプリ、stack の assertion）。型検査。synth（既定と `-c store=valkey`、esbuild の bundle 込み）。bundle した handler を Node.js で読み込み、API Gateway の形のイベントで呼び出し。store の contract 22 件を、Valkey 9.1.2 と DynamoDB Local 3.3.1 に対して実行。`dev:kv` を memory、valkey、dynamodb の 3 通りで起動して、本文の `curl` を実行。数える相手を送信元のアドレスに変えたあとは、memory で起動し直して、ヘッダーを変えても同じ枠で数えられることを確かめました（valkey と dynamodb では流し直していません）。

**まだ確かめていないこと。** `kv:infra:deploy`、`kv:smoke`、`kv:logs`、`kv:infra:drift`、`kv:infra:destroy` は、実際の AWS では動かしていません。stage の throttling と table の上限は、template に入っていることをテストで固定し、cdkd 0.296.28 のソースがそれを AWS の API に渡していることを読んだだけです。実際に反映されること、throttling が返す 429 の形とその課金、table の上限に当たったときの振る舞い、API Gateway のイベントに入る `sourceIp` の実際の値は、確かめていません。`kv:local:start` と `kv:local:stop` は、Docker の daemon が無く実行していません（Valkey と DynamoDB Local は、nixpkgs の `valkey-server` と AWS が配布する jar を、プロセスとして起動しました）。ElastiCache については、何も実機で確かめていません。内訳は、CloudFormation と Cloud Control API が `ConnectionType: public` と `UserGroupId: default.iam-user-group` を受け付けること、`CacheUsageLimits` の ECPU の上限 1,000 が有効な値であること（上限の最小値はドキュメントに見つからず、1,000 は公式の例が下限に使っている値です）、自作の SigV4 token が通ること、iovalkey の `Cluster` が public endpoint で cluster の構成を読めること、TLS 1.3 での接続、script の ECPU 消費、cache の作成と削除にかかる時間。DynamoDB については、TTL で item が消えるまでの実際の時間と、実物での応答時間。`@valkey/valkey-glide` は npm の情報を読んだだけで、インストールも実行もしていません。Durable Objects の料金は確かめていません。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 題材は 2 つ、裏側は差し替え式 | `examples/14-kv-cache/src/stores.ts`、`test/store-contracts.ts` | `test:unit` |
| rate limit を数える | `examples/14-kv-cache/src/rate-limit.ts`、`test/rate-limit.test.ts` | `test:unit` |
| 「読んでから書く」と、数え間違える | `examples/14-kv-cache/src/dynamodb-store.ts`、`test/dynamodb-store.test.ts`、`test/rate-limit.test.ts` | `test:unit`、`kv:test:local` |
| TTL は「すぐ消す」ではない | `examples/14-kv-cache/src/dynamodb-store.ts`、`test/dynamodb-store.test.ts` | `test:unit` |
| 同じことを Valkey で | `examples/14-kv-cache/src/valkey-store.ts`、`test/valkey-store.test.ts`、`test/local-stores.test.ts` | `test:unit`、`kv:test:local` |
| ElastiCache に置くと何が増えるか | `examples/14-kv-cache/src/elasticache-token.ts`、`src/valkey-client.ts`、`test/elasticache-token.test.ts` | `test:unit` |
| cache は、消えても困らないものだけ | `examples/14-kv-cache/src/read-through.ts`、`src/catalog.ts`、`src/contract.ts`、`test/read-through.test.ts` | `test:unit` |
| 期限切れの瞬間に、全員が殺到する | `examples/14-kv-cache/src/read-through.ts`、`test/read-through.test.ts` | `test:unit` |
| Lambda のメモリも cache になる | `examples/14-kv-cache/src/memory-store.ts`、`src/lambda.ts`、`test/memory-store.test.ts` | `test:unit` |
| edge の設定は、10章の KeyValueStore | `examples/10-edge/` | - |
| 手元で動かす | `examples/14-kv-cache/src/app.ts`、`src/caller.ts`、`test/caller.test.ts`、`src/compose.ts`、`src/env.ts`、`src/dev.ts`、`scripts/local-stores.ts`、`scripts/test-local.ts`、`.env.example` | `dev:kv`、`kv:local:start`、`kv:local:migrate`、`kv:test:local`、`kv:local:stop` |
| AWS にのせる準備 | `examples/14-kv-cache/infra/lib/kv-cache-stack.ts`、`infra/bin/app.ts`、`infra/test/kv-cache-stack.test.ts`、`cdk.json` | `kv:infra:synth`、`test:unit` |
| デプロイして確かめる | `examples/14-kv-cache/scripts/smoke.ts`、`scripts/logs.ts` | `kv:infra:diff`、`kv:infra:deploy`、`kv:smoke`、`kv:logs`、`kv:infra:drift` |
| お金の話 | `data/pricing/` | `test:unit` |
| 片付け | `tools/src/infra/` | `kv:infra:destroy`、`kv:local:stop` |

**一次情報**（確認日は、とくに書いていなければ 2026-10-12）

- DynamoDB: [Using time to live (TTL)](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html)、[Working with expired items and TTL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ttl-expired-items.html)、[Working with items and attributes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/WorkingWithItems.html)、[Update expressions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.UpdateExpressions.html)、[Deploying DynamoDB locally](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.DownloadingAndRunning.html)
- ElastiCache: [What is Amazon ElastiCache?](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/WhatIs.html)、[Choosing between deployment options](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/WhatIs.deployment.html)、[Amazon VPCs and ElastiCache security](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/VPCs.html)、[Create a Valkey serverless cache with a public endpoint](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/serverless-public-endpoints-chapter.html)、[Connect to a cache with a public endpoint](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/connecting-public-endpoint.html)、[Authenticating with IAM](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/auth-iam.html)、[Role-Based Access Control](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/Clusters.RBAC.html)、[In-transit encryption](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/in-transit-encryption.html)、[Supported and restricted commands](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/SupportedCommands.html)、[Scaling ElastiCache Serverless](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/Scaling-serverless.html)、[Engine versions](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/engine-versions.html)、[Amazon ElastiCache pricing](https://aws.amazon.com/elasticache/pricing/)、[AWS::ElastiCache::ServerlessCache](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticache-serverlesscache.html)
- AWS Price List bulk API: [ElastiCache](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonElastiCache/current/ap-northeast-1/index.json)、[DynamoDB](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonDynamoDB/current/ap-northeast-1/index.json)（DynamoDB、Lambda、API Gateway、CloudWatch の単価は 2026-10-11 に記録されたもの。DynamoDB の読み書きの単価は 2026-10-12 に同じ値であることを確かめた）
- Lambda: [Understanding the Lambda execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html)、[Understanding Lambda function scaling](https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html)
- Valkey: [README](https://github.com/valkey-io/valkey/blob/unstable/README.md)、[Scripting with Lua](https://valkey.io/topics/eval-intro/)、[SET](https://valkey.io/commands/set/)、[EXPIRE](https://valkey.io/commands/expire/)、[INCR](https://valkey.io/commands/incr/)、[valkey/valkey の image の tag](https://hub.docker.com/r/valkey/valkey/tags)
- client: [iovalkey 0.4.0](https://www.npmjs.com/package/iovalkey/v/0.4.0)、[@valkey/valkey-glide 2.5.3](https://www.npmjs.com/package/@valkey/valkey-glide/v/2.5.3)
- CloudFront KeyValueStore: 10章の出典（確認日 2026-10-11。この章では読み直していません）
- Cloudflare: [How KV works](https://developers.cloudflare.com/kv/concepts/how-kv-works/)、[KV limits](https://developers.cloudflare.com/kv/platform/limits/)、[KV pricing](https://developers.cloudflare.com/kv/platform/pricing/)、[What are Durable Objects?](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/)、[Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- cdkd: [v0.296.28 の `register-providers.ts`](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts) と、同じ版の npm の tarball

:::
