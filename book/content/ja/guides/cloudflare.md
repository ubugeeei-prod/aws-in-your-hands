---
title: Cloudflare から来た人へ
revision: 3
---

# Cloudflare から来た人へ

Cloudflare の D1、Workers、Workers AI で開発したことがある人のための案内です。乗り換えの手引きではありません。慣れた作業が AWS だとどういう手順になるのかを、同じ小さな機能を作りながら確かめていく。そのための道順です。

先に 2 つだけ断っておきますね。

サービス名の対応表は、出発点でしかありません。「D1 に当たるのは Aurora DSQL」と書いても、SQL の方言も、ローカルでの動かし方も、整合性の保証も、同じにはならないんです。

それから、どの経路の章も、本文とサンプルは書き上がっていますが、確かめたのは手元までです。AWS には、まだ一度もデプロイしていません。章ごとに何を確かめたかは、各章の末尾の「この章の検証メモ」にあります。

## 3 つの経路

| 慣れているもの | AWS で作るもの | 章 |
| --- | --- | --- |
| Workers で HTTP の handler を書く | Lambda と API Gateway HTTP API | [04](/ja/chapters/04-http-api.md)、[05](/ja/chapters/05-dynamodb.md)、[06](/ja/chapters/06-auth.md) |
| Workers で edge の処理を書く | CloudFront Functions と KeyValueStore。足りないときの Lambda@Edge | [10](/ja/chapters/10-edge.md) |
| D1 で SQL を書く | Aurora DSQL。復旧の考え方は DynamoDB と S3 で | [13](/ja/chapters/13-sql.md)、[22](/ja/chapters/22-recovery.md) |
| Workers AI でモデルを呼ぶ | Amazon Bedrock と Lambda の function URL | [17](/ja/chapters/17-ai.md) |

どの経路も、[01章](/ja/chapters/01-account.md)と[02章](/ja/chapters/02-toolchain.md)が前提です。

進め方はどの経路も同じで、5 つの段階を踏みます。手元で試す、テストする、公開の手順を整える、観測する、片付ける。

## Workers から来たなら

読む順は 00 → 01 → 02 → 03 → 04 → 10 です。10章は 03章の続きなので、03章を挟みます。

04章で、小さな HTTP の handler、型付きの client、環境変数の検証、手元での watch、テスト、デプロイ、ログの確認までを一通りやります。章の終わりには、Workers との違いを表にまとめてあります。ここでは要点を 4 つだけ。

まず、手元の実行環境が違います。Workers は、`wrangler dev` や Vite plugin が Miniflare を通じて、本番と同じ runtime（workerd）でコードを動かしてくれます。04章の `vp run dev:api` は Node.js の HTTP サーバーで、Lambda の runtime そのものではありません。

次に、binding がありません。Workers では、設定に binding を宣言すると `env` から使えて、手元では既定でローカルの模擬につながります。AWS では、SDK で呼び、接続先を環境変数で渡し、権限を IAM の role に書きます。手元用の模擬は、標準では付いてきません。

権限が 2 つある、というのも違いです。手元で動かすときはあなた自身の権限、デプロイ後は関数の実行 role の権限で動きます。手元で通った操作が、デプロイ後に拒否されることがあります。

最後に、実行場所です。Lambda は 1 つのリージョンで動きます。読者の近くで動かす処理が、10章の話題です。

10章では、CloudFront Function を 1 つ書きます。redirect の表、トップページを切り替える feature flag、メンテナンス表示のスイッチ。この 3 つを CloudFront KeyValueStore に置いて、関数から読みます。デプロイし直さずに切り替えるためです。

Workers の感覚と違うところが、ここにいくつも出てきます。関数は KeyValueStore を読むだけで、書けません。書くのは外から、専用の API でやります。章では、`edge-data.json` との差分だけを送る script を書いて、ETag で「見ていない変更を上書きしない」ようにしています。そして、書いた値が edge に届くまでには遅れがあります。どれくらいかは、Developer Guide に数字を見つけられませんでした。

CloudFront Functions で足りない仕事のために、Lambda@Edge も 1 つだけ動かします。POST された body の大きさと SHA-256 を返す、小さな関数です。こちらは `us-east-1` に作るしかないので、distribution とは別の、東京の外にある stack になりました。

手元では、デプロイするファイルそのものを Node.js で動かします（`vp run dev:edge`）。cdkd の emulator でも同じ応答になることは確かめました（`vp run dev:edge:cdkd`）。どちらも代用品で、CloudFront Functions の本物の runtime では、まだ一度も動かしていません。

章の終わりで、Workers、CloudFront Functions、Lambda@Edge を表に並べています。結論を先に言うと、CloudFront Functions は Workers の対応物ではありません。ネットワークにもファイルシステムにも触れない、URL とヘッダーの書き換えのための環境です。

## D1 から来たなら

読む順は 00 → 01 → 02 → 04 → 13 です。復旧まで追うなら、そのあと 22章へ。22章は 05章から 08章のノートと画像を題材にするので、そちらを先に読んでおくと楽です。

13章では、04章のノートの API を SQL で保存します。相手は Aurora DSQL です。schema と migration、型のついた query、seed と reset、手元での起動、Lambda からの接続までをつなげます。

先に知っておくといい違いを、挙げておきます。

- D1 は SQLite です。そして DynamoDB は SQL のデータベースではありません。SQL で書きたいなら、05章の DynamoDB ではなく 13章へ進んでください
- 実装したのは Aurora DSQL だけです。RDS for PostgreSQL と Aurora Serverless v2 は、どこが違うかを表で並べて、選ぶ条件を説明するところまで。動かしてはいません。この 2 つは VPC の中に置くものなので、選ぶなら 11章の話が要ります
- 手元の代用は PGlite です。PostgreSQL を Node.js のプロセスの中で動かす npm パッケージで、Docker は要りません。`wrangler dev` がローカルの D1 を用意してくれるのに近い体験ですが、D1 のローカルが本番と同じ D1 なのに対して、こちらはあくまで代用です。競合、IAM の token による認証、DSQL の制約（1 つの transaction に 3,000 行まで、DDL は 1 文ずつ、index は `CREATE INDEX ASYNC`）は再現しません。版も違います
- 手元で起きない競合は、テストでわざと起こしています。commit のときに負けた transaction は `40001` を受け取るので、全体をやり直します。この「やり直しを自分で書く」ところが、D1 の `batch()` といちばん違う手触りです
- migration は、番号つきの `.sql` を、この章の小さな runner が流します。1 ファイルに 1 文で、途中で止まっても流し直せる形にしてあります。ORM と一般的な migration ツールは、この章では動かしていません
- backup と restore は、13章では説明だけです。Aurora DSQL の backup は AWS Backup を通すこと、restore はいつも新しい cluster を作ることを書いていますが、リソースは作っていませんし、手順も試せていません

実際の cluster には、まだ一度もつないでいません。この章の SQL が DSQL に受け付けられるかどうかも、未確認のうちに入ります。

22章は、復旧の章です。ただし題材は Aurora DSQL ではありません。DynamoDB の point-in-time recovery と、S3 の versioning です。事故を起こして、table と bucket を別々の時刻に戻し、ずれを検査して、修復するところまでを、手元ではメモリの上で通しています。

D1 の Time Travel との違いは、章の中で並べています。Time Travel は database をその場で上書きして戻します。DynamoDB の PITR は、必ず新しい table を作ります。だから「切り替える」という仕事が残り、そのかわり、元の table と並べて差分を数えてから決められます。

## Workers AI から来たなら

読む順は 00 → 01 → 02 → 04 → 17 です。

17章では、まず数行でモデルを 1 回呼びます。そのあと、ノートの本文を要約して、できた分から少しずつ返す API を作ります。

- どちらも、推論は手元では動きません。Cloudflare のドキュメントは、Workers AI にはローカルの模擬がなく、モデルは常に remote で動くと書いています。Bedrock も同じです。手元で API サーバーを動かしていても、モデルの呼び出しは AWS に届いて、課金されます
- なので、テストと既定の開発サーバー（`vp run dev:ai`）は、決まったイベントの列（fixture）を流して、モデルを呼ばずに動きます。実際のモデルを呼ぶのは `ai:hello` と `ai:test:live` という別のタスクで、ふだんの `check:all` からは呼びません。この 2 つは、まだ実行していません
- streaming の入口は、Lambda の function URL にしました。04章の API Gateway HTTP API は、Lambda の応答を最後まで受け取ってから返すので、少しずつ返す、ができないからです。function URL が自分で持っている認証は IAM の署名だけなので、呼ぶ側は署名したリクエストを送ります
- Workers AI は `stream: true` を渡すと `text/event-stream` が返ってきて、そのまま応答にできます。Bedrock の `ConverseStream` は、イベントの列を SDK の async iterable で返します。server-sent events に組み立てるのは、自分の仕事です
- stream は途中で切れます。17章は「`done` を受け取っていない出力は、完了した要約として扱わない」と決めて、応答を 1 バイトずつ切り詰めるテストで確かめています

デプロイした関数から、function URL を通して少しずつ届くかどうかは、まだ見ていません。手元で確かめたのは、fixture を流したときの中継と、途中で切ったときの扱いまでです。

## ほかの章にも、比較があります

3 つの経路のほかにも、Cloudflare の部品と並べている章があります。慣れているものから引けるように、まとめておきます。

| 慣れているもの | この本で並べているもの | 章 |
| --- | --- | --- |
| R2 の presigned URL | S3 の presigned POST | [07](/ja/chapters/07-uploads.md) |
| Queues、R2 の event notification、Cron Triggers | SQS と DLQ、S3 の event notification、EventBridge Scheduler | [08](/ja/chapters/08-async.md) |
| Nuxt を Workers に出す | Nuxt を CloudFront とリージョンの Lambda で動かす | [09](/ja/chapters/09-ssr.md) |
| Cloudflare Containers | ECS on Fargate と ALB | [12](/ja/chapters/12-containers.md) |
| Workers KV、Durable Objects、rate limit の binding | DynamoDB、ElastiCache（Valkey）、CloudFront KeyValueStore | [14](/ja/chapters/14-kv-cache.md) |
| Email Service | SES | [15](/ja/chapters/15-email.md) |
| Workflows | Step Functions、Lambda durable functions | [16](/ja/chapters/16-long-jobs.md) |
| Stream の Live | IVS | [18](/ja/chapters/18-live.md) |
| Workers Logs と trace | CloudWatch と X-Ray | [19](/ja/chapters/19-observability.md) |
| `wrangler deploy` と version | CloudFormation、Lambda の version と alias、OIDC | [20](/ja/chapters/20-shipping.md) |
| secret の binding、WAF | Secrets Manager、AWS WAF | [21](/ja/chapters/21-security.md) |
| D1 の Time Travel | DynamoDB の PITR、S3 の versioning | [22](/ja/chapters/22-recovery.md) |

名前で混ざりやすいものを、3 つだけ。

Lambda durable functions と Durable Objects は、名前が似ているだけで別のものです。16章が、Cloudflare の側で近いのは Workflows だと説明しています。Durable Objects のほうは、14章で rate limit の置き場所として出てきます。AWS には、これに直接あたる部品はありません。

Workers KV を、AWS の 3 つの KV のどれか 1 つに対応づけるのは、やめておきます。14章が、重なり方がそれぞれ違うことを順に見ています。

24章の題材の celld は、Workers と Durable Objects のアプリケーションを自分の machine で動かす OSS です。AWS のサービスではありませんし、比べているのは「誰が運用するか」だけです。

どの章の比較も、Cloudflare の公式ドキュメントを読んだ範囲の話で、使って確かめたものではありません。確かめられなかった点は、それぞれの章にそのまま書いてあります。06章には Cloudflare Access に触れた段落がありますが、あれは一次情報を確認していない、一般的な構成の話です。11章と 23章には、比較がありません。VPC や仮想マシンに当たる体験が Cloudflare にあるかどうかを、調べていないからです。

## Cloudflare 側の話の出どころ

このページに書いた Cloudflare 側の記述は、どれも章の本文にあるものです。新しい主張は足していません。もとになったページは、それぞれの章の「この章の検証メモ」に、確認日と一緒に載せています。3 つの経路の入口になっているのは、次のページです。確認日はどれも 2026-10-11 です。

- [Workers: Local development](https://developers.cloudflare.com/workers/local-development/)
- [D1: Local development](https://developers.cloudflare.com/d1/best-practices/local-development/)
- [Workers AI: Bindings](https://developers.cloudflare.com/workers-ai/configuration/bindings/)

この本は、Cloudflare 側の比較用コードを載せていません。`wrangler` の設定も、リポジトリにはありません。比較はどれも、ドキュメントを読んで書いた文章と表です。
