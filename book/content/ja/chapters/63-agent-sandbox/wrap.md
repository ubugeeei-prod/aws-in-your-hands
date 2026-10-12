---
title: "63 Agent Sandbox: 費用、注意点、片付け"
---

# 63 Agent Sandbox: 費用、注意点、片付け

## 料金

<!-- section: 63.cost -->

金額は USD、東京リージョン、従量課金、税別で、1 か月を 730 時間として計算しています。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

料金は 3 つに分かれます。スタックを置いておく料金、タスクが動いた料金、タスクが外へ出るための経路の料金です。

置いておく料金は、既定の構成で次のとおりです。

| 対象 | 数量 | 単価 | 月額 |
| --- | --- | --- | --- |
| リーパーの呼び出し | 730 時間 × 60 回 | 0.0000002／回 | 0.01 |
| リーパーの実行時間 | 43,800 回 × 0.2 秒 × 0.25 GB（仮定） | 0.0000133334／GB 秒 | 0.03 |
| Scheduler の呼び出し | 43,800 回 | Price List の最初の 1400 万回は 0 | 0.00 |
| イメージの保存 | 0.5 GB（仮定） | 0.10／GB 月 | 0.05 |
| 小計 | | | **0.09** |

Lambda の無料枠を引くと、残るのはイメージの保存の USD 0.05 です。リーパーの実行時間とイメージの大きさは仮定です。関数もイメージも実物を動かしていないので、計った値ではありません。GitHub App の鍵を置くシークレットは、スタックの外にあり、1 か月に USD 0.40 かかります。

タスクが動いた料金は、Fargate とモデルに分かれます。

| 対象 | 数量 | 単価 | 金額 |
| --- | --- | --- | --- |
| Fargate の vCPU（arm64） | 1 vCPU × 0.5 時間 | 0.04045／vCPU 時 | 0.02 |
| Fargate のメモリ（arm64） | 4 GB × 0.5 時間 | 0.00442／GB 時 | 0.01 |
| モデルの入力 | 40 万トークン（仮定） | 1.10／100 万 | 0.44 |
| キャッシュの読み出し | 200 万トークン（仮定） | 0.11／100 万 | 0.22 |
| キャッシュの書き込み | 30 万トークン（仮定） | 1.375／100 万 | 0.41 |
| モデルの出力 | 6 万トークン（仮定） | 5.50／100 万 | 0.33 |
| 30 分のタスク 1 つ | | | **1.43** |

Fargate のぶんは USD 0.03 で、上限の 50 分まで動いても USD 0.05 です。残りはモデルの料金で、表のトークン数はすべて仮定です。エージェントを一度も動かしていないので、実際の仕事がどれだけのトークンを使うかは分かっていません。この表から読み取れるのは、タスクの料金のほとんどがモデルの料金だということと、単価だけです。1 日の上限の USD 20 は、この仮定のタスクでおよそ 14 個ぶんです。

経路の料金は、[出口の許可リスト](/ja/chapters/63-agent-sandbox/more.md)の表のとおりです。NAT Gateway で 1 か月 USD 48.91、インターフェースエンドポイント 4 つで USD 81.76、Network Firewall で USD 292.00。どれも、タスクが 1 つも動かなくてもかかります。この章のスタックのフラグで作るのは、Bedrock のランタイムのエンドポイント（USD 20.44）だけです。残りは 11章のスタックの料金です。

したがって、この構成の料金を決めるのは、どの経路を置くかです。たまに試すだけなら、試す日にだけ NAT Gateway を置き、その日のうちに消すのが安く済みます。

## つまずきやすいところ

<!-- section: 63.pitfalls -->

この節は、実物で確かめたものではありません。設計とドキュメントから、起きると予想できることを挙げます。

**タスクが起動しない。** プライベートサブネットから ECR に届かないと、イメージを取得できません。11章の VPC が既定の構成（経路なし）のままだと、こうなります。タスクの `stoppedReason` に理由が出ます。

**Claude Code が始まらずに終わる。** サンドボックスが起動できないと、`failIfUnavailable` の設定によって、Claude Code は始まりません。Fargate の中で bubblewrap が動くかどうかは確かめていないので、最初に疑うのはここです。動かないと分かった場合、`failIfUnavailable` を外して黙って進めるのは、内側の壁を捨てることになります。その場合は、外側の壁（Network Firewall かプロキシ）を先に置いてください。

**パッケージのインストールが失敗する。** 許可リストにないホストから何かを取得するパッケージは失敗します。必要なホストは、エージェントのログに出る失敗から 1 つずつ拾って、理由を添えて足します。足す前に、そのホストに何を送れるかを考えてください。

**モデルを呼べない。** タスクロールが許しているのは、固定した推論プロファイル 1 つです。`ANTHROPIC_MODEL` と `-c model=...` が食い違うと、呼び出しは拒否されます。アカウントで Anthropic のモデルの使用目的のフォームを出していない場合も、呼べません。

**プッシュが拒否される。** トークンは作ってから 1 時間で切れます。ランチャーが作った時点から数えるので、タスクの起動に時間がかかると、そのぶん残りが減ります。上限を 50 分にしてあるのはそのためですが、起動に 10 分かかれば足りなくなります。ルールセットで作業用のブランチの作成まで禁じている場合も、拒否されます。

**プルリクエストが開けない。** プッシュのあとでプルリクエストの作成に失敗すると、タスクは失敗として終わり、ブランチだけが残ります。GitHub App に Pull requests の権限を付け忘れた場合に、トークンの発行の時点で失敗するのか、ここで失敗するのかは、確かめていません。ブランチはプッシュされているので、人がプルリクエストを開けます。

**依頼が `daily_budget_spent` で断られる。** 見積もりは、アカウント全体の Bedrock のトークン数から出しています。同じアカウントで別の用途に Bedrock を使っていると、そのぶんも数えます。サンドボックスのアカウントを分けていれば起きません。

## 本番にするなら

<!-- section: 63.production -->

練習用の設定のままにしてあるところを、変えるべき順に挙げます。

**出口を外側で絞る。** NAT Gateway だけの構成は、宛先を外側で絞っていません。続けて使うなら、Network Firewall かプロキシを置きます。どちらを選んでも、ルールの元は `src/egress.ts` の一覧です。

**トークンをエージェントに渡さない。** Claude Code のドキュメントが勧める形は、エージェントの境界の外にプロキシを置き、Git の認証情報をプロキシが足すものです。こうすれば、エージェントはトークンを読めません。この章の構成は、読まれても被害が小さいトークンを渡す、という一段弱い設計です。

**アカウントを分け、SCP で囲う。** サンドボックス専用のアカウントを作り、Organizations の SCP で、このアカウントでは使わないサービスを禁じます（[33章](/ja/chapters/33-production-readiness.md)）。IAM のロールの設定を誰かが広げても、SCP の外には出られません。

**記録を、消せない場所に送る。** ログループは、スタックを消すと一緒に消える設定（`RemovalPolicy.DESTROY`）で、保持は 1 か月です。本番では残す設定にし、サンドボックスのアカウントの管理者にも消せない場所、たとえば別のアカウントのバケットに送ります。CloudTrail も、90 日のイベント履歴に頼らず、証跡を作って別のアカウントに置きます（[21章](/ja/chapters/21-security.md)）。

**リーパーにアラームを付ける。** リーパーが止まると、外側の時間の上限が無くなります。33章の点検をこのスタックにかけると、関数にアラームが無いことを 2 件、スタックと一緒に消えるロググループを 3 件、ワイルドカードのリソースを 5 件、指摘します。テストはこの結果を固定しています。本番では、[19章](/ja/chapters/19-observability.md)のアラームをリーパーのエラーに付け、人に届くようにします。

**イメージを更新し続ける。** Claude Code も、土台のイメージも、Git も更新されます。版を固定しているので、自分で上げない限り古いままです。上げるたびに、設定のキーとフラグをドキュメントで読み直してください。この章に書いたフラグの意味は、2026-10-13 時点のドキュメントのものです。

**依頼する人を絞る。** ランチャーを呼べるのは、`lambda:InvokeFunction` を持つ人です。依頼の文章は、そのままエージェントへの指示になります。誰が呼べるかは、エージェントに何をさせられるかと同じ意味です。

## 分散システムとして見る

<!-- section: 63.distributed -->

状態を持っているのは、3 つです。ECS がタスクの一覧を持ち、GitHub がブランチとプルリクエストを持ち、CloudWatch がトークン数を持ちます。ランチャーとリーパーは状態を持たず、毎回 ECS に尋ねます。

**重複した依頼。** 同じ依頼が 2 回届くことは、起きるものとして扱います。1 回目の応答が失われて、呼んだ側がやり直す場合です。防ぐ仕組みは 2 段で、動いているタスクの `startedBy` を見ることと、RunTask の `clientToken` です。1 段目は、ECS の一覧がまだ新しいタスクを返さない瞬間には効きません。ECS の API は結果整合で、直前の操作の結果がすぐには見えないことがあると API リファレンスに書かれています。2 段目が、その隙間を受け止めます。テストは両方の順序を再現しています。

**同時実行数の上限は、厳密ではありません。** ランチャーは「いま動いている数」を読んでから起動します。2 つの依頼が同時に来れば、どちらも 1 を読んで、合わせて 3 つになることがあります。この上限は、料金の歯止めであって、正しさの条件ではないので、そのままにしてあります。厳密にしたいなら、[05章](/ja/chapters/05-dynamodb.md)の条件付き書き込みで枠を取ってから起動します。

**途中で止まったタスク。** タスクは、どの手順の途中でも止まりえます。リーパーに止められる、Fargate に止められる（41章）、エージェントが失敗する。止まった場所ごとに、外に残るものが違います。クローンのあとなら何も残りません。プッシュのあとでプルリクエストの前なら、ブランチだけが残ります。作業用のブランチの名前は依頼の ID から決まるので、残ったブランチがどの依頼のものかは分かります。同じ ID でやり直すと、ECS が `clientToken` を覚えているあいだは、止まったタスクの ARN と一緒に「起動済み」が返ります。覚えている長さは確かめていません。やり直すときは、新しい ID で依頼してください。ブランチの名前も変わるので、前の実行の残りとぶつかりません。

**見積もりの遅れ。** 1 日の予算は、遅れて届く数字で判断します。予算を超えてから止まるまでに使われるぶんは、止められません。上限は「この金額で必ず止まる」ではなく、「この金額を超えたことに気づいたら止める」です。

**リーパーが止まった場合。** リーパーは 1 分ごとに独立して動くので、1 回の失敗は次の回が補います。関数そのものが壊れた場合は、外側の時間の上限が無くなります。残るのは、内側の上限と、トークンの 1 時間の寿命です。トークンが切れたあとのタスクは、モデルは呼べますが、プッシュはできません。

## 片付け

<!-- section: 63.cleanup -->

動いているタスクが無いことを確かめてから、スタックを消します。

```bash
aws ecs list-tasks --cluster <ClusterName> --region ap-northeast-1
vp run sandbox:infra:destroy
```

リポジトリは、中のイメージごと消える設定です。ロググループも一緒に消えます。**記録を残したいなら、消す前に書き出してください。**

スタックの外に残るものが 4 つあります。

- **11章の VPC の経路。** NAT Gateway やエンドポイントを置いたなら、11章のスタックを既定の構成でデプロイし直すか、消します。時間課金が続くのはここです
- **GitHub App の鍵のシークレット。** スタックは作っていないので、消しません。自分で消さない限り、1 か月に USD 0.40 がかかり続けます
- **GitHub の側。** App、インストール、ルールセット、エージェントが作ったブランチとプルリクエストは、GitHub に残ります。使わないなら、App の秘密鍵を GitHub の画面で削除してください
- **CloudTrail のイベント履歴。** モデルの呼び出しとタスクの起動の記録は、90 日残ります。料金はかかりません

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト 103 件、12 ファイル（ランチャーの判断と重複した依頼、許可リストの評価と 2 つの書き出し、上限とリーパー、GitHub App の JWT の署名とトークンの検査、エージェントのコマンドと設定と環境変数、タスクの手順、ポリシーの評価器、コマンドの組み立て、料金、スタックのアサーション）。不変条件を壊す変更を 3 つ入れて（タスクロールに `sts:AssumeRole` と `s3:Get*` を足す、エージェントの環境変数に Git のトークンを渡す、プッシュ先を `origin` のベースのブランチにする）、テストが 8 件失敗することを見てから戻しました。型検査。`sandbox:infra:synth`（タグなし、`-c imageTag=a1 -c repositories=acme/notes`、それに `-c modelEndpoint=true -c exec=true` を足した構成。`-c exec=yes` と `-c model=jp.amazon.nova-2-lite-v1:0` が拒否されることも）。`sandbox:plan`、`sandbox:policy`（本文の出力は、このコマンドの実際の出力から抜き出したものです）、`sandbox:bundle`。`scripts/ops.ts` の 5 つの操作の `--dry-run`。AWS CLI のフラグは、Nix の shell の AWS CLI のヘルプで確かめました。

**まだ確かめていないこと。** AWS に対しては、何も実行していません。エージェントは一度も起動しておらず、モデルも GitHub の API も呼んでいません。Docker のデーモンが無かったので、イメージも一度もビルドしていません（`Dockerfile` は未検証です）。したがって、次のことは実物で確かめていません。cdkd 0.296.28 がこのスタックを作って消せること。タスクが起動すること。読み取り専用のルートと 3 つのボリュームで Claude Code が動くこと。Fargate の中で bubblewrap のサンドボックスが起動できること。タスクロールの 2 つのアクションだけで Claude Code が Bedrock を呼べること。`--bare` の実行が管理者の設定ファイルを読むこと。Git の credential helper の指定が期待どおりに働くこと。GitHub が返すトークンの形と、ルールセットの効き方。リーパーが実際のタスクを止めること。CloudWatch のトークンのメトリクスと請求額の関係。ECS Exec のセッション。「つまずきやすいところ」の症状。

一次情報で確かめられなかったこと。Fargate のタスクが Firecracker の上で動いているかどうか（この章で読んだ ECS のページは、技術の名前を挙げていません）。実行ロールの認証情報が、コンテナの中から取れないこと（ドキュメントは、タスクロールの認証情報がコンテナに渡ることと、実行ロールをコンテナエージェントと Fargate が使うことを書いていますが、取れないとは、読んだページには書かれていません）。`InputTokenCount` がキャッシュのトークンを含むかどうかと、推論プロファイルを呼んだときの `ModelId` の値。Bedrock のメトリクスが届くまでの遅れ。CloudTrail の `RunTask` のイベントに、上書きした環境変数の値が残るかどうか。GitHub App のトークンで付けた承認が、ルールセットの承認の数に入るかどうか。`--max-budget-usd` の見積もりが、Bedrock の単価で計算されるかどうか。Git の空の `credential.helper` が、URL を指定した helper の一覧も空にするかどうか（そのため、両方に空の値を渡しています）。ECS Exec で、タスクロールにログの権限が無いときのセッションの記録。Cloudflare と Vercel のサンドボックスの料金と上限（概要のページを読んだだけです）。

cdkd が扱うリソースの種類。インストールした `@go-to-k/cdkd` 0.296.28 の `dist/` を読んで確かめました。`AWS::ECR::Repository`、`AWS::ECS::Cluster`、`AWS::ECS::TaskDefinition`、`AWS::EC2::SecurityGroup`、`AWS::EC2::SecurityGroupIngress`、`AWS::IAM::Role`、`AWS::IAM::Policy`、`AWS::Lambda::Function`、`AWS::Logs::LogGroup`、`AWS::Scheduler::Schedule` は、専用の実装が登録されています。タスク定義の実装の `handledProperties` には `Volumes` があります。`AWS::EC2::VPCEndpoint` には専用の実装が無く、`-c modelEndpoint=true` のときは Cloud Control API 経由になるはずです。11章のエンドポイントと同じ扱いです。テストは、既定の構成と `exec=true` の構成が、専用の実装のある種類とプロパティだけでできていることを固定しています。

aws-cdk-lib 2.273.0 について、synth して観察したこと。`ecs.LogDrivers.awsLogs` と `fromEcrRepository` は、実行ロールに、ロググループへの `logs:CreateLogStream` と `logs:PutLogEvents`、リポジトリからの取得の 3 つのアクション、`ecr:GetAuthorizationToken`（リソースは `*`）を付ける。タスクロールには何も足さない。

**コードの場所。**

| 節 | ファイル | `vp run` のタスク |
| --- | --- | --- |
| 全体像 | `examples/63-agent-sandbox/infra/lib/agent-sandbox-stack.ts`、`src/config.ts` | `sandbox:infra:synth`、`sandbox:plan` |
| ランチャーの判断 | `examples/63-agent-sandbox/src/job.ts`、`src/launcher.ts`、`src/ports.ts`、`test/job.test.ts`、`test/launcher.test.ts` | `sandbox:plan`、`test:unit` |
| リポジトリの受け渡し | `examples/63-agent-sandbox/src/github.ts`、`src/run.ts`、`test/github.test.ts`、`test/run.test.ts` | `test:unit` |
| Claude Code を起動する | `examples/63-agent-sandbox/src/agent.ts`、`src/entry.ts`、`scripts/bundle.ts`、`Dockerfile`、`test/agent.test.ts` | `sandbox:bundle`、`sandbox:plan`、`test:unit` |
| エージェントのロール | `examples/63-agent-sandbox/src/policy.ts`、`scripts/policy.ts`、`test/policy.test.ts`、`infra/test/agent-sandbox-stack.test.ts` | `sandbox:policy`、`test:unit` |
| 出口の許可リスト | `examples/63-agent-sandbox/src/egress.ts`、`test/egress.test.ts`、`examples/11-network/src/config.ts` | `sandbox:plan`、`net:plan`、`test:unit` |
| 時間と料金の上限 | `examples/63-agent-sandbox/src/limits.ts`、`src/reaper.ts`、`src/aws.ts`、`test/limits.test.ts`、`test/reaper.test.ts` | `test:unit` |
| 記録、人が中に入る手段 | `examples/63-agent-sandbox/infra/lib/agent-sandbox-stack.ts`、`src/commands.ts`、`scripts/ops.ts` | `sandbox:logs`、`sandbox:exec` |
| 手元で確かめる | `examples/63-agent-sandbox/test/`、`scripts/plan.ts`、`scripts/policy.ts` | `test:unit`、`sandbox:plan`、`sandbox:policy`、`sandbox:infra:synth` |
| デプロイする | `examples/63-agent-sandbox/infra/bin/app.ts`、`src/commands.ts`、`scripts/ops.ts`、`tools/src/infra/` | `sandbox:infra:deploy`、`sandbox:image:build`、`sandbox:image:push`、`sandbox:launch`、`sandbox:infra:drift` |
| 料金 | `examples/63-agent-sandbox/test/pricing.test.ts`、`data/pricing/` | `test:unit` |
| 片付け | `tools/src/infra/` | `sandbox:infra:destroy` |

**一次情報**（確認日はすべて 2026-10-13。ほかの章で確認した出典は、それぞれの章に確認日があります）

- Claude Code の安全な運用: [Securely deploying AI agents](https://code.claude.com/docs/en/agent-sdk/secure-deployment)、[Choose a sandbox environment](https://code.claude.com/docs/en/sandbox-environments)、[Configure the sandboxed Bash tool](https://code.claude.com/docs/en/sandboxing)、[Configure permissions](https://code.claude.com/docs/en/permissions)、[Permission modes](https://code.claude.com/docs/en/permission-modes)
- Claude Code の実行と設定: [Run Claude Code programmatically](https://code.claude.com/docs/en/headless)、[CLI reference](https://code.claude.com/docs/en/cli-reference)、[Settings reference](https://code.claude.com/docs/en/settings-reference)、[Managed settings](https://code.claude.com/docs/en/managed-settings)、[Advanced setup](https://code.claude.com/docs/en/setup)、[Enterprise network configuration](https://code.claude.com/docs/en/network-config)、[Track cost and usage](https://code.claude.com/docs/en/agent-sdk/cost-tracking)、[Monitoring](https://code.claude.com/docs/en/monitoring-usage)、npm レジストリの [@anthropic-ai/claude-code](https://registry.npmjs.org/@anthropic-ai/claude-code)（`stable` は 2.1.287）
- Claude Code と Bedrock: [Claude Code on Amazon Bedrock](https://code.claude.com/docs/en/amazon-bedrock)
- Claude Code のほかの実行環境: [Use Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web)、[Self-hosted environments](https://code.claude.com/docs/en/self-hosted-environments)、[Hosting the Agent SDK](https://code.claude.com/docs/en/agent-sdk/hosting)
- ECS と Fargate: [RunTask](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_RunTask.html)、[ContainerOverride](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_ContainerOverride.html)、[StopTask](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_StopTask.html)、[Best practices for IAM roles in Amazon ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/security-iam-roles.html)、[Fargate security considerations](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-security-considerations.html)、[ECS Exec](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-exec.html)、[Use bind mounts with Amazon ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/bind-mounts.html)
- Bedrock: [interface VPC endpoints](https://docs.aws.amazon.com/bedrock/latest/userguide/vpc-interface-endpoints.html)、[CloudWatch metrics](https://docs.aws.amazon.com/bedrock/latest/userguide/monitoring-runtime-metrics.html)、[CloudTrail](https://docs.aws.amazon.com/bedrock/latest/userguide/logging-using-cloudtrail.html)、[AgentCore Runtime のセッション](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-sessions.html)
- 出口: [Stateful domain list rule groups](https://docs.aws.amazon.com/network-firewall/latest/developerguide/stateful-rule-groups-domain-names.html)、[RulesSourceList](https://docs.aws.amazon.com/network-firewall/latest/APIReference/API_RulesSourceList.html)、[AWS Network Firewall Pricing](https://aws.amazon.com/network-firewall/pricing/)、[How Resolver DNS Firewall works](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resolver-dns-firewall-overview.html)
- IAM のアクションとリソースの種類: AWS Service Reference の [ecs](https://servicereference.us-east-1.amazonaws.com/v1/ecs/ecs.json)、[cloudwatch](https://servicereference.us-east-1.amazonaws.com/v1/cloudwatch/cloudwatch.json)、[bedrock](https://servicereference.us-east-1.amazonaws.com/v1/bedrock/bedrock.json)、[secretsmanager](https://servicereference.us-east-1.amazonaws.com/v1/secretsmanager/secretsmanager.json)
- GitHub: [Create an installation access token for an app](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app)、[Generating a JSON Web Token (JWT) for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app)、[Authenticating as a GitHub App installation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation)、[Create a pull request](https://docs.github.com/en/rest/pulls/pulls#create-a-pull-request)、[Available rules for rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)
- Git: [gitcredentials](https://git-scm.com/docs/gitcredentials)、[git-config](https://git-scm.com/docs/git-config)
- 料金: AWS Price List bulk API の [Network Firewall](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSNetworkFirewall/current/ap-northeast-1/index.json)。Fargate、Lambda、ECR、NAT Gateway、エンドポイント、パブリック IPv4 アドレス、EC2、Bedrock、Secrets Manager の単価は、それぞれの章で取得したもの
- Cloudflare と Vercel: [Sandboxes on Cloudflare](https://developers.cloudflare.com/sandbox/)、[Vercel Sandbox](https://vercel.com/docs/sandbox)
- cdkd: インストールした [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28) の `dist/`
- [aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0)（synth を実行して観察）

:::
