---
title: "50 AgentCore: 費用、注意点、片付け"
---

# 50 AgentCore: 費用、注意点、片付け

料金の数え方、うまくいかないときに見る場所、本番で足すもの、片付けをまとめます。章末に検証メモがあります。

## 料金

<!-- section: 50.cost -->

AgentCore の料金ページは、前払いも最低料金も無い従量課金と説明しています。この章のスタックは、セッションが無ければ Runtime の料金がかかりません。DynamoDB のテーブルはオンデマンドで、ユーザープールは利用者がいなければ料金がかかりません。残るのは、S3 に置かれた ZIP（中身は 1.8 MB ほどの `app.js`）と CloudWatch Logs の保存分です。

Runtime の単価は、AWS Price List の東京の値（2026-10-06 公開、2026-10-13 に確認）で、既定の V1 が次のとおりです。

- CPU: 1 vCPU 時間あたり USD 0.0895
- メモリ: 1 GB 時間あたり USD 0.00945

課金は秒単位で、メモリには 128 MB の下限があります。数え方に、Lambda と違う点が 2 つあります。CPU は、モデルやツールの応答を待っているあいだは課金されません。メモリは、セッションが終わるまで、アイドルのあいだも課金されます。エージェントの時間のほとんどはモデルを待つ時間なので、費用を決めるのは「セッションがどれだけ長く生きているか」です。

1 か月に 1,000 セッション、1 セッションで CPU を合計 18 秒使い、メモリが平均 0.6 GB だとします。どちらも仮定で、測った値ではありません。4 分の会話のあと、この章の設定どおりアイドル 5 分で終わる場合は、次のとおりです。

- CPU: 1,000 × 18 秒 ÷ 3,600 = 5 vCPU 時間 → USD 0.4475
- メモリ: 1,000 × 9 分 × 0.6 GB ÷ 60 = 90 GB 時間 → USD 0.8505
- 合計: 1 か月で USD 1.30

アイドルで終わるまでを既定の 15 分のままにすると、同じ会話でセッションは 19 分生き、メモリが 190 GB 時間で USD 1.7955、合計は USD 2.24 になります。会話の中身は同じで、違うのは待っている時間だけです。

どちらにも、モデルの料金は入っていません。36章で見たとおり、1 問あたりの費用の大半はモデルのトークンで、この章では、覚えているやりとりを毎回送り直すぶん、会話が進むほど入力のトークンが増えます。上限は `MAX_REMEMBERED_TURNS` と `MAX_REMEMBERED_ANSWER_CHARS` で決まります。

プラットフォームバージョン V2 は単価が別で、東京では CPU が 1 vCPU 時間あたり USD 0.1276、メモリが 1 GB 時間あたり USD 0.0169 です。料金ページによると、V2 ではアイドルのメモリが 120 秒で回収されます。単価は高く、アイドルは安くなる組み合わせなので、どちらが安いかは会話の形で変わります。この章では計算していません。

AgentCore Memory の短期記憶の東京の単価は、確認できていません。料金ページは、2026 年 10 月 6 日から、取り込みが 1 GB あたり USD 1.00、取り出しが 1 GB あたり USD 0.20、保存が 1 GB・月あたり USD 0.10 で、1 イベントは最低 12 KB として数えると書いています。同じ日に読んだ東京の Price List には、GB あたりの単価が無く、イベントあたり USD 0.00 の項目だけがありました。そのため `data/pricing/` には入れていません。料金ページの単価を当てはめるなら、1,000 セッションで 2,000 イベントは 24 MB で、取り込みは USD 0.03 に届きません。

Gateway と、外部のサービスのトークンを預かる Identity の機能は使っていないので、料金はかかりません。Runtime を通して使う Identity には追加の料金が無いと、料金ページにあります。

## 失敗例と調べ方

<!-- section: 50.failures -->

ここに書く応答は、手元のサーバーで見たものと、ドキュメントの表にあるものです。デプロイした Runtime では確かめていません。

**呼び出しが 401 で、`WWW-Authenticate` ヘッダーが付いている。** Runtime の手前で断られています。トークンが無いか、期限切れか、発行者やクライアントがオーソライザーの設定と合っていません。トークンの中身を見て、`iss` と `client_id` をスタックの出力と比べます。ID トークンではなくアクセストークンを送っているかも確かめます。

**呼び出しが 424（`RuntimeClientError`）になる。** エージェントが 4xx か 5xx を返しています。エージェントのログ（`/aws/bedrock-agentcore/runtimes/<Runtime の ID>-DEFAULT`）で、同じ時刻の行を探します。`session owner mismatch` なら、セッション ID が `newSessionId` の決まりで作られていないか、ほかの利用者のものです。行が無く 401 を返しているなら、エージェントにトークンが届いていません。ヘッダーの許可リストに `Authorization` があるか、環境変数の `JWT_ISSUER` と `JWT_CLIENT_ID` がオーソライザーと同じかを見ます。

**呼び出しが 409（`RetryableConflictException`）になる。** セッションの microVM を用意しているか片付けている最中に、同じセッションへの別の操作が届いています。短い間隔で再試行します。

**402 や 429 になる。** 402 はクォータ（同時に動かせるセッションの数など）、429 はスロットリングです。上限は[最初のページ](/ja/chapters/50-agentcore.md)に挙げました。

**答えは返るのに、続きの質問が前の話を踏まえていない。** ログの `invocation` の行で `remembered` を見ます。`false` で、近くに `turn not remembered` があれば、Memory への書き込みが断られています。実行ロールの権限か、スロットリング（1 つの actor の 1 つのセッションにつき、会話のイベントは毎秒 5 件まで）です。`remembered` が `true` なのに忘れているなら、Memory から読むところを疑います。

**しばらくして呼ぶと、最初の応答が遅い。** アイドルで microVM が終わり、次の呼び出しで作り直されています。設定どおりの動きです。

**モデルの側の失敗。** スロットリング、モデルへのアクセスが無い、途中で切れる、といった失敗の見え方は 36章と同じで、`error` イベントの `code` に出ます。

## 本番にするなら

<!-- section: 50.production -->

- **利用者ごとの予算。** 36章には、利用者ごとに 1 日の費用を止める台帳がありました。この章の例には入れていません。ループの上限（1 問あたりの往復とトークン）は効いていますが、質問の回数には上限がありません。サインインした人なら何度でも呼べるので、36章の台帳を同じ形で足します
- **ガードレール。** 36章のガードレールも、この例では付けていません。`RequestOptions` に ID と版を渡せば、同じループがそのまま使います
- **外へ出る通信。** `networkMode` が `PUBLIC` のエージェントは、インターネットに出られます。この章のツールは読むだけですが、外に出る口があれば、ノートに書かれた指示に従ったモデルが中身を持ち出す道になりえます。VPC の中に置いて出口を絞る方法は [63章](/ja/chapters/63-agent-sandbox.md)が扱います
- **利用者の ID をヘッダーで渡す道を閉じる。** `bedrock-agentcore:InvokeAgentRuntimeForUser` を、呼び出す側のポリシーで明示的に拒否しておくよう、手引きは勧めています
- **本物のクライアント。** この章のクライアントは管理用の API でしかサインインできません。利用者が自分でサインインするアプリでは、06章のクライアントと発行者をオーソライザーに書きます
- **バージョンとエンドポイント。** Runtime は更新のたびに新しいバージョンを作り、`DEFAULT` エンドポイントはいつも最新を指します。本番の入口は、バージョンを固定した自分のエンドポイントにして、切り替えを [31章](/ja/chapters/31-progressive-delivery.md)のように段階的に行います
- **トレース。** スパンを見るには、CloudWatch の Transaction Search を有効にし、コードを ADOT で計装します。Node.js の ADOT は CommonJS の出力でしか動かないと、ドキュメントにあります。この章のバンドルを CommonJS にしてあるのは、その道を残すためでもあります
- **記憶の保持と削除。** イベントは 30 日で消える設定です。利用者が削除を求めたときに、その actor のイベントを消す手順（`DeleteEvent`）を用意します。暗号化の鍵を自分で持つなら、Memory に KMS の鍵を指定します
- **セッション ID の決まりをクライアントにも配る。** `newSessionId` と同じ計算を、ブラウザのコードなら Web Crypto で行います

## 片付け

<!-- section: 50.cleanup -->

```bash
vp run agentcore:infra:destroy
```

スタックの外に残るものがあります。

- Runtime が作ったロググループ（`/aws/bedrock-agentcore/runtimes/` で始まるもの）。スタックのリソースではないので、消えません。コンソールか `aws logs delete-log-group` で消します
- サービスリンクロール `AWSServiceRoleForBedrockAgentCoreRuntimeIdentity`。料金はかかりません
- cdkd がアセットを置いたバケットの中の ZIP

ユーザープールとテーブルは、練習用として、スタックと一緒に消える設定（`RemovalPolicy.DESTROY`）にしてあります。本番では残す設定に変えます。Memory を消したときに中のイベントがすぐ消えるかどうかは、確かめていません。

進行中のセッションがあるうちに Runtime を消したときの動きも、確かめていません。消すまえに 5 分待てば、この章の設定ではセッションは残っていないはずです。

## 分散システムとして

<!-- section: 50.distributed -->

状態の持ち主を並べます。ノートの持ち主は DynamoDB で、エージェントは読むだけです。会話の記録の持ち主は AgentCore Memory で、プロセスの中の状態はその写しです。利用者がだれかを知っているのは Cognito のトークンで、セッション ID はそこから計算できる札にすぎません。

不変条件は 2 つです。

1 つ目は、利用者の代わりに動くエージェントは、その利用者のノートと会話にしか届かないことです。壊そうとするテストは `test/boundary.test.ts` にあります。ボディで持ち主を名乗る、同じプロセスで別の利用者が続けて呼ぶ、ノートに書かれた指示にモデルが従う、ほかの利用者のセッション ID を使う、microVM が入れ替わった直後に使う、という順に試し、どれでも Bob のノートの中身がモデルへのリクエストにも応答にも現れないことを確かめています。

2 つ目は、プロセスが覚えていることは、ストアが受け取ったイベントを畳み込んだ結果と一致することです。`test/memory.test.ts` が、ストアが書き込みを断ったとき、同じ書き込みが 2 回届いたとき、2 つの答えが同時に終わったとき、プロセスが入れ替わったときを試します。

型が守るのは、ストアのどの呼び出しにも actor が要ることと、イベントの形です。actor に正しい利用者が渡っていることは、型では守れず、テストが見ています。Runtime が microVM を本当に分けていること、Memory が actor ごとにイベントを分けていることは、ドキュメントの記述で、この章のテストが確かめたことではありません。

Memory への書き込みは、答えを利用者に届けるのと同じリクエストの中で行っています。書き込みが遅いと、最後の `done` イベントがそのぶん遅れます。書き込みを後回しにすれば応答は速くなりますが、利用者が次の質問をしたときに前のやりとりがまだ無い、という瞬間ができます。この章は、遅れるほうを選びました。

::: details この章の検証メモ

**手元で確かめたこと。**（2026-10-13）

- `vp test run examples/50-agentcore`: 8 ファイル、51 件が通りました。HTTP の約束、利用者の読み取り、セッション ID、記憶の畳み込み、Memory のイベントとの対応、呼び出しの URL、スタックのアサーションです
- 型検査（`tsc --noEmit`）が通りました
- `vp run agentcore:infra:synth`: リソース 7 個、出力 7 個のテンプレートと、`app.js` の ZIP ができました。AWS には問い合わせていません
- `vp run agentcore:bundle:check`: `app.js`（1,750.8 KiB）を Node.js 24 で起動し、`/ping` の 200 と、トークンの無い `/invocations` の 401 を確かめました
- `vp run dev:agentcore` を起動し、[手元で動かす](/ja/chapters/50-agentcore/local.md)に載せた curl を実行しました。載せた出力は、そのときのものです

**まだ確かめていないこと。**

- スタックを AWS に一度もデプロイしていません。cdkd 0.296.28 が Runtime と Memory を Cloud Control API 経由で作れること、ZIP の `app.js` が Node.js 22 で起動すること、実行ロールの権限で足りること（X-Ray のステートメントを省いています）、MMDSv2 の扱いが未確認です
- エージェントに届くリクエストの形（`Authorization` ヘッダーとセッションのヘッダーが、その名前で届くこと）、server-sent events がそのまま呼び出し元に流れること、エージェントの 4xx が 424 になることは、ドキュメントの記述です
- microVM の中で、AWS SDK が設定なしに実行ロールの認証情報を見つけることを確かめていません
- AgentCore Memory が、この章の形のイベント（会話のペイロード 2 つとメタデータ）を受け付けること、`clientToken` で重複が消えること、Cognito の `sub` とこの章のセッション ID を actor とセッションの ID として受け付けることを確かめていません
- モデルを呼んでいません。答えの中身、トークンの数、費用は台本の値です
- 料金の試算の CPU 時間とメモリは仮定です。短期記憶の東京の単価は確認できていません

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| HTTP の約束 | `examples/50-agentcore/src/agent.ts`、`src/contract.ts`、`test/agent.test.ts` | `test:unit` |
| だれが呼んでいるか | `src/identity.ts`、`test/identity.test.ts` | `test:unit` |
| セッション ID | `src/session-id.ts`、`test/boundary.test.ts` | `test:unit` |
| 記憶 | `src/session.ts`、`src/history.ts`、`src/memory-store.ts`、`src/memory-events.ts`、`src/agentcore-memory.ts`、`test/session.test.ts`、`test/memory.test.ts`、`test/memory-events.test.ts` | `test:unit` |
| スタック | `infra/lib/agentcore-stack.ts`、`infra/lib/bundle.ts`、`infra/test/agentcore-stack.test.ts` | `agentcore:infra:synth`、`test:unit` |
| 手元で動かす | `src/dev.ts`、`src/local-model.ts`、`scripts/check-bundle.ts` | `dev:agentcore`、`agentcore:bundle:check` |
| デプロイ | `infra/bin/app.ts`、`scripts/invoke.ts`、`src/invoke-request.ts` | `agentcore:infra:deploy`、`agentcore:invoke`、`agentcore:infra:drift`、`agentcore:infra:destroy` |

**一次情報**（どれも 2026-10-13 に確認）

- 全体: [Overview](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html)、[Supported AWS Regions](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agentcore-regions.html)、[Quotas](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/bedrock-agentcore-limits.html)、[Release notes](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/release-notes.html)、[一般提供の発表](https://aws.amazon.com/blogs/machine-learning/amazon-bedrock-agentcore-is-now-generally-available/)
- 料金: [AgentCore pricing](https://aws.amazon.com/bedrock/agentcore/pricing/)、[AWS Price List（AmazonBedrockAgentCore、東京）](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockAgentCore/current/ap-northeast-1/index.json)
- Runtime: [Runtime の概要](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agents-tools-runtime.html)、[主な部品とプラットフォームバージョン](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-how-it-works.html)、[HTTP protocol contract](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-http-protocol-contract.html)、[セッション](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-sessions.html)、[Inbound Auth と Outbound Auth](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-oauth.html)、[ヘッダーの許可リスト](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-header-allowlist.html)、[セキュリティの手引き](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-security-best-practices.html)、[実行ロールの権限](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-permissions.html)
- コードのデプロイ: [direct code deployment](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-code-deploy.html)、[Node.js](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-code-deploy-node.html)、[対応するランタイム](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-code-deploy-supported-runtimes.html)、[AgentCore CLI](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agentcore-cli-reference.html)
- API: [CreateAgentRuntime](https://docs.aws.amazon.com/bedrock-agentcore-control/latest/APIReference/API_CreateAgentRuntime.html)、[LifecycleConfiguration](https://docs.aws.amazon.com/bedrock-agentcore-control/latest/APIReference/API_LifecycleConfiguration.html)、[CreateMemory](https://docs.aws.amazon.com/bedrock-agentcore-control/latest/APIReference/API_CreateMemory.html)、[IAM のアクションと条件キー](https://docs.aws.amazon.com/service-authorization/latest/reference/list_bedrock-agentcore.html)
- Memory: [記憶の種類](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory-types.html)、[用語](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory-terminology.html)、[組み込みの方式](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/long-term-configuring-built-in-strategies.html)、[Gateway を通した細かいアクセス制御](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory-gateway-fgac.html)
- Gateway、Identity、Observability、harness: [ターゲットの種類](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-supported-targets.html)、[Lambda のターゲット](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-add-target-lambda.html)、[ヘッダーの受け渡し](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-headers.html)、[workload access token](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/get-workload-access-token.html)、[サービスが出すデータ](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability-service-provided.html)、[ログの場所](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability-view.html)、[harness](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/harness.html)、[harness のツール](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/harness-tools.html)
- 固定した版のパッケージ: `aws-cdk-lib` 2.273.0 の `aws-bedrockagentcore`（型定義とソース）、`@go-to-k/cdkd` 0.296.28（`dist` の中のプロバイダーの登録）、`@aws-sdk/client-bedrock-agentcore` 3.1149.0（型定義）
- 比較: [Cloudflare Agents](https://developers.cloudflare.com/agents/)、[What are agents](https://developers.cloudflare.com/agents/concepts/what-are-agents/)、[Agents の上限](https://developers.cloudflare.com/agents/platform/limits/)、[Durable Objects の料金](https://developers.cloudflare.com/durable-objects/platform/pricing/)、[Sandbox SDK](https://developers.cloudflare.com/sandbox/)、[AI SDK: agents](https://ai-sdk.dev/docs/agents/overview)、[Vercel Sandbox](https://vercel.com/docs/vercel-sandbox)、[Vercel Sandbox の料金](https://vercel.com/docs/sandbox/pricing)、[Vercel Workflow](https://vercel.com/docs/workflow)

:::
