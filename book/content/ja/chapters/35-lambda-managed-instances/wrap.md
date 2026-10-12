---
title: "35 Lambda Managed Instances: 費用、注意点、片付け"
---

# 35 Lambda Managed Instances: 費用、注意点、片付け

章の最後のページです。標準の Lambda より安くなる点の計算、制限、つまずきやすい点、本番に向けて変えること、片付けの順に進みます。

## 損益分岐の計算

<!-- section: 35.break-even -->

標準の Lambda と Lambda Managed Instances は、課金の単位が違います。標準の Lambda は、リクエストが動いている間だけ、関数のメモリと時間の積（GB 秒）に課金します。Lambda Managed Instances は、リクエストがあっても無くても、インスタンスの時間に課金します。リクエスト 1 件あたりの料金は、どちらも同じです。

計算に使う値は、次の型にまとめています。

<<< @/examples/35-lambda-managed-instances/src/break-even.ts{model}

<<< @/examples/35-lambda-managed-instances/src/break-even.ts{costs}

リクエストの料金は両方に同じだけ乗るので、比べるときには消えます。残るのは、標準の Lambda の GB 秒と、インスタンスの固定費です。

ここで、「同時に処理中のリクエストの数」の平均を考えます。1 か月のあいだ常に 1 件が処理中なら、標準の Lambda は、関数のメモリ × 1 か月の秒数（2,628,000 秒）ぶんの GB 秒を課金します。1 件が 50 ミリ秒でも 2 秒でも、処理中の件数の平均が同じなら、GB 秒は同じです。だから、損益分岐はリクエストの数ではなく、処理中の件数の平均で表せます。

<<< @/examples/35-lambda-managed-instances/src/break-even.ts{break-even}

東京の `arm64` の単価を入れます。標準の Lambda は 1 GB 秒あたり USD 0.0000133334 なので、1 GB の関数で 1 件を 1 か月処理し続けると USD 35.04 です。この章の構成の固定費は、インスタンス 3 台と管理料とエンドポイントで USD 269.77 でした。

| 標準の Lambda の関数のメモリ | 逆転する同時処理数（平均） | 1 リクエスト 100 ミリ秒なら、1 か月のリクエスト数 |
| --- | --- | --- |
| 256 MB | 30.8 件 | 8 億 900 万 |
| 512 MB | 15.4 件 | 4 億 500 万 |
| 1 GB | 7.7 件 | 2 億 200 万 |
| 2 GB | 3.8 件 | 1 億 100 万 |

256 MB で足りている 04章の API は、平均で 30 件以上が常に処理中にならないと、Lambda Managed Instances のほうが安くなりません。1 リクエスト 100 ミリ秒なら、毎秒 300 件あまりが 1 か月続く負荷です。反対に、2 GB を使っている関数なら、平均で 4 件が処理中になったあたりで逆転します。

この表を読むときの注意が 3 つあります。

1 つ目は、**逆転する負荷を、その台数で処理できるとは限らない**ことです。平均 30 件の同時処理を 3 台の `m6g.large`（合わせて 6 vCPU）でさばけるかは、1 リクエストがどれだけ CPU を使うかで決まります。ほとんどの時間を DynamoDB の応答待ちに使う API なら、さばけるかもしれません。JSON の変換や暗号の計算が重い API なら、足りません。足りなければインスタンスが増え、固定費が上がり、逆転する点は右にずれます。この章では計測していないので、表は「3 台で足りるなら」という条件つきです。

2 つ目は、**平均では足りない**ことです。負荷に波があると、山に合わせてインスタンスが増え、谷でもしばらく残ります。標準の Lambda は谷の料金が 0 です。波が大きいほど、標準の Lambda が有利になります。

3 つ目は、**割引で点が動く**ことです。Savings Plans やリザーブドインスタンスは、インスタンスの料金だけを下げます。管理料は、割引前の定価の 15% のままです。関数は `ec2Discount` を受け取るようにしてあり、AWS の料金のページにある例（`us-east-1` の `m7g.xlarge`、3 年の Compute Savings Plan で 72% 引き、合計 USD 160.36）を、テストで再現しています。東京の割引率は調べていないので、この章は割引後の金額を出していません。

<<< @/examples/35-lambda-managed-instances/test/break-even.test.ts

## 制限と、確認できなかったこと

<!-- section: 35.limits -->

クォータは変わります。次の値は 2026-10-13 に Lambda のガイドの「Lambda Managed Instances quotas」で読んだもので、いまの値は同じページか Service Quotas のコンソールで確かめてください。

- キャパシティプロバイダーは、1 つのアカウントに 1,000 まで
- 1 つのキャパシティプロバイダーに載せられる関数のバージョンは 100 まで。引き上げできません
- 1 つのキャパシティプロバイダーの vCPU は 15,000 まで
- キャパシティプロバイダーを操作する API は、読み取りが毎秒 15 回、書き込みが毎秒 1 回まで。引き上げできません
- 実行環境の最小と最大は、0 から 15,000 まで
- 1 つの実行環境が同時に受けるリクエストは、1 vCPU あたり 64 件まで
- 関数のタイムアウトは 900 秒。非同期の呼び出しとイベントソースマッピングでは、5,400 秒まで延ばせます

このほかに、EC2 のクォータがそのまま効きます。アカウントの vCPU の上限、EBS ボリュームの上限、サブネットに残っている IP アドレスの数です。Lambda がインスタンスを起動できない理由が、Lambda ではなく EC2 の側にあることがあります。

標準の Lambda にあって、Lambda Managed Instances には無いものもあります。

- **0 までの自動のスケールイン。** リクエストが無くなっても、実行環境は最小の数までしか減りません
- **リクエストが来たときに増やすスケーリング。** 増えるのはあとからで、間に合わなければ 429 です
- **1 vCPU 未満、2 GB 未満の関数**
- **Firecracker による関数どうしの分離。** 同じキャパシティプロバイダーの関数は、互いに信頼できるものに限ります

次のことは、ドキュメントから確認できませんでした。使う前に、自分で確かめてください。

- SnapStart、provisioned concurrency、function URL、レスポンスストリーミング、Lambda@Edge と組み合わせられるか。それぞれのガイドのページには、Lambda Managed Instances についての記述がありませんでした。「使えない」と書かれていたわけではありません
- イベントソースマッピングは、クォータのページでは SQS、DynamoDB Streams、Kinesis Data Streams、Amazon MSK、セルフマネージドの Apache Kafka が対応していると書かれています。ほかのイベントソースは確認していません
- インスタンスに付く EBS ボリュームの大きさと料金
- 東京以外のリージョンで実際に使えるか。確かめたのは、料金表に単価が載っているリージョンの数（30）までです

## 失敗例と調べ方

<!-- section: 35.failures -->

実機で動かしていないので、ここに書くのは、Lambda のガイドのトラブルシューティングにある症状と、スタックの形から予想できるものです。

**関数のバージョンがいつまでも ACTIVE にならない。** インスタンスの起動に数分かかるのは正常です。それ以上続くなら、キャパシティプロバイダーの状態（`GetCapacityProvider`）、サブネットとセキュリティグループ、EC2 の vCPU のクォータを確かめます。キャパシティプロバイダーのシステムログに、インスタンスの起動に失敗した理由が出ます。

**公開のときに「Internal error occurred during publishing」のような一般的なエラーになる。** ガイドは、最初に `lambda:PassCapacityProvider` の権限を確かめるように書いています。

**関数は動いているのに、ログが出ない。** インスタンスから CloudWatch Logs への経路がありません。`vp run lmi:plan` で、11章のネットワークの設定を確かめます。

**429 が返る。** スロットリングです。CloudWatch には、理由ごとのメトリクス（`ConcurrencyThrottles`、`CPUThrottles`、`MemoryThrottles`、`DiskThrottles`）があります。CPU が理由なら関数の vCPU を増やすか台数の上限を上げ、同時実行の上限が理由なら `PerExecutionEnvironmentMaxConcurrency` を見直します。このスタックでは、API Gateway のステージにも毎秒 10 件のスロットリングがあるので、429 がどちらから来たのかを先に切り分けます。

**別のリクエストのデータが混ざる。** このページの前の[しくみと実装](/ja/chapters/35-lambda-managed-instances/build.md)で扱った不具合です。負荷が上がったときにだけ起きるので、ログのリクエスト ID と、レスポンスのリクエスト ID を突き合わせて探します。

**負荷が下がっても、インスタンスが減らない。** ガイドは、スケールインをゆっくり行うのは仕様だと書いています。

**キャパシティプロバイダーを消せない。** 関数のバージョンが 1 つでも載っていると消せません。先に関数を消します。

## 本番にするなら

<!-- section: 35.production -->

- **ノートを外に置く。** メモリの中のリポジトリは、ワーカースレッドごとに別々です。05章の DynamoDB に替えます。そのとき、インスタンスから DynamoDB への経路（11章のゲートウェイエンドポイント）と、実行ロールの権限が要ります
- **AZ を 3 つにする。** Lambda は既定で 3 台を起動します。11章のネットワークは 2 つの AZ なので、`-c availabilityZones=` で 3 つにしたほうが、既定の振る舞いに合います
- **インスタンスの種類を絞らない。** このスタックは請求を読めるように 1 種類にしていますが、空きが無いと起動できません
- **vCPU の上限を、負荷と予算から決める。** 12 は練習用の値です。上限は請求の天井であり、同時に、処理できる負荷の天井でもあります
- **信頼できない関数を同じキャパシティプロバイダーに載せない。** 分けたいものは、キャパシティプロバイダーを分けます
- **タグを伝える。** `PropagateTags` を設定すると、インスタンス、ボリューム、ネットワークインターフェースにタグが付き、[32章](/ja/chapters/32-limits.md)のコスト配分で内訳を見られます
- **冪等にする。** タイムアウトしたリクエストは、裏で動き続けます。再試行されても結果が変わらない書き込みにします
- **割引を検討する。** 長く動かし続けると決めたなら、インスタンスは Savings Plans やリザーブドインスタンスの対象になります。管理料は下がりません
- **デプロイに AWS CDK CLI を使う。** cdkd は開発とテスト向けのツールです。この章では、関数とキャパシティプロバイダーが Cloud Control API 経由になることも踏まえて、本番の経路を別に確かめてください

## 片付け

<!-- section: 35.cleanup -->

置いてあるだけで 1 日 USD 8.87 かかるので、試し終えたらすぐに消します。

```bash
vp run lmi:infra:destroy
vp run net:infra:destroy
```

順番があります。関数のバージョンが載っているキャパシティプロバイダーは消せないので、スタックの中では関数が先、キャパシティプロバイダーが後に消える必要があります。テンプレートでは関数がキャパシティプロバイダーを参照しているので、依存の逆順に消せばこの順になりますが、cdkd が実際にその順で消すこと、インスタンスの終了を待つことは、確かめていません。

2 行目は、11章のネットワークをほかの章で使っていないときだけ実行します。使い続けるなら、`logs` のエンドポイントを外してデプロイし直します。エンドポイントは、この章のスタックを消しても課金が続きます。

消したあとに確かめることが 3 つあります。

- **インスタンスが残っていないこと。** Lambda が管理するインスタンスは、EC2 のコンソールに既定では出ません。managed resource visibility の設定を切り替えて見るか、数日後の請求の明細で確かめます
- **ロググループ。** スタックが作った 2 つは、スタックと一緒に消えます
- **サービスリンクロール `AWSServiceRoleForLambda`。** アカウントに残ります。料金はかかりません。すべてのキャパシティプロバイダーを消したあとなら、削除できます

## 分散システムとして

<!-- section: 35.distributed -->

状態の持ち主を、順に確かめます。

ノートの持ち主は、この章の構成では、ワーカースレッドごとの `Map` です。持ち主が実行環境の数 × スレッドの数だけいるので、あるノートがどこにあるかは決まりません。保存するデータの持ち主としては、使えません。

リクエストの状態の持ち主は、そのリクエストです。不変条件は「あるリクエストの処理が読む値は、そのリクエストのものである」でした。標準の Lambda は、実行環境が一度に 1 件しか処理しないことで、この条件を実行基盤の側で守っていました。Lambda Managed Instances では、守るのはコードです。型はこの条件を守りません。モジュールスコープの `let` は、どちらの環境でも同じ型で、同じように型検査を通ります。壊れることを示せるのは、2 つのリクエストを決まった順序で重ねるテストだけです。

部分障害も形が変わります。タイムアウトは「呼び出した側が待つのをやめた」ことを意味するだけで、処理が止まったことを意味しません。成功したのか失敗したのかわからない書き込みが、裏で完了することがあります。これは 08章で見た「応答が失われた」場合と同じで、対処も同じく冪等性です。

容量の持ち主も変わります。標準の Lambda では、容量は AWS のもので、アカウントの同時実行数の上限までは、あるものとして扱えました。Lambda Managed Instances では、容量は自分のアカウントのインスタンスで、数に限りがあり、増えるのに時間がかかります。増えるまでの間、超えたぶんは断られます。

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト（8 ファイル、52 件。同時に処理中の 2 つのリクエストでリクエスト ID が入れ替わることと、`AsyncLocalStorage` では入れ替わらないことを、関数の呼び出しと本物のソケットで再現するテスト、2 本のワーカースレッドが別々の `Map` を持つこと、設定の検証、CloudWatch Logs への経路のモデル、料金の入力、損益分岐の計算、スタックのアサーション）。型検査。`lmi:infra:synth`（既定、`-c instanceType=m7g.large`、`-c minExecutionEnvironments=0 -c maxExecutionEnvironments=0`、`-c maxVCpuCount=16`）。`lmi:plan`（既定、`instanceType=m7g.large`、エンドポイントの無い設定、不正な設定）。`dev:lmi` が実行する `node src/dev.ts` を起動して `curl` で `/health` と `POST /notes` を呼び、`SCOPE=module` でも起動しました。確認日は 2026-10-13 です。

**まだ確かめていないこと。** AWS に対しては、何も実行していません。`net:infra:deploy`、`lmi:infra:diff`、`lmi:infra:deploy`、`lmi:smoke`、`lmi:infra:drift`、`lmi:infra:destroy` のどれもです。したがって、次はすべて実機での確認待ちです。cdkd 0.296.28 が、キャパシティプロバイダーと、`CapacityProviderConfig` を持つ関数を、Cloud Control API 経由で作って消せること。`$LATEST.PUBLISHED` が自動で公開されること。API Gateway が修飾子なしの関数を呼べること。CloudWatch Logs のエンドポイントだけのプライベートサブネットで、関数のバージョンが ACTIVE になること。インスタンスが 3 台起動すること、2 つの AZ にどう配置されるか、EBS ボリュームの大きさと料金。Lambda の実行環境での同時実行、ワーカースレッドの数、スケーリング、スロットリング、インスタンスの入れ替え、タイムアウト後の振る舞い。損益分岐の表が前提にしている「3 台で処理できる」こと。

一次情報で確かめられなかったこと。対応していない機能の一覧は見つかりませんでした。SnapStart、provisioned concurrency、function URL のガイドのページには、Lambda Managed Instances についての記述がありませんでした。無料利用枠が Lambda Managed Instances のリクエストに当てはまるかは、料金のページに書かれていませんでした。インスタンスが VPC から届く必要のある宛先は、CloudWatch Logs と X-Ray 以外に確認できていません。いま使えるリージョンの一覧は確認しておらず、料金表に単価が載っているリージョンを数えただけです。1 つの実行環境が同時に受けるリクエストの既定値は、Lambda のガイドでは Node.js で 1 vCPU あたり 64、`aws-cdk-lib` の型のコメントでは 10 となっていて、食い違っています。スタックはこの値を指定せず、本文はガイドの記述を引いています。スケーリングの余裕は、ガイドでは「5 分で 2 倍」、発表の記事では「50% の増加」で、表現が違います。東京の Savings Plans の割引率は調べていません。

cdkd が扱うリソースの種類。インストールされた `@go-to-k/cdkd` 0.296.28 のパッケージでは、`AWS::ApiGatewayV2::Api`、`Integration`、`Route`、`Stage`、`AWS::EC2::SecurityGroup`、`AWS::IAM::Role`、`AWS::IAM::Policy`、`AWS::Lambda::Function`、`AWS::Lambda::Permission`、`AWS::Logs::LogGroup` が専用の実装に登録されています。`AWS::Lambda::CapacityProvider` は登録が無く、Cloud Control API 経由です。`AWS::Lambda::Function` の `CapacityProviderConfig` と `FunctionScalingConfig` は、専用の実装では「未実装」とされていて、これらを持つ関数は cdkd が自動で Cloud Control API 経由に切り替えます。読んだのは npm のパッケージに入っている JavaScript で、GitHub のソースではありません。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 置いてあるだけでかかる料金 | `examples/35-lambda-managed-instances/src/cost.ts`、`src/report.ts`、`scripts/plan.ts`、`test/pricing.test.ts`、`data/pricing/` | `lmi:plan`、`test:unit` |
| 全体像 | `examples/35-lambda-managed-instances/infra/lib/managed-instances-stack.ts`、`infra/bin/app.ts`、`src/config.ts`、`test/config.test.ts` | `lmi:infra:synth`、`test:unit` |
| 1 つの実行環境が、同時に複数のリクエストを処理する | `examples/35-lambda-managed-instances/src/lambda.ts`、`src/app.ts` | `test:unit` |
| モジュールスコープに置いたリクエスト ID | `examples/35-lambda-managed-instances/src/scope.ts`、`src/audit.ts`、`test/scope.test.ts`、`test/harness.ts` | `test:unit` |
| リクエストごとの値の置き場所 | `examples/35-lambda-managed-instances/src/scope.ts`、`test/scope.test.ts`、`test/server.test.ts` | `test:unit`、`dev:lmi` |
| ワーカースレッドごとに別のモジュール | `examples/35-lambda-managed-instances/src/app.ts`、`test/threads.test.ts`、`test/fixtures/thread.ts` | `test:unit` |
| キャパシティプロバイダーとネットワーク | `examples/35-lambda-managed-instances/infra/lib/managed-instances-stack.ts`、`src/network.ts`、`test/network.test.ts`、`examples/11-network/infra/lib/import-network.ts` | `lmi:plan`、`lmi:infra:synth`、`test:unit` |
| 関数をキャパシティプロバイダーに載せる、cdkd が作れるリソースか | `examples/35-lambda-managed-instances/infra/lib/managed-instances-stack.ts`、`infra/test/managed-instances-stack.test.ts` | `lmi:infra:synth`、`test:unit` |
| 手元で動かす | `examples/35-lambda-managed-instances/src/dev.ts`、`.env.example`、`scripts/plan.ts` | `dev:lmi`、`test:unit`、`lmi:plan`、`lmi:infra:synth` |
| デプロイと動作確認 | `examples/35-lambda-managed-instances/scripts/smoke.ts`、`tools/src/infra/` | `net:infra:deploy`、`lmi:infra:diff`、`lmi:infra:deploy`、`lmi:smoke`、`lmi:infra:drift` |
| 損益分岐の計算 | `examples/35-lambda-managed-instances/src/break-even.ts`、`src/prices.ts`、`src/report.ts`、`test/break-even.test.ts` | `lmi:plan`、`test:unit` |
| 片付け | `tools/src/infra/` | `lmi:infra:destroy`、`net:infra:destroy` |

**一次情報**（確認日はすべて 2026-10-13）

- Lambda Managed Instances: [概要](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances.html)、[Core concepts](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances-core-concepts.html)、[Capacity providers](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances-capacity-providers.html)、[Scaling](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances-scaling.html)、[Runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances-runtimes.html)、[Node.js runtime](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances-nodejs-runtime.html)、[Execution environment](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances-execution-environment.html)、[$LATEST.PUBLISHED](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances-version-publishing.html)、[Networking](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances-networking.html)、[Security and permissions](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances-security.html)、[Operator role](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances-operator-role.html)、[Quotas](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances-quotas.html)、[Tag propagation](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances-tag-propagation.html)、[Getting started](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances-getting-started.html)、[Troubleshooting](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances-troubleshooting.html)、[Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)
- 発表と料金: [Introducing AWS Lambda Managed Instances](https://aws.amazon.com/blogs/aws/introducing-aws-lambda-managed-instances-serverless-simplicity-with-ec2-flexibility/)（2025-11-30）、[AWS Lambda pricing](https://aws.amazon.com/lambda/pricing/)
- AWS Price List bulk API: [Lambda](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/ap-northeast-1/index.json)（管理料とリクエスト。リージョンごとのファイルを 36 個読み、Lambda Managed Instances の単価があるものを数えました）、[EC2](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/ap-northeast-1/index.json)（`m6g.large` と `m7g.large`。約 446 MB）。標準の Lambda、Fargate、インターフェースエンドポイントの単価は、04章、12章、11章で読んだものを使い、この章では読み直していません
- API と CloudFormation: [CreateCapacityProvider](https://docs.aws.amazon.com/lambda/latest/api/API_CreateCapacityProvider.html)、[CreateFunction](https://docs.aws.amazon.com/lambda/latest/api/API_CreateFunction.html)、[AWS::Lambda::CapacityProvider](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-lambda-capacityprovider.html)、[LambdaManagedInstancesCapacityProviderConfig](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-lambda-function-lambdamanagedinstancescapacityproviderconfig.html)
- 固定した版のパッケージ: [aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0)（`aws-lambda/lib/capacity-provider.d.ts` と、同じ場所の JavaScript）、[@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)（`dist/` の JavaScript）
- Node.js: [Asynchronous context tracking](https://nodejs.org/docs/latest-v24.x/api/async_context.html)
- 比較: [How Workers works](https://developers.cloudflare.com/workers/reference/how-workers-works/)（Cloudflare）、[Fluid compute](https://vercel.com/docs/fluid-compute)、[Functions usage and pricing](https://vercel.com/docs/functions/usage-and-pricing)（Vercel）

:::
