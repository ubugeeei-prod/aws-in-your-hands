---
title: Cloudflare から来た人へ
revision: 4
---

# Cloudflare から来た人へ

Cloudflare の D1、Workers、Workers AI で開発したことがある人に向けた案内です。乗り換えの手引きではありません。慣れた作業が AWS ではどんな手順になるのかを、同じ小さな機能を作りながら確かめるための道順を示します。

読む前に、2 つ断っておきます。

1 つは、サービス名の対応表が出発点にすぎないことです。D1 に当たるのは Aurora DSQL だと書いても、SQL の方言、ローカルでの動かし方、整合性の保証までが同じになるわけではありません。

もう 1 つは、検証の範囲です。どの経路の章も本文とサンプルは書き上がっていますが、確かめたのは手元までで、AWS にはまだ一度もデプロイしていません。章ごとに何を確かめたかは、各章の末尾の「この章の検証メモ」にあります。

## 3 つの経路

| 慣れているもの | AWS で作るもの | 章 |
| --- | --- | --- |
| Workers で HTTP のハンドラーを書く | Lambda と API Gateway HTTP API | [04](/ja/chapters/04-http-api.md)、[05](/ja/chapters/05-dynamodb.md)、[06](/ja/chapters/06-auth.md) |
| Workers でエッジの処理を書く | CloudFront Functions と KeyValueStore。足りないときの Lambda@Edge | [10](/ja/chapters/10-edge.md) |
| D1 で SQL を書く | Aurora DSQL。復旧の考え方は DynamoDB と S3 で | [13](/ja/chapters/13-sql.md)、[22](/ja/chapters/22-recovery.md) |
| Workers AI でモデルを呼ぶ | Amazon Bedrock と Lambda の function URL | [17](/ja/chapters/17-ai.md) |

どの経路も、[01章](/ja/chapters/01-account.md)と[02章](/ja/chapters/02-toolchain.md)が前提です。

進め方はどの経路でも同じで、手元で試す、テストする、公開の手順を整える、観測する、片付ける、の 5 つの段階を踏みます。

## Workers から来たなら

読む順は 00 → 01 → 02 → 03 → 04 → 10 です。10章は 03章の続きなので、03章を間に入れています。

04章では、小さな HTTP のハンドラー、型付きのクライアント、環境変数の検証、手元での watch、テスト、デプロイ、ログの確認までを一通り扱います。章の終わりには Workers との違いを表にまとめてあるので、ここでは要点を 4 つだけ挙げます。

1 つ目は、手元の実行環境です。Workers では、`wrangler dev` や Vite プラグインが Miniflare を通じて、本番と同じランタイム（workerd）でコードを動かします。04章の `vp run dev:api` は Node.js の HTTP サーバーで、Lambda のランタイムそのものではありません。

2 つ目は、binding が無いことです。Workers では、設定に binding を宣言すると `env` から使え、手元では既定でローカルの模擬につながります。AWS では、SDK で呼び出し、接続先を環境変数で渡し、権限を IAM のロールに書きます。手元用の模擬は、標準では付いてきません。

3 つ目は、権限が 2 つあることです。手元で動かすときは自分の権限で、デプロイ後は関数の実行ロールの権限で動きます。そのため、手元で通った操作が、デプロイ後に拒否されることがあります。

4 つ目は、実行場所です。Lambda は 1 つのリージョンで動きます。読者の近くで動かす処理は、10章で扱います。

10章では、CloudFront Function を 1 つ書きます。リダイレクトの表、トップページを切り替えるフィーチャーフラグ、メンテナンス表示のスイッチの 3 つを CloudFront KeyValueStore に置き、関数から読みます。デプロイし直さずに切り替えられるようにするためです。

10章には、Workers の感覚と違うところがいくつも出てきます。関数は KeyValueStore を読むだけで、書き込めません。書き込みは、外から専用の API で行います。章では、`edge-data.json` との差分だけを送るスクリプトを書き、ETag を使って、読んでいない変更を上書きしないようにしています。また、書いた値がエッジに届くまでには遅れがあります。どれくらい遅れるかは、Developer Guide に数字を見つけられませんでした。

CloudFront Functions では足りない処理のために、Lambda@Edge も 1 つだけ動かします。POST されたボディの大きさと SHA-256 を返す小さな関数です。Lambda@Edge は `us-east-1` に作るしかないので、ディストリビューションとは別の、東京の外にあるスタックになりました。

手元では、デプロイするファイルそのものを Node.js で動かします（`vp run dev:edge`）。cdkd のエミュレーターでも同じレスポンスになることは確かめました（`vp run dev:edge:cdkd`）。ただし、どちらも代用品で、CloudFront Functions の本物のランタイムでは、まだ一度も動かしていません。

章の終わりでは、Workers、CloudFront Functions、Lambda@Edge を表に並べています。結論から言うと、CloudFront Functions は Workers に対応するものではありません。ネットワークにもファイルシステムにも触れられない、URL とヘッダーを書き換えるための環境です。

Workers のランタイムである workerd そのものを AWS で動かす話は、[64章](/ja/chapters/64-isolates.md)にあります。64章は、04章と 10章のほかに 11章、12章、23章、24章、35章を前提にしています。

## D1 から来たなら

読む順は 00 → 01 → 02 → 04 → 13 です。復旧まで追うなら、そのあと 22章へ進みます。22章は 05章から 08章のノートと画像を題材にしているので、先にそちらを読んでおくと理解しやすくなります。

13章では、04章のノートの API のデータを、SQL で Aurora DSQL に保存します。スキーマとマイグレーション、型の付いたクエリ、seed と reset、手元での起動、Lambda からの接続までをつなげます。

先に知っておくとよい違いを挙げます。

- D1 は SQLite です。一方、DynamoDB は SQL のデータベースではありません。SQL で書きたいなら、05章の DynamoDB ではなく 13章へ進んでください
- 実装したのは Aurora DSQL だけです。RDS for PostgreSQL と Aurora Serverless v2 については、違いを表で並べ、選ぶ条件を説明するところまでで、動かしてはいません。この 2 つは VPC の中に置くものなので、選ぶなら 11章の内容が必要です
- 手元の代用は PGlite です。PostgreSQL を Node.js のプロセスの中で動かす npm パッケージで、Docker は要りません。`wrangler dev` がローカルの D1 を用意するのに近い使い勝手ですが、D1 のローカルが本番と同じ D1 であるのに対して、PGlite はあくまで代用です。競合、IAM のトークンによる認証、DSQL の制約（1 つのトランザクションに 3,000 行まで、DDL は 1 文ずつ、インデックスは `CREATE INDEX ASYNC`）は再現しません。版も違います
- 手元では起きない競合を、テストで意図的に起こしています。コミットのときに負けたトランザクションは `40001` を受け取るので、全体をやり直します。このやり直しを自分で書くところが、D1 の `batch()` といちばん違う点です
- マイグレーションは、番号の付いた `.sql` を、この章の小さなランナーが実行します。1 ファイルに 1 文とし、途中で止まっても実行し直せる形にしてあります。ORM と一般的なマイグレーションツールは、この章では動かしていません
- バックアップとリストアは、13章では説明だけです。Aurora DSQL のバックアップは AWS Backup を通すこと、リストアでは必ず新しいクラスターを作ることを書いていますが、リソースは作っておらず、手順も試せていません

実際のクラスターには、まだ一度も接続していません。この章の SQL が DSQL に受け付けられるかどうかも、未確認の項目に含まれます。

22章は復旧の章です。ただし、題材は Aurora DSQL ではなく、DynamoDB の point-in-time recovery（PITR）と S3 のバージョニングです。事故を起こし、テーブルとバケットを別々の時刻に戻し、ずれを検査して修復するところまでを、手元ではメモリの上で通しています。

D1 の Time Travel との違いは、章の中で並べています。Time Travel は、データベースをその場で上書きして戻します。DynamoDB の PITR は、必ず新しいテーブルを作ります。そのため、切り替える作業が残りますが、その代わりに、元のテーブルと並べて差分を数えてから切り替えるかどうかを決められます。

## Workers AI から来たなら

読む順は 00 → 01 → 02 → 04 → 17 です。

17章では、まず数行のコードでモデルを 1 回呼びます。そのあと、ノートの本文を要約し、できた分から少しずつ返す API を作ります。

- どちらのサービスでも、推論は手元では動きません。Cloudflare のドキュメントは、Workers AI にはローカルの模擬がなく、モデルは常に remote で動くと書いています。Bedrock も同じで、手元で API サーバーを動かしていても、モデルの呼び出しは AWS に届き、課金されます
- そのため、テストと既定の開発サーバー（`vp run dev:ai`）は、決まったイベントの列（フィクスチャ）を流して、モデルを呼ばずに動きます。実際のモデルを呼ぶのは `ai:hello` と `ai:test:live` という別のタスクで、ふだんの `check:all` からは呼びません。この 2 つは、まだ実行していません
- ストリーミングの入口は、Lambda の function URL にしました。04章の API Gateway HTTP API は、Lambda のレスポンスを最後まで受け取ってから返すので、少しずつ返すことができないからです。function URL 自体が持っている認証は IAM の署名だけなので、呼ぶ側は署名したリクエストを送ります
- Workers AI は、`stream: true` を渡すと `text/event-stream` を返すので、そのままレスポンスにできます。Bedrock の `ConverseStream` は、イベントの列を SDK の async iterable で返します。server-sent events への組み立ては、自分で書きます
- ストリームは途中で切れることがあります。17章は、`done` を受け取っていない出力を完了した要約として扱わないと決め、レスポンスを 1 バイトずつ切り詰めるテストで確かめています

デプロイした関数から、function URL を通して少しずつ届くかどうかは、まだ確かめていません。手元で確かめたのは、フィクスチャを流したときの中継と、途中で切ったときの扱いまでです。

## ほかの章にある比較

3 つの経路のほかにも、Cloudflare の製品と並べて説明している章があります。まず、24章までの章です。慣れているものから探せるように、表にまとめます。

| 慣れているもの | この本で並べているもの | 章 |
| --- | --- | --- |
| R2 の署名付き URL | S3 の署名付き POST | [07](/ja/chapters/07-uploads.md) |
| Queues、R2 の event notification、Cron Triggers | SQS と DLQ、S3 のイベント通知、EventBridge Scheduler | [08](/ja/chapters/08-async.md) |
| Nuxt を Workers にデプロイする | Nuxt を CloudFront とリージョンの Lambda で動かす | [09](/ja/chapters/09-ssr.md) |
| Cloudflare Containers | ECS on Fargate と ALB | [12](/ja/chapters/12-containers.md) |
| Workers KV、Durable Objects、レート制限の binding | DynamoDB、ElastiCache（Valkey）、CloudFront KeyValueStore | [14](/ja/chapters/14-kv-cache.md) |
| Email Service | SES | [15](/ja/chapters/15-email.md) |
| Workflows | Step Functions、Lambda durable functions | [16](/ja/chapters/16-long-jobs.md) |
| Stream の Live | IVS | [18](/ja/chapters/18-live.md) |
| Workers Logs とトレース | CloudWatch と X-Ray | [19](/ja/chapters/19-observability.md) |
| `wrangler deploy` と version | CloudFormation、Lambda のバージョンとエイリアス、OIDC | [20](/ja/chapters/20-shipping.md) |
| secret の binding、WAF | Secrets Manager、AWS WAF | [21](/ja/chapters/21-security.md) |
| D1 の Time Travel | DynamoDB の PITR、S3 のバージョニング | [22](/ja/chapters/22-recovery.md) |

名前から取り違えやすいものが 3 つあります。

Lambda durable functions と Durable Objects は、名前が似ているだけで別のものです。Cloudflare で Lambda durable functions に近いのは Workflows だと、16章が説明しています。Durable Objects は、14章でレート制限の状態を置く場所として出てきます。AWS には、Durable Objects に直接当たる部品がありません。

Workers KV を、AWS の 3 つの key-value ストアのどれか 1 つに対応づけることはしません。重なり方がそれぞれ違うことを、14章が順に説明しています。

24章の題材である celld は、Workers と Durable Objects のアプリケーションを自分のマシンで動かす OSS です。AWS のサービスではなく、章で比べているのは誰が運用するかという点だけです。

どの章の比較も、Cloudflare の公式ドキュメントを読んだ範囲で書いたもので、使って確かめたものではありません。確かめられなかった点は、それぞれの章にそのまま書いてあります。06章には Cloudflare Access に触れた段落がありますが、一次情報を確認していない、一般的な構成についての記述です。11章と 23章には比較がありません。VPC や仮想マシンに当たるものが Cloudflare にあるかどうかを、調べていないからです。

## 25章から先の比較

25章から先の章は、それぞれ独立していて、ほとんどが Cloudflare と Vercel にある近い製品との違いを 1 節にまとめています。ここでは Cloudflare の側だけを拾い、慣れている製品から章を探せるように並べます。右の列は、その章が挙げている違いのうち、読む前に知っておくと役に立つものです。リンクは、比較が書いてあるページに張りました。

Cloudflare 側の記述は、どの章でも、公式ドキュメントを読んだ範囲のものです。確認日は 2026-10-12 か 2026-10-13 で、章ごとに書いてあります。章が確かめられなかったと書いていることは、ここでもそう書きます。

### キュー、イベント、ワークフロー

| 慣れているもの | 章 | 章が挙げている違い |
| --- | --- | --- |
| Queues で、同じ出来事を複数の相手に渡す | [25](/ja/chapters/25-events/wrap.md) | ドキュメントには、1 つのキューが持てるアクティブなコンシューマーは 1 つだけとあります。3 つの相手に渡すなら、載せる側の Worker が 3 つのキューに送ります。中身で行き先を決めるルール、archive とリプレイに当たるものは、章が読んだページの範囲では見当たりませんでした |
| Queues の event subscriptions | [25](/ja/chapters/25-events/wrap.md) | 名前は近くても別のものです。Cloudflare の製品が起こした出来事をキューで受け取る仕組みで、AWS のサービスが既定のイベントバスに載せるイベントに当たります |
| Queues の配送と順序 | [61](/ja/chapters/61-sqs.md) | Queues は少なくとも 1 回の配送で、発行した順に届く保証はありません。順序を保つ種類のキューは、章が読んだ範囲では見当たりませんでした。遅延は 24 時間まで指定でき、15 分までの SQS より広く取れます |
| Queues、Basin Pipelines の stream | [54](/ja/chapters/54-kinesis.md) | Kinesis の stream にそのまま当たる部品は見当たらない、と章は書いています。Basin Pipelines の stream の役割は 26章の Firehose に近く、アプリケーションのコードが好きな位置から読み直す API は、読んだページには見つかりませんでした |
| Workflows | [47](/ja/chapters/47-step-functions.md) | Workflows は `step.do()` で囲んだコードとして書き、取り消しのハンドラーは、ステップを始めた順の逆に走るとドキュメントにあります。Step Functions が向いているのは、呼ぶ相手が AWS のサービスで、その API を関数なしで直接呼びたいときです |

### データベースとストレージ

| 慣れているもの | 章 | 章が挙げている違い |
| --- | --- | --- |
| D1、Durable Objects の SQLite | [30](/ja/chapters/30-data-modeling.md) | D1 では一意性を `CREATE UNIQUE INDEX` で守れ、`batch()` は 1 つのトランザクションとして実行されます。DynamoDB には `UNIQUE` 制約がないので、30章は一意性を条件付き書き込みとトランザクションで作ります。Durable Objects の SQLite では、章がそうして作っている保証を、実行のモデルが最初から与えてくれます |
| D1、KV、Durable Objects、R2 の置き場所 | [28](/ja/chapters/28-multi-region/wrap.md) | 場所がないのはコードだけで、データには置き場所があります。D1 は「書き込みは 1 か所、読み取りは各地」の形です。プライマリのある場所が使えなくなったときに D1 がどう動くかは、読んだページに書かれておらず、章は確かめていません |
| D1 のデータを運び出す | [39](/ja/chapters/39-database-migration.md) | D1 のデータを AWS へ持ってくるときに、DMS は使えません。用意されているのは `wrangler d1 export` で、書き出されるのは SQLite の SQL です。PostgreSQL 向けに直す変換は、章では試していません |
| Hyperdrive | [59](/ja/chapters/59-rds.md)、[60](/ja/chapters/60-aurora/wrap.md) | Hyperdrive は自分ではデータベースを持たず、すでにある PostgreSQL や MySQL の手前で接続をプールします。AWS の上のデータベースも対象なので、Workers をやめずに RDS や Aurora を使う道具になります。どちらの章も、その構成は試していません |
| D1 を借りていること | [66](/ja/chapters/66-distributed-sql.md) | 66章は、分散データベースを EC2 でセルフホストします。借りていて困っていないなら、そのまま借りておくのが正解だと章は書いています |
| R2 と S3 のあいだでデータを運ぶ | [38](/ja/chapters/38-data-movement/wrap.md) | S3 から R2 へは、Cloudflare の Super Slurper と Sippy があります。R2 から S3 へは、R2 を object storage ロケーションとして登録した DataSync が使えます |
| R2 の bucket locks | [58](/ja/chapters/58-ledger.md) | ルールはダッシュボードや Wrangler から外せます。バケットの持ち主にも外せないモードは、ドキュメントに見当たりませんでした。性質は S3 の Object Lock の governance モードに近く、自分にも消せない証拠の置き場所にはならない、と章は書いています |
| Workers の `node:fs` と `/tmp` | [53](/ja/chapters/53-efs/wrap.md) | Workers の `node:fs` はメモリ上の仮想ファイルシステムで、`/tmp` の内容は永続せず、リクエストごとに別です。複数の関数が同時にマウントする NFS のようなものは、章が読んだページには見当たりませんでした |
| binding | [48](/ja/chapters/48-sdk.md) | binding を使うと、認証情報を探す順序も、署名も、エンドポイントも、考える対象として出てきません。48章は、そのすべてを SDK で扱います。再試行とタイムアウトをどこまでプラットフォームが受け持つかは、章では確かめていません |

### 分析と検索

| 慣れているもの | 章 | 章が挙げている違い |
| --- | --- | --- |
| Workers Analytics Engine | [26](/ja/chapters/26-analytics/wrap.md) | 書き込みが多いと標本化され、保持は 3 か月で、クエリは 1 つのテーブルだけです。26章の構成は、届いた記録を全件残し、ほかのテーブルと結合できます。その代わり、ファイルの置き方と重複の扱いを自分で決めます |
| Basin Pipelines、Basin SQL、Logpush | [26](/ja/chapters/26-analytics/wrap.md)、[49](/ja/chapters/49-athena/wrap.md) | Basin Pipelines と Basin SQL は、以前は Cloudflare Pipelines、R2 SQL と呼ばれていました。Basin SQL は読むための入口で、SQL のリファレンスに `INSERT`、`UPDATE`、`DELETE`、`MERGE`、`CREATE TABLE AS` は載っていません。Athena は、書き込みと行単位の変更も同じエンジンで扱います |
| Basin Catalog | [43](/ja/chapters/43-glue/wrap.md) | 以前の R2 Data Catalog で、扱うのは Iceberg のテーブルだけです。すでに書かれたファイルを後からまとめて書き直す、Glue のジョブのような実行環境は、章が読んだページの範囲では見当たりませんでした |
| Vectorize | [27](/ja/chapters/27-search/wrap.md) | メタデータで絞り込むには、ベクトルを入れる前に、メタデータインデックスを作っておく必要があります。S3 Vectors では、メタデータは何もしなくても絞り込みに使えます |
| AI Search | [27](/ja/chapters/27-search/wrap.md) | ハイブリッド検索が既定で有効で、27章が自分で書いた順位の合わせ込みを、製品が持っています。文書を渡して検索できるようになるまでの手数は AI Search のほうがずっと少ない、と章は書いています。取り込み元として何を選べるかは、章は確かめていません |

### AI と通話

| 慣れているもの | 章 | 章が挙げている違い |
| --- | --- | --- |
| Workers AI の function calling、JSON Mode、prompt caching、Batch API | [36](/ja/chapters/36-bedrock/wrap.md) | `runWithTools` は、ツールを呼ぶループを書いてくれます。途中で切れた応答をやり直すかどうかといった判断は、ライブラリが決めます。36章は、その判断を自分のコードに置いて、テストで固定しています |
| AI Gateway | [36](/ja/chapters/36-bedrock/wrap.md) | AI Gateway は、アプリとモデルの提供元のあいだに置くプロキシです。Bedrock には、これに当たる単独の製品がありません。AI Gateway の caching は同じリクエストに同じレスポンスを返す機能で、36章の prompt caching とは別のものです |
| Agents、Sandbox SDK | [50](/ja/chapters/50-agentcore.md) | Agents は、エージェントの 1 つ 1 つを Durable Object に対応させます。分離の単位は Durable Object で、AgentCore のようなセッションごとの microVM ではありません |
| Sandbox | [63](/ja/chapters/63-agent-sandbox.md) | Sandbox のコンテナは自分のカーネルとネットワークを持つ microVM で、インターネットに出られるかどうかを Worker が決める、とドキュメントにあります。料金と上限については、章は概要のページを読んだだけです |
| Workers AI の画像、動画、音声のモデル | [56](/ja/chapters/56-nova/wrap.md) | 画像を生成したいだけなら、いまは Nova を選ぶ理由がない、と章は書いています。Nova には生成のモデルがなく、Workers AI の一覧にはあります。動画を生成する分類は、一覧に見当たりませんでした。一覧は要約して読んだもので、章は 1 行ずつ確かめてはいません |
| Workers AI の音声合成 | [57](/ja/chapters/57-polly/wrap.md) | 載っているモデルは、Deepgram の `aura-1`、`aura-2-en`、`aura-2-es` と、MyShell の `melotts` です。`melotts` が日本語を読めるかどうかは、章は確認していません |
| Realtime | [51](/ja/chapters/51-chime-sdk.md) | RealtimeKit では、バックエンドがミーティングを作り、参加者ごとの認証トークンをクライアントに渡します。51章の構成と同じ役割分担です。RealtimeKit の料金は、章は引用していません |

### 動かす場所

| 慣れているもの | 章 | 章が挙げている違い |
| --- | --- | --- |
| Workers の起動、メモリ、課金 | [29](/ja/chapters/29-lambda-tuning/wrap.md) | Workers のメモリは isolate あたり 128 MB で選べず、課金されるのは CPU を使った時間です。Lambda はメモリを選び、待っている時間にも課金されます。29章の半分ほどは Workers には当てはまらない、と章は書いています |
| 1 つのインスタンスが複数のリクエストを処理すること | [35](/ja/chapters/35-lambda-managed-instances.md) | グローバルな状態を使わないという Workers の注意は、35章が扱う不具合と同じ種類のものです。Lambda Managed Instances が違うのは、リクエストが来なくても料金がかかることと、インスタンスが自分のアカウントの VPC にあることです |
| Containers | [41](/ja/chapters/41-fargate/wrap.md)、[34](/ja/chapters/34-eks/wrap.md) | Containers は、既定で 10 分使われないと sleep し、課金が止まります。stateless なアプリ向けの組み込みの autoscaling は、いまは無いと FAQ にあります。Kubernetes の API を提供するサービスは、34章が読んだ範囲では Cloudflare に見当たりませんでした |
| Containers のイメージの置き場所 | [52](/ja/chapters/52-ecr.md) | イメージは Cloudflare が管理するレジストリに置かれ、`wrangler deploy` がビルドとプッシュまで行います。レジストリの側にライフサイクルや検査に当たる設定があるかどうかは、章は調べていません |
| workerd | [64](/ja/chapters/64-isolates.md) | 64章は、workerd を自分の AWS アカウントで動かします。世界中の拠点、binding の先の保存先、リクエストごとの上限、セキュリティの多層防御は、workerd のバイナリには入っていません。月 1,500 万リクエストの例では、Workers が USD 8.00、章の構成が USD 39.02 です |
| isolate という境界 | [67](/ja/chapters/67-firecracker.md) | 67章は、Lambda と Fargate の下で動く microVM と、isolate を並べています。優劣ではなく、何を動かすと約束したかの違いだと章は書いています |

### デプロイ、運用、守り

| 慣れているもの | 章 | 章が挙げている違い |
| --- | --- | --- |
| gradual deployments、version affinity、Flagship | [31](/ja/chapters/31-progressive-delivery/wrap.md) | Workers では、コマンド 1 つで 2 つの version に割合を付けられます。エラー率を見て自動で戻すという記述は、章が読んだページには見つかりませんでした。31章の構成は、アラームが鳴ったら自動で戻します |
| Workers の limits、Rate Limiting binding | [32](/ja/chapters/32-limits/wrap.md) | Workers の上限はプランごとの値で、調べる場所が 1 つで済みます。AWS の上限は、サービスごと、アカウントごと、リージョンごとのクォータです。Rate Limiting binding は拠点ごとに数え、正確な数え方ではないとドキュメントが断っています |
| Workers Logs の保持 | [33](/ja/chapters/33-production-readiness.md) | Workers Logs の保持は最長 7 日で、プラットフォームが決めています。AWS では、保持期間を書かなかったロググループは無期限に残ります。Cloudflare が公開前の確認事項の一覧を公開しているかどうかは、章は確認していません |
| `wrangler login` と API トークン | [37](/ja/chapters/37-cloudshell/wrap.md) | 管理画面の中で開けて、アカウントの認証情報を最初から持っているシェルは、章が確かめた範囲では Cloudflare にありません。`wrangler` は手元か CI で動かします |
| Workers Builds | [62](/ja/chapters/62-ci-runners/wrap.md) | ビルドのマシンを自分で用意する方法は、章が読んだページには見つかりませんでした。章が読んだのは、Workers Builds の制限と料金のページだけです |
| Incident Alerts、Maintenance Notification | [44](/ja/chapters/44-health/wrap.md) | Cloudflare では、公表された障害の購読が、画面の操作だけで済みます。AWS で設定なしで届くのは、自分のリソースに関わるイベントのメールだけです。公表された障害は、ルールか通知の設定を自分で作って受け取ります |
| DDoS の緩和 | [46](/ja/chapters/46-shield/wrap.md) | Cloudflare では、レイヤー 3 から 7 までの緩和が、Free を含むすべてのプランに含まれます。AWS では、レイヤー 3、4 は Shield Standard が受け持ち、レイヤー 7 は自分で web ACL、キャッシュ、歯止めを置きます |
| アカウントレベルの WAF | [42](/ja/chapters/42-firewall-manager/wrap.md) | ルールセットをアカウントに作って複数のゾーンに適用する機能で、Enterprise プランが要ります。Organization の中の複数のアカウントにまたがって適用できるかどうかは、章は確かめていません |
| リージョンを選ばないこと | [40](/ja/chapters/40-disaster-recovery/wrap.md) | 複製するディスクを持つサーバーも、開発者が選んで切り替えるリージョンも、Workers にはありません。40章の DRS に対応する体験はない、と章は書いています |

25章から先にも、比較のない章があります。45章は、テンプレートに当たるものが Cloudflare に無く、比べる対象を一次情報で確かめていないので、比較を書いていません。55章も、Cloudflare には触れていません。68章が読んだのは Workers の 1 ページだけで、Workers にエンクレーブに当たる仕組みがあるかどうかは、確かめていません。

## Cloudflare 側の記述の出どころ

このページに書いた Cloudflare 側の記述は、どれも章の本文にあるもので、新しい主張は足していません。もとになったページは、それぞれの章の「この章の検証メモ」に、確認日と一緒に載せています。3 つの経路の入口になっているのは次のページで、確認日はどれも 2026-10-11 です。

- [Workers: Local development](https://developers.cloudflare.com/workers/local-development/)
- [D1: Local development](https://developers.cloudflare.com/d1/best-practices/local-development/)
- [Workers AI: Bindings](https://developers.cloudflare.com/workers-ai/configuration/bindings/)

この本は、Cloudflare 側の比較用のコードを載せていません。`wrangler` の設定も、リポジトリにはありません。比較はどれも、ドキュメントを読んで書いた文章と表です。
