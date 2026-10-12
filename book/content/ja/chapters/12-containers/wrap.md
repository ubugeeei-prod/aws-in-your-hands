---
title: "12 Containers: 費用、注意点、片付け"
---

# 12 Containers: 費用、注意点、片付け

## お金の話

<!-- section: 12.cost -->

金額は USD、東京リージョン、従量課金、税別、1 か月は 730 時間です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

まず、置いてあるだけでかかるぶん。既定の構成です。

| 対象 | 数量 | 単価 | 月額 |
| --- | --- | --- | --- |
| Fargate の vCPU（arm64） | task 2 × 0.25 vCPU × 730 時間 | 0.04045／vCPU 時 | 14.76 |
| Fargate のメモリ（arm64） | task 2 × 0.5 GB × 730 時間 | 0.00442／GB 時 | 3.23 |
| ALB | 730 時間 | 0.0243／時 | 17.74 |
| public IPv4 アドレス | （ALB 2 + task 2）× 730 時間 | 0.005／時 | 14.60 |
| 小計 | | | **50.33** |

1 日なら USD 1.65 です。これに、repository に置いた image の保存料金が乗ります（1 GB あたり月 USD 0.10。image 1 つを 0.1 GB と仮定して USD 0.01）。

表から読み取れることが 3 つあります。

**何もしていなくても、Lambda の章のおよそ 25 倍。** 04章は、月 100 万リクエストで USD 2.02 でした。こちらは 0 リクエストで USD 50.33。コンテナを選ぶなら、この固定費に見合う理由が要ります。

**public IPv4 アドレスが、Fargate と同じくらいかかっている。** 4 つで月 USD 14.60。ALB は AZ ごとに node を持ち、それぞれが 1 つずつ使います。task のぶんは、private subnet に移せば消えますが、そのかわりに NAT Gateway か endpoint の料金が乗ります。

**arm64 にしておくと 2 割安い。** 同じ大きさの task 1 つが、arm64 で月 USD 9.00、x86 で USD 11.25 です。

呼ばれると、こうなります。月 100 万リクエスト、task は 2 つのまま、という仮定です。

| 対象 | 数量 | 定価 |
| --- | --- | --- |
| 置いてあるだけのぶん（上の表と image） | | 50.34 |
| ALB の LCU | 11.1 LCU 時間 | 0.09 |
| CloudWatch Logs の取り込み | 0.191 GB | 0.15 |
| CloudWatch Logs の保存 | 0.045 GB 月 | 0.00 |
| インターネットへのデータ転送 | 0.477 GB | 0.05 |
| 小計 | | **50.63** |

CloudWatch Logs の毎月の無料枠（5 GB）を引くと USD 50.48 です。100 万リクエスト増えても、増えるのは USD 0.29。固定費がほとんどです。

LCU は、ALB が仕事量に応じて課金する単位で、新規の接続数、同時の接続数、通したデータ量、規則の評価数のうち、いちばん大きいものが数えられます。ここでは 1 リクエスト 1 接続として、新規の接続数で計算しました。リクエストが無いときの LCU（health check が数えられるのかどうか）は確認できていないので、最初の表には入れていません。0 という意味ではなく、未算入です。

task の置き場所を変えると、こうです。

| 構成 | この章の stack | 11章の側 | 合計 |
| --- | --- | --- | --- |
| 既定（public subnet） | 50.33 | 0 | 50.34 |
| `-c taskSubnets=private` と NAT Gateway 1 つ | 43.03 | 48.91 | 92.07 |
| `-c taskSubnets=private` と interface endpoint 3 つ | 43.03 | 61.32 | 104.37 |

合計には、image の保存（USD 0.01）と、NAT Gateway を通るデータを月 2 GB、endpoint を通るデータを月 1 GB とした仮定のぶんが入っています。

無料枠について。Fargate の料金ページに、無料枠の記述は見つかりませんでした。ALB と ECR には新規の利用者向けの枠が書かれていますが、すべてのアカウントに当てはまるものではないので、引いていません。

tag なしで deploy し直して repository だけにすれば、時間課金は止まり、残るのは image の保存料金だけです。

時間で課金されるものの数え方は、コードにしてあります。

<<< @/examples/12-containers/src/cost.ts{billable}

テストは、この関数が出す時間数が料金データのシナリオと一致することと、ここに書いた金額が計算結果と一致することを見ています。

## Cloudflare から来た人へ

<!-- section: 12.cloudflare -->

Cloudflare にも Containers があります。ドキュメントを読んだ範囲で、違いを並べます（使って確かめたわけではありません）。

| | Cloudflare Containers | この章（ECS on Fargate と ALB） |
| --- | --- | --- |
| 入口 | Worker。コンテナには Durable Object を通してだけ届く | ALB。HTTP を直接 task へ振り分ける |
| 起動 | リクエストが来たとき、または Worker のコードが起動したとき。使われなければ sleep する | service が決めた数を常に動かす |
| 料金 | 動いている間だけ、10 ms 単位。Workers Paid プランに含まれる枠がある | 置いてある時間。使われなくても同じ |
| 数の調整 | Worker のコードで決める。stateless なアプリ向けの組み込みの autoscaling は、いまは無い | target tracking に任せられる |
| 入れ替え | 既定で 10%、100% の 2 段階。止めるときは SIGTERM、15 分後に SIGKILL | rolling update。SIGTERM のあと最大 120 秒 |
| ネットワーク | 設計するものが無い | VPC、subnet、security group を自分で決める |
| 手元 | `wrangler dev`。Docker 互換の CLI と engine が要る | このサンプルは Node.js で直接動かす。image の build にだけ Docker が要る |

いちばん大きな違いは、使っていない間です。Cloudflare のコンテナは sleep して、料金が止まります。そのかわり、止まった状態からの起動（cold start）があって、ドキュメントは多くの場合 1〜3 秒としています。ECS の service は止まらないので、待たされません。そのかわり、使われていない時間にも料金がかかります。

もう 1 つ。Cloudflare では、コンテナの手前に必ず Worker と Durable Object がいて、振り分けや起動をコードで書きます。ECS では、その役を ALB と service の設定が担います。どちらが合うかは、作るもの次第です。

SIGTERM を受けて、進行中の仕事を終えてから止まる、という作法は、どちらでも同じです。更新中に新旧が同居するのも同じで、Cloudflare のドキュメントも、新しい Worker のコードが古い image のコンテナに届きうる、と書いています。この章の後半は、そのまま持っていけます。

## ハマりどころ

| こうなったら | ここを見る |
| --- | --- |
| `dev:ecs` が `Invalid environment` で止まる | `examples/12-containers/.env` はありますか。メッセージに出た変数名を確認 |
| `ecs:image:build` が `No Docker daemon answered` で止まる | client だけあって daemon が動いていません。Docker Desktop などを起動する |
| push が `ImageTagAlreadyExistsException` で失敗する | その tag はもう使われています。tag は immutable なので、新しい tag を付ける |
| deploy が service のところで長く止まり、失敗する | task が起動できていません。`aws ecs list-tasks --desired-status STOPPED` と `aws ecs describe-tasks` で `stoppedReason` を見る。image を取れない（tag の打ち間違い、private subnet なのに経路がない）ことが多い |
| task は動いているのに、ALB の URL がエラーを返す | `aws elbv2 describe-target-health` で、target が健全かどうかを見る。`/health` が 200 を返すか、8080 番が security group で許されているか |
| ときどき 502 が返る | サーバーの keep-alive が ALB の idle timeout より短くなっていませんか。`src/timing.ts` の関係を確認 |
| 更新のたびに、数件のリクエストが失敗する | SIGTERM を受けていない（`CMD` を配列で書いたか）、または deregistration delay より長いリクエストがある |
| 作ったノートが、呼ぶたびに出たり消えたりする | task が 2 つあって、それぞれが自分の `Map` を持っています。この章の仕様です |
| `net:infra:destroy` が `StackHasActiveImportsError` で止まる | この章の stack が VPC を使っています。先に `ecs:infra:destroy` |
| 使っていないのに請求がある | service が動いています。tag なしで deploy し直すか、destroy する |

最初の 2 行以外は、ドキュメントの記述から組み立てたもので、実際に起こして確かめたわけではありません。

## 本番にするなら

- **HTTPS にする。** ドメイン名と証明書を用意して、listener を 443 番にします。いまは平文です
- **認証と認可を足す。** 04章と同じで、URL を知っている人は誰でも呼べます（06章）
- **データを task の外に置く。** いまは更新のたびに消えます（05章、13章）。そのとき、「新旧が同時に動く」の決まりが本物の制約になります
- **task を private subnet に置く。** 出口を NAT にするか endpoint にするかは、11章の表で決めます
- **秘密は環境変数に直接書かない。** task definition の `secrets` で、Secrets Manager などから起動時に渡します。読む権限は execution role に付けます（secret の扱いは [21章](/ja/chapters/21-security.md)。あちらは Lambda の例です）
- **アプリの指標でも更新を止める。** circuit breaker は起動と health check しか見ません。ECS には、CloudWatch のアラームで更新を失敗にする仕組みもあります（アラームの組み立て方は [19章](/ja/chapters/19-observability.md)）
- **base image を digest で固定する。** `node:24-bookworm-slim` という tag は、中身が更新されていきます。いつ build しても同じ image にしたいなら、digest で指定します
- **AZ を 3 つにして、task も 3 つ以上にする。** 2 つだと、片方の AZ が止まった瞬間に処理能力が半分になります
- **ログの保持期間、ALB の削除保護、repository の `emptyOnDelete` を見直す。** どれも、練習用に「消しやすい」ほうへ倒してあります
- **反映の経路を AWS CDK CLI と CloudFormation にする。** cdkd の公式ドキュメントは、cdkd を開発・テスト用途向けとし、本番には AWS CDK CLI を勧めています（02章）

## 片付け

<!-- section: 12.cleanup -->

時間課金だけ止めて、image は残しておくなら、tag なしで deploy し直します。

```bash
vp run ecs:infra:diff
vp run ecs:infra:deploy
```

`diff` で、ALB、service、task definition などが消える変更として出て、repository が残ることを確かめてから実行してください。

全部消すなら、こちらです。

```bash
vp run ecs:infra:destroy
vp run net:infra:destroy
```

順番はこのとおりに。VPC を使っている stack が残っていると、11章の destroy は拒否されます。

repository は、中の image ごと消えます（`emptyOnDelete`）。log group も一緒です。stack の外に残るリソースは無いようにしてあって、テストも、残す設定がどのリソースにも付いていないことを見ています。

最後は、自分の目で確かめるのが確実です。

```bash
aws elbv2 describe-load-balancers --region ap-northeast-1
aws ecs list-clusters --region ap-northeast-1
aws ecr describe-repositories --region ap-northeast-1
```

1 つ目にこの章の load balancer が無く、2 つ目に cluster が無ければ、この章のぶんの時間課金は止まっています。3 つ目には、02章の `cdkd bootstrap` が作った repository だけが残っているはずです。

手元の daemon には、build した image が残ります。`docker image rm aih-notes:v1` で消せます。

::: details この章の検証メモ

**手元で確かめたこと。** サーバーを子プロセスとして起動し、リクエストの途中で SIGTERM を送るテスト。graceful shutdown のテスト（`sweep` を外すと `drained` が `forced` になって落ちることも確認）。新旧 2 つの版を同時に立てるテスト。時間の関係、設定、`docker` コマンドの組み立て、料金、stack の assertion のユニットテスト。型検査。`ecs:infra:synth`（tag なし、`-c imageTag=v1`、`-c imageTag=v1 -c taskSubnets=private`。`-c imageTag=latest` が拒否されることも）。`ecs:bundle` と `ecs:bundle:check`。`dev:ecs` を起動して、本文の `curl` と、Ctrl-C のときのログを確認。`ecs:image:build`、`ecs:image:run`、`ecs:image:push` の `--dry-run` と、daemon なしで実行したときのメッセージ。`ecs:watch` を `--url` で手元のサーバーに向けて実行。`ecs.ContainerImage.fromAsset` を使った synth が、`docker` コマンドの無い PATH で通ること（aws-cdk-lib 2.273.0）。`docker` の flag は、Docker CLI 29.7.2 の help で確かめました。本文の金額は、Price List の単価から `tools/src/pricing/calc.ts` が計算した値で、`examples/12-containers/test/pricing.test.ts` が照合しています。

**まだ確かめていないこと。** Docker の daemon が動いていなかったため、image を一度も build していません。したがって、Dockerfile が通ること、`.dockerignore` の例外指定が効くこと、arm64 の base image で起動すること、`--read-only` で動くこと、image の大きさ（料金の表の 0.1 GB は仮定）は未確認です。`ecs:infra:diff`、`ecs:infra:deploy`、`ecs:image:push`、`ecs:watch`、`ecs:logs`、`ecs:infra:drift`、`ecs:infra:destroy` は、実際の AWS では動かしていません。次はすべて実環境での確認待ちです。cdkd 0.296.28 がこの stack を作って消せること。別のアプリの stack から `Fn::ImportValue` で 11章の VPC を読めること。Cloud Control API 経由の 3 種類が通ること。public subnet の task が image を取得できること、443 番だけの egress で足りること。`-c taskSubnets=private` の 2 通りの経路。ALB の health check と fail open。rolling update の間にエラーが出ないこと。target の登録解除のあとに SIGTERM が届くという順序。circuit breaker の rollback と、そのときの cdkd の表示。auto scaling の増減。tag なしで deploy し直すと ALB と task だけが消えること。「ハマりどころ」の症状。

一次情報で確かめられなかったこと。リクエストが無いときの ALB の LCU。ECS と Application Auto Scaling の service-linked role が、そのアカウントでの最初の deploy で自動的に作られるかどうか。auto scaling が動いている service を deploy し直したとき、task の数が `desiredCount` の 2 に戻るかどうか。ALB が負荷に応じて node を増やしたときの public IPv4 アドレスの数。Docker Hub の `node:24-bookworm-slim` に arm64 版があることは、API の応答の先頭（amd64 の項目）しか読んでおらず、確かめていません。Cloudflare Containers は、ドキュメントを読んだだけです。

cdkd が扱うリソースの種類。`v0.296.28` タグの `src/provisioning/register-providers.ts` では、`AWS::ECS::Cluster`、`TaskDefinition`、`Service`（ECS の provider）、`AWS::ElasticLoadBalancingV2::LoadBalancer`、`TargetGroup`、`Listener`（ELBv2 の provider）、`AWS::ECR::Repository`、`AWS::EC2::SecurityGroup`、`SecurityGroupIngress`、`AWS::IAM::Role`、`Policy`、`AWS::Logs::LogGroup` が専用の実装に登録されています。`AWS::ApplicationAutoScaling::ScalableTarget`、`ScalingPolicy`、`AWS::EC2::SecurityGroupEgress` は登録が無く、未対応の一覧にも無いので、Cloud Control API 経由です。ECS の provider は、task definition の変更を置き換え（新しい revision の登録と、古い revision の登録解除）として扱い、service は既定では `CreateService`／`UpdateService` が受け付けられた時点で戻り、`--full-wait` のときだけ安定するまで待ちます。ECR の provider は、`EmptyOnDelete` が true のときに限って、image ごと repository を消します。npm の tarball には TypeScript のソースが入っていないため、GitHub のタグの archive を読みました。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 全体像 | `examples/12-containers/infra/lib/containers-stack.ts`、`src/config.ts` | `ecs:infra:synth` |
| docker は 2 つのプログラム | `examples/12-containers/src/image.ts`、`scripts/image.ts` | `ecs:image:build` |
| handler から、ずっと動くサーバーへ | `examples/12-containers/src/compose.ts`、`src/env.ts`、`src/server.ts`、`test/compose.test.ts`、`.env.example` | `dev:ecs`、`test:unit` |
| 止められ方を決める | `examples/12-containers/src/serve.ts`、`src/server.ts`、`test/shutdown.test.ts` | `test:unit` |
| image を作る | `examples/12-containers/Dockerfile`、`.dockerignore`、`scripts/bundle.ts`、`scripts/check-bundle.ts`、`src/image.ts` | `ecs:bundle`、`ecs:bundle:check`、`ecs:image:build`、`ecs:image:run` |
| image の置き場所 | `examples/12-containers/infra/lib/containers-stack.ts`、`infra/bin/app.ts`、`src/config.ts`、`test/config.test.ts` | `ecs:infra:synth`、`ecs:image:push`、`test:unit` |
| task はどの subnet に住む？ | `examples/12-containers/infra/lib/containers-stack.ts`、`infra/test/containers-stack.test.ts`、`examples/11-network/infra/lib/import-network.ts` | `test:unit`、`net:plan` |
| role は 2 つ | `examples/12-containers/infra/lib/containers-stack.ts`、`infra/test/containers-stack.test.ts` | `test:unit` |
| service と ALB | `examples/12-containers/infra/lib/containers-stack.ts`、`src/timing.ts`、`test/timing.test.ts` | `test:unit`、`ecs:infra:synth` |
| 更新中に起きること | `examples/12-containers/infra/lib/containers-stack.ts`、`src/timing.ts`、`scripts/watch.ts`、`src/watch.ts` | `ecs:watch` |
| 新旧が同時に動く | `examples/12-containers/src/compat.ts`、`test/versions.test.ts` | `test:unit` |
| task を増やす、減らす | `examples/12-containers/infra/lib/containers-stack.ts`、`src/config.ts` | `test:unit` |
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
