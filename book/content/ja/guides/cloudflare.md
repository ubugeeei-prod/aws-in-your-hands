---
title: Cloudflare から来た人へ
revision: 3
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

3 つの経路のほかにも、Cloudflare の製品と並べて説明している章があります。慣れているものから探せるように、表にまとめます。

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

## Cloudflare 側の記述の出どころ

このページに書いた Cloudflare 側の記述は、どれも章の本文にあるもので、新しい主張は足していません。もとになったページは、それぞれの章の「この章の検証メモ」に、確認日と一緒に載せています。3 つの経路の入口になっているのは次のページで、確認日はどれも 2026-10-11 です。

- [Workers: Local development](https://developers.cloudflare.com/workers/local-development/)
- [D1: Local development](https://developers.cloudflare.com/d1/best-practices/local-development/)
- [Workers AI: Bindings](https://developers.cloudflare.com/workers-ai/configuration/bindings/)

この本は、Cloudflare 側の比較用のコードを載せていません。`wrangler` の設定も、リポジトリにはありません。比較はどれも、ドキュメントを読んで書いた文章と表です。
