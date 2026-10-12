---
title: "12 Containers: 費用、注意点、片付け"
---

# 12 Containers: 費用、注意点、片付け

## お金の話

<!-- section: 12.cost -->

金額は USD、東京リージョン、従量課金、税別で、1 か月を 730 時間として計算しています。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

最初の表は、既定の構成で、置いてあるだけでかかる料金です。

| 対象 | 数量 | 単価 | 月額 |
| --- | --- | --- | --- |
| Fargate の vCPU（arm64） | タスク 2 × 0.25 vCPU × 730 時間 | 0.04045／vCPU 時 | 14.76 |
| Fargate のメモリ（arm64） | タスク 2 × 0.5 GB × 730 時間 | 0.00442／GB 時 | 3.23 |
| ALB | 730 時間 | 0.0243／時 | 17.74 |
| public IPv4 アドレス | （ALB 2 + タスク 2）× 730 時間 | 0.005／時 | 14.60 |
| 小計 | | | **50.33** |

1 日あたりでは USD 1.65 です。このほかに、リポジトリに置いたイメージの保存料金がかかります（1 GB あたり月 USD 0.10。イメージ 1 つを 0.1 GB と仮定して USD 0.01）。

この表からわかることが 3 つあります。

**何もしていなくても、Lambda の章のおよそ 25 倍かかります。** 04章は月 100 万リクエストで USD 2.02 でしたが、この章は 0 リクエストで USD 50.33 です。コンテナを選ぶなら、この固定費に見合う理由が必要です。

**public IPv4 アドレスに、Fargate と同じくらいの料金がかかっています。** 4 つで月 USD 14.60 です。ALB は AZ ごとにノードを持ち、ノードがそれぞれ 1 つずつアドレスを使います。タスクのアドレスは、タスクを private サブネットに移せば不要になりますが、かわりに NAT Gateway かエンドポイントの料金がかかります。

**arm64 にすると 2 割安くなります。** 同じ大きさのタスク 1 つが、arm64 で月 USD 9.00、x86 で USD 11.25 です。

次の表は、月 100 万リクエストを受け、タスクは 2 つのままと仮定したときの料金です。

| 対象 | 数量 | 定価 |
| --- | --- | --- |
| 置いてあるだけのぶん（上の表とイメージ） | | 50.34 |
| ALB の LCU | 11.1 LCU 時間 | 0.09 |
| CloudWatch Logs の取り込み | 0.191 GB | 0.15 |
| CloudWatch Logs の保存 | 0.045 GB 月 | 0.00 |
| インターネットへのデータ転送 | 0.477 GB | 0.05 |
| 小計 | | **50.63** |

CloudWatch Logs の毎月の無料枠（5 GB）を引くと USD 50.48 です。リクエストが 100 万件増えても、料金は USD 0.29 しか増えません。ほとんどが固定費です。

LCU は、ALB が仕事量に応じて課金するときの単位です。新規の接続数、同時の接続数、通したデータ量、規則の評価数の 4 つのうち、いちばん大きいものが課金の対象になります。ここでは 1 リクエストを 1 接続として、新規の接続数で計算しました。リクエストが無いときの LCU（ヘルスチェックが数えられるのかどうか）は確認できていないので、最初の表には入れていません。0 という意味ではなく、未算入です。

タスクの置き場所を変えると、合計は次のように変わります。

| 構成 | この章のスタック | 11章の側 | 合計 |
| --- | --- | --- | --- |
| 既定（public サブネット） | 50.33 | 0 | 50.34 |
| `-c taskSubnets=private` と NAT Gateway 1 つ | 43.03 | 48.91 | 92.07 |
| `-c taskSubnets=private` と interface endpoint 3 つ | 43.03 | 61.32 | 104.37 |

合計には、イメージの保存（USD 0.01）と、NAT Gateway を通るデータを月 2 GB、エンドポイントを通るデータを月 1 GB と仮定した料金が入っています。

無料枠は引いていません。Fargate の料金ページには、無料枠の記述が見つかりませんでした。ALB と ECR には新規の利用者向けの枠が書かれていますが、すべてのアカウントに当てはまるものではありません。

**叩かれたら。** ALB の URL は、知っていれば誰でも HTTP で呼べます。認証はありません。ALB には、API Gateway のステージのスロットリングに当たる、追加料金なしの流量制限もないので、届いたリクエストはすべてタスクまで届きます。

大量のリクエストが来たときに、上限があるものと無いものは次のとおりです。

- **固定費には上限があります。** タスクは `maxCount` の 4 つまでしか増えません。4 つのまま 1 か月動いても、置いてあるだけでかかる料金は USD 75.62 です（Fargate 35.98、ALB 17.74、public IPv4 が 6 つで 21.90）
- **メモリには上限があります。** ノートはタスクごとに 100 件までで、101 件目は 409 になります。本文は最大 10,000 文字なので、1 つのタスクが持つノートは多くても 100 万文字ほどです。接続はタスクごとに 512 本まで、本文は 1 件 64 KiB までです
- **LCU、ログ、データ転送には上限がありません。** どれも、届いたリクエストのぶんだけ増えます

上限が無いものの大きさを、上の表と同じ仮定（1 リクエスト 1 接続、ログ 0.2 KB、レスポンス 0.5 KB）で計算します。1 秒に 100 件が 30 日続くと、2 億 5,920 万件になります。LCU が USD 23.04、ログの取り込みが USD 37.57、データ転送が USD 14.09 で、合わせて月 USD 74.70 です。1 秒に 1,000 件なら、その 10 倍になります。0.25 vCPU のタスク 4 つがこの件数に答えられるかどうかは、計っていません。タスクが答えられなかったリクエストも、ALB には届いています。

この計算に入っていないものが 2 つあります。LCU は 4 つの数え方のうち、いちばん大きいものが採られます。大きな本文を送り続けられたときに、データ量の数え方で何 LCU になるかは、計算していません。データ転送は、レスポンスの大きさでも変わります。04章の契約では、一覧は要約 20 件で 20 KiB まで、ノート 1 件は 64 KiB までです。1 秒に 100 件のレスポンスがすべて 64 KiB のノートだったとすると、30 日で約 15,820 GB、データ転送だけで USD 1,664 ほどになります。

実際の利用者を迎える前に、入口に流量制限が必要です。AWS WAF は ALB に付けられます（[21章](/ja/chapters/21-security.md)）。ただし、この本が持っている WAF の単価は CloudFront 用のもので、東京リージョンの ALB に付ける web ACL の単価は確かめていません。練習の間だけなら、ALB のセキュリティグループを自分の IP アドレスだけに絞る方法もあります（この章のスタックは、そうしていません）。

タグなしでデプロイし直してリポジトリだけにすれば、時間課金は止まり、残るのはイメージの保存料金だけです。

時間で課金されるものの数え方は、コードにしてあります。

<<< @/examples/12-containers/src/cost.ts{billable}

テストは、この関数が出す時間数が料金データのシナリオと一致することと、このページに書いた金額が計算結果と一致することを確かめています。

## Cloudflare から来た人へ

<!-- section: 12.cloudflare -->

Cloudflare にも Containers があります。ドキュメントを読んだ範囲で、違いを並べます（使って確かめてはいません）。

| | Cloudflare Containers | この章（ECS on Fargate と ALB） |
| --- | --- | --- |
| 入口 | Worker。コンテナには Durable Object を通してだけ届く | ALB。HTTP を直接タスクへ振り分ける |
| 起動 | リクエストが来たとき、または Worker のコードが起動したとき。使われなければ sleep する | サービスが決めた数を常に動かす |
| 料金 | 動いている間だけ、10 ms 単位。Workers Paid プランに含まれる枠がある | 置いてある時間。使われなくても同じ |
| 数の調整 | Worker のコードで決める。stateless なアプリ向けの組み込みの autoscaling は、いまは無い | target tracking に任せられる |
| 入れ替え | 既定で 10%、100% の 2 段階。止めるときは SIGTERM、15 分後に SIGKILL | ローリングアップデート。SIGTERM のあと最大 120 秒 |
| ネットワーク | 設計するものが無い | VPC、サブネット、セキュリティグループを自分で決める |
| 手元 | `wrangler dev`。Docker 互換の CLI と engine が要る | このサンプルは Node.js で直接動かす。イメージのビルドにだけ Docker が要る |

いちばん大きな違いは、使っていない間の扱いです。Cloudflare のコンテナは sleep して料金が止まるかわりに、止まった状態からの起動（cold start）があり、ドキュメントは多くの場合 1〜3 秒としています。ECS のサービスは止まらないので起動を待たされませんが、使われていない時間にも料金がかかります。

もう 1 つの違いは、振り分けと起動を決める場所です。Cloudflare では、コンテナの手前に必ず Worker と Durable Object があり、振り分けや起動をコードで書きます。ECS では、ALB とサービスの設定がその役割を持ちます。どちらが合うかは、作るものによって変わります。

SIGTERM を受けたら進行中の仕事を終えてから止まる、という作り方は、どちらでも同じです。更新中に新旧が同時に動くことも同じで、Cloudflare のドキュメントも、新しい Worker のコードが古いイメージのコンテナに届きうると書いています。[実装のつづき](/ja/chapters/12-containers/more.md)の「更新中に起きること」と「新旧が同時に動く」は、Cloudflare でもそのまま使えます。

## ハマりどころ

| こうなったら | ここを見る |
| --- | --- |
| `dev:ecs` が `Invalid environment` で止まる | `examples/12-containers/.env` があるかどうかを確かめる。メッセージに出た変数名も確認する |
| `ecs:image:build` が `No Docker daemon answered` で止まる | クライアントだけがあって、デーモンが動いていません。Docker Desktop などを起動する |
| プッシュが `ImageTagAlreadyExistsException` で失敗する | そのタグはすでに使われています。タグは immutable なので、新しいタグを付ける |
| デプロイがサービスのところで長く止まり、失敗する | タスクが起動できていません。`aws ecs list-tasks --desired-status STOPPED` と `aws ecs describe-tasks` で `stoppedReason` を見る。イメージを取得できない（タグの打ち間違い、private サブネットなのに経路がない）ことが多い |
| タスクは動いているのに、ALB の URL がエラーを返す | `aws elbv2 describe-target-health` で、ターゲットが健全かどうかを見る。`/health` が 200 を返すか、8080 番がセキュリティグループで許されているかを確かめる |
| ときどき 502 が返る | サーバーの keep-alive が ALB の idle timeout より短くなっていないかを確かめる。`src/timing.ts` の関係を確認する |
| 更新のたびに、数件のリクエストが失敗する | SIGTERM を受けていない（`CMD` を配列で書いたか）、または deregistration delay より長いリクエストがある |
| 作ったノートが、呼ぶたびに出たり消えたりする | タスクが 2 つあって、それぞれが自分の `Map` を持っています。この章の仕様です |
| POST が 409 で `quota_exceeded` を返す | そのタスクの `Map` が 100 件でいっぱいです。タスクごとに数えるので、同じ POST が通ったり通らなかったりします。ノートを消すか、タスクが入れ替わると空きます |
| `net:infra:destroy` が `StackHasActiveImportsError` で止まる | この章のスタックが VPC を使っています。先に `ecs:infra:destroy` を実行する |
| 使っていないのに請求がある | サービスが動いています。タグなしでデプロイし直すか、destroy する |

最初の 2 行以外は、ドキュメントの記述から組み立てたもので、実際に起こして確かめてはいません。

## 本番にするなら

- **HTTPS にする。** ドメイン名と証明書を用意して、リスナーを 443 番にします。いまは平文です
- **認証と認可を足す。** 04章と同じで、URL を知っている人は誰でも呼べます（06章）
- **入口に流量制限を置く。** ALB は、届いたリクエストをすべて通します。AWS WAF の rate-based rule を ALB に付けます（21章。ALB 用の単価は、この本では確かめていません）
- **データをタスクの外に置く。** いまは更新のたびに消えます（05章、13章）。外に置くと、[新旧が同時に動く](/ja/chapters/12-containers/more.md)の節の決まりが実際の制約になります
- **タスクを private サブネットに置く。** 出口を NAT にするかエンドポイントにするかは、11章の表で決めます
- **シークレットを環境変数に直接書かない。** タスク定義の `secrets` で、Secrets Manager などから起動時に渡します。読む権限はタスク実行ロールに付けます（シークレットの扱いは [21章](/ja/chapters/21-security.md)にあります。21章の例は Lambda です）
- **アプリの指標でも更新を止める。** circuit breaker は起動とヘルスチェックしか見ません。ECS には、CloudWatch のアラームで更新を失敗にする仕組みもあります（アラームの組み立て方は [19章](/ja/chapters/19-observability.md)）
- **ベースイメージをダイジェストで固定する。** `node:24-bookworm-slim` というタグは、中身が更新されていきます。いつビルドしても同じイメージにしたいなら、ダイジェストで指定します
- **AZ を 3 つにして、タスクも 3 つ以上にする。** 2 つだと、片方の AZ が止まった時点で処理能力が半分になります
- **ログの保持期間、ALB の削除保護、リポジトリの `emptyOnDelete` を見直す。** どれも、練習用に消しやすい設定にしてあります
- **反映の経路を AWS CDK CLI と CloudFormation にする。** cdkd の公式ドキュメントは、cdkd を開発・テスト用途向けとし、本番には AWS CDK CLI を勧めています（02章）

## 片付け

<!-- section: 12.cleanup -->

時間課金だけを止めてイメージを残すなら、タグなしでデプロイし直します。

```bash
vp run ecs:infra:diff
vp run ecs:infra:deploy
```

`diff` で、ALB、サービス、タスク定義などが削除される変更として表示され、リポジトリが残ることを確かめてから実行してください。

すべて消すなら、次の 2 つを実行します。

```bash
vp run ecs:infra:destroy
vp run net:infra:destroy
```

この順番を守ってください。VPC を使っているスタックが残っていると、11章の destroy は拒否されます。

リポジトリは、中のイメージごと消えます（`emptyOnDelete`）。ロググループも一緒に消えます。スタックの外に残るリソースが無いようにしてあり、テストも、残す設定がどのリソースにも付いていないことを確かめています。

最後に、自分で確かめておくと確実です。

```bash
aws elbv2 describe-load-balancers --region ap-northeast-1
aws ecs list-clusters --region ap-northeast-1
aws ecr describe-repositories --region ap-northeast-1
```

1 つ目にこの章のロードバランサーが無く、2 つ目にクラスターが無ければ、この章の時間課金は止まっています。3 つ目には、02章の `cdkd bootstrap` が作ったリポジトリだけが残っているはずです。

手元のデーモンには、ビルドしたイメージが残ります。`docker image rm aih-notes:v1` で消せます。

::: details この章の検証メモ

**手元で確かめたこと。** サーバーを子プロセスとして起動し、リクエストの途中で SIGTERM を送るテスト。graceful shutdown のテスト（`sweep` を外すと `drained` が `forced` になって失敗することも確認）。新旧 2 つの版を同時に起動するテスト。時間の関係、設定、`docker` コマンドの組み立て、料金、スタックの assertion のユニットテスト。型検査。`ecs:infra:synth`（タグなし、`-c imageTag=v1`、`-c imageTag=v1 -c taskSubnets=private`。`-c imageTag=latest` が拒否されることも）。`ecs:bundle` と `ecs:bundle:check`。`dev:ecs` を起動して、本文の `curl` と、Ctrl-C のときのログを確認。`ecs:image:build`、`ecs:image:run`、`ecs:image:push` の `--dry-run` と、デーモンなしで実行したときのメッセージ。`ecs:watch` を `--url` で手元のサーバーに向けて実行。`ecs.ContainerImage.fromAsset` を使った synth が、`docker` コマンドの無い PATH で通ること（aws-cdk-lib 2.273.0）。`docker` のフラグは、Docker CLI 29.7.2 の help で確かめました。本文の金額は、Price List の単価から `tools/src/pricing/calc.ts` が計算した値で、`examples/12-containers/test/pricing.test.ts` が照合しています。

**まだ確かめていないこと。** 接続の上限（`maxConnections`）は、手元の Node.js で、上限を超えた接続が応答なしで閉じられることを確かめただけです。ALB の後ろで接続が上限に達したときに利用者へ何が返るか、ヘルスチェックがどうなるかは、確かめていません。512 という数も、計って決めた値ではありません。Docker のデーモンが動いていなかったため、イメージを一度もビルドしていません。したがって、Dockerfile が通ること、`.dockerignore` の例外指定が効くこと、arm64 のベースイメージで起動すること、`--read-only` で動くこと、イメージの大きさ（料金の表の 0.1 GB は仮定）は未確認です。`ecs:infra:diff`、`ecs:infra:deploy`、`ecs:image:push`、`ecs:watch`、`ecs:logs`、`ecs:infra:drift`、`ecs:infra:destroy` は、実際の AWS では動かしていません。次の項目は、すべて実環境での確認を待っています。cdkd 0.296.28 がこのスタックを作って消せること。別のアプリのスタックから `Fn::ImportValue` で 11章の VPC を読めること。Cloud Control API 経由の 3 種類が通ること。public サブネットのタスクがイメージを取得できること、443 番だけの egress で足りること。`-c taskSubnets=private` の 2 通りの経路。ALB のヘルスチェックと fail open。ローリングアップデートの間にエラーが出ないこと。ターゲットの登録解除のあとに SIGTERM が届くという順序。circuit breaker のロールバックと、そのときの cdkd の表示。auto scaling の増減。タグなしでデプロイし直すと ALB とタスクだけが消えること。「ハマりどころ」の症状。

一次情報で確かめられなかったこと。リクエストが無いときの ALB の LCU。ECS と Application Auto Scaling の service-linked role が、そのアカウントでの最初のデプロイで自動的に作られるかどうか。auto scaling が動いているサービスをデプロイし直したとき、タスクの数が `desiredCount` の 2 に戻るかどうか。ALB が負荷に応じてノードを増やしたときの public IPv4 アドレスの数。Docker Hub の `node:24-bookworm-slim` に arm64 版があることは、API の応答の先頭（amd64 の項目）しか読んでおらず、確かめていません。Cloudflare Containers は、ドキュメントを読んだだけです。

cdkd が扱うリソースの種類。`v0.296.28` タグの `src/provisioning/register-providers.ts` では、`AWS::ECS::Cluster`、`TaskDefinition`、`Service`（ECS の provider）、`AWS::ElasticLoadBalancingV2::LoadBalancer`、`TargetGroup`、`Listener`（ELBv2 の provider）、`AWS::ECR::Repository`、`AWS::EC2::SecurityGroup`、`SecurityGroupIngress`、`AWS::IAM::Role`、`Policy`、`AWS::Logs::LogGroup` が専用の実装に登録されています。`AWS::ApplicationAutoScaling::ScalableTarget`、`ScalingPolicy`、`AWS::EC2::SecurityGroupEgress` は登録が無く、未対応の一覧にも無いので、Cloud Control API を経由します。ECS の provider は、タスク定義の変更を置き換え（新しいリビジョンの登録と、古いリビジョンの登録解除）として扱います。サービスについては、既定では `CreateService`／`UpdateService` が受け付けられた時点で戻り、`--full-wait` のときだけ安定するまで待ちます。ECR の provider は、`EmptyOnDelete` が true のときに限って、イメージごとリポジトリを消します。npm の tarball には TypeScript のソースが入っていないため、GitHub のタグの archive を読みました。

**コードの場所。**

| 節 | ファイル | `vp run` のタスク |
| --- | --- | --- |
| 全体像 | `examples/12-containers/infra/lib/containers-stack.ts`、`src/config.ts` | `ecs:infra:synth` |
| docker は 2 つのプログラム | `examples/12-containers/src/image.ts`、`scripts/image.ts` | `ecs:image:build` |
| handler から、動き続けるサーバーへ | `examples/12-containers/src/compose.ts`、`src/env.ts`、`src/server.ts`、`test/compose.test.ts`、`.env.example` | `dev:ecs`、`test:unit` |
| 止められたときの振る舞い | `examples/12-containers/src/serve.ts`、`src/server.ts`、`test/shutdown.test.ts` | `test:unit` |
| イメージを作る | `examples/12-containers/Dockerfile`、`.dockerignore`、`scripts/bundle.ts`、`scripts/check-bundle.ts`、`src/image.ts` | `ecs:bundle`、`ecs:bundle:check`、`ecs:image:build`、`ecs:image:run` |
| イメージの置き場所 | `examples/12-containers/infra/lib/containers-stack.ts`、`infra/bin/app.ts`、`src/config.ts`、`test/config.test.ts` | `ecs:infra:synth`、`ecs:image:push`、`test:unit` |
| タスクを置くサブネット | `examples/12-containers/infra/lib/containers-stack.ts`、`infra/test/containers-stack.test.ts`、`examples/11-network/infra/lib/import-network.ts` | `test:unit`、`net:plan` |
| 2 つのロール | `examples/12-containers/infra/lib/containers-stack.ts`、`infra/test/containers-stack.test.ts` | `test:unit` |
| サービスと ALB | `examples/12-containers/infra/lib/containers-stack.ts`、`src/timing.ts`、`test/timing.test.ts` | `test:unit`、`ecs:infra:synth` |
| 更新中に起きること | `examples/12-containers/infra/lib/containers-stack.ts`、`src/timing.ts`、`scripts/watch.ts`、`src/watch.ts` | `ecs:watch` |
| 新旧が同時に動く | `examples/12-containers/src/compat.ts`、`test/versions.test.ts` | `test:unit` |
| タスクを増やす、減らす | `examples/12-containers/infra/lib/containers-stack.ts`、`src/config.ts` | `test:unit` |
| 手元で確かめる | `examples/12-containers/test/`、`infra/test/containers-stack.test.ts`、`scripts/check-bundle.ts` | `test:unit`、`ecs:bundle:check`、`ecs:infra:synth`、`dev:ecs` |
| デプロイする | `examples/12-containers/infra/bin/app.ts`、`cdk.json`、`scripts/image.ts`、`scripts/watch.ts`、`scripts/logs.ts`、`tools/src/infra/` | `ecs:infra:diff`、`ecs:infra:deploy`、`ecs:image:push`、`ecs:watch`、`ecs:logs`、`ecs:infra:drift` |
| お金の話 | `examples/12-containers/src/cost.ts`、`test/pricing.test.ts`、`data/pricing/` | `test:unit` |
| 片付け | `tools/src/infra/` | `ecs:infra:deploy`、`ecs:infra:destroy` |

**一次情報**（確認日はすべて 2026-10-12）

- [What is Amazon ECS?](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/Welcome.html)、[Amazon ECS task lifecycle](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-lifecycle-explanation.html)、[ContainerDefinition](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_ContainerDefinition.html)、[Best practices for Amazon ECS container images](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/container-considerations.html)、[Fargate task definition differences](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html)、[64-bit ARM workloads](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-arm64.html)
- [Deploy Amazon ECS services by replacing tasks](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-ecs.html)、[deployment circuit breaker](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-circuit-breaker.html)、[connection draining parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/load-balancer-connection-draining.html)、[load balancer health check parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/load-balancer-healthcheck.html)、[container health checks](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/healthcheck.html)、[AWS::ECS::Service](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecs-service.html)
- [Amazon ECS task IAM role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html)、[Amazon ECS task execution IAM role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html)
- [Automatically scale your Amazon ECS service](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-auto-scaling.html)、[Use a target metric to scale Amazon ECS services](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-autoscaling-targettracking.html)
- [Amazon ECS task networking options for Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html)、[Amazon ECR interface VPC endpoints](https://docs.aws.amazon.com/AmazonECR/latest/userguide/vpc-endpoints.html)（11章で 2026-10-11 に確認）、[Security groups](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html)
- [Health checks for Application Load Balancer target groups](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/target-group-health-checks.html)、[Edit target group attributes](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-target-group-attributes.html)、[Edit attributes for your Application Load Balancer](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-load-balancer-attributes.html)、[Application Load Balancers](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/application-load-balancers.html)
- [Pushing a Docker image to an Amazon ECR private repository](https://docs.aws.amazon.com/AmazonECR/latest/userguide/docker-push-ecr-image.html)、[Image tag mutability](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-tag-mutability.html)
- [AWS Fargate pricing](https://aws.amazon.com/fargate/pricing/)、[Elastic Load Balancing pricing](https://aws.amazon.com/elasticloadbalancing/pricing/)、[Amazon ECR pricing](https://aws.amazon.com/ecr/pricing/)
- AWS Price List bulk API: [ECS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/ap-northeast-1/index.json)（Fargate）、[ELB](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/current/ap-northeast-1/index.json)、[ECR](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECR/current/ap-northeast-1/index.json)。NAT Gateway、interface endpoint、public IPv4 アドレス、CloudWatch Logs、データ転送の単価は、11章までに取得したもの（2026-10-11 確認）
- [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)
- [What is Docker?](https://docs.docker.com/get-started/docker-overview/)、[Dockerfile reference](https://docs.docker.com/reference/dockerfile/)、[docker-node: Best Practices](https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md)、[Docker Hub: node:24-bookworm-slim](https://hub.docker.com/v2/repositories/library/node/tags/24-bookworm-slim)、[Node.js v24: HTTP](https://nodejs.org/docs/latest-v24.x/api/http.html)
- Cloudflare Containers: [Overview](https://developers.cloudflare.com/containers/)、[Pricing](https://developers.cloudflare.com/containers/platform/pricing/)、[Rollouts](https://developers.cloudflare.com/containers/configuration/rollouts/)、[Lifecycle of a container](https://developers.cloudflare.com/containers/concepts/architecture/)、[FAQ](https://developers.cloudflare.com/containers/faq/)、[Local development](https://developers.cloudflare.com/containers/guides/local-dev/)
- cdkd v0.296.28: [src/provisioning](https://github.com/go-to-k/cdkd/tree/v0.296.28/src/provisioning)、[docs/cli-deploy.md](https://github.com/go-to-k/cdkd/blob/v0.296.28/docs/cli-deploy.md)、[src/assets/docker-asset-publisher.ts](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/assets/docker-asset-publisher.ts)、[Introduction](https://cdkd.dev/introduction/)（2026-10-11 確認）
- [aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0)（`ecs.ContainerImage.fromAsset` の synth を実行して観察）

:::
