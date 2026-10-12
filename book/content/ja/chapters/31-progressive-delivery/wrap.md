---
title: "31 Progressive Delivery: 費用、注意点、片付け"
---

# 31 Progressive Delivery: 費用、注意点、片付け

この章の最後のページです。Cloudflare Workers と Vercel との違い、料金、詰まりやすい点、本番で足すもの、片付けの順に書き、末尾に検証の範囲をまとめます。

## Workers と Vercel から来た人へ

<!-- section: 31.compare -->

割合で切り替える機能は、Cloudflare Workers にも Vercel にもあります。どちらのドキュメントも 2026-10-13 に読みました。

| | Cloudflare Workers | Vercel | この章 |
| --- | --- | --- | --- |
| 割合での切り替え | gradual deployments。`wrangler versions deploy` が 2 つの version に割合で振り分ける | Rolling Releases。段ごとの割合を決めておき、最後は 100% | Lambda のエイリアスの重み。動かすのは自分のスクリプトか CodeDeploy |
| 振り分けの単位 | 既定ではリクエストごと。version affinity で利用者を固定できる | 端末ごと。割り当てを cookie に持つ | リクエストごと。固定する方法は無い |
| 戻す | ドキュメントにあるのは、手で前の version に戻す方法 | 手で中止するか、Instant Rollback | アラームが鳴ったら自動で戻す |
| 画面と API の食い違い | version affinity | Skew Protection が、ページを返したデプロイに API の呼び出しを固定する | 仕組みは無い。両方のバージョンが両方の画面に答えられるようにする |
| フラグ | Flagship。Worker の binding か OpenFeature の SDK で評価する | Vercel Flags。Marketplace のプロバイダーもつなげる | AppConfig と、関数の隣で動く拡張機能 |

手数は、Workers と Vercel のほうがずっと少なく済みます。Workers では、コマンド 1 つで 2 つの version に割合を付けられます。Vercel は、プロジェクトの設定で段を決めておけば、本番への昇格がそのまま段階的になります。この章で書いたスクリプト、アラーム、エイリアスの置き方に当たるものは、どちらでもプラットフォームの中にあります。

Vercel の Skew Protection は、この章に対応するものがありません。ブラウザーが古いページを開いたまま、新しいバージョンの API を呼ぶ、という食い違いを、ページを返したデプロイにリクエストを固定することで防ぎます。03章の SPA と、この章の API の組み合わせでは、同じ問題を自分で解くことになります。API を、古い画面からの呼び出しにも答えられる形で変えていくしかありません。

利用できる範囲には条件があります。Vercel のドキュメントによると、Rolling Releases と Skew Protection は Pro と Enterprise のプランで使え、Pro で Rolling Releases を使えるのは 1 プロジェクトです。Cloudflare の Flagship は、読んだページに、提供の段階（ベータかどうか）と料金の記載がありませんでした。

この章のやり方で手に入るのは、止める条件を自分で決められることです。どのメトリクスを、どのしきい値で、何分見るかを選べて、同じアラームがコードの切り替えもフラグのデプロイも止めます。Workers と Vercel については、読んだページに、エラー率を見て自動で戻すという記述は見つかりませんでした。割合を進めるか戻すかは、人が画面のメトリクスを見て決めるか、自分で API を呼ぶ仕組みを作ることになります。

すでに Workers か Vercel で動いていて、段階的な切り替えだけが欲しいなら、移る理由にはなりません。この章が役に立つのは、アプリがもう AWS にあって、Lambda や ECS の上で同じことをしたいときです。

## 料金

<!-- section: 31.cost -->

金額は USD、東京リージョン、従量課金、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。API Gateway、Lambda、ログの料金は 04章と同じなので、ここではこの章で足したぶんだけを見ます。

デプロイして、誰にも呼ばれないまま 1 か月置いた場合にかかるのは、アラーム 2 つの料金です。標準解像度のアラームは 1 つ月 0.10 なので、定価で **月 0.20** です。CloudWatch にはアラーム 10 個ぶんの無料枠があるので、ほかにアラームを持っていないアカウントなら 0 になります。エイリアス、バージョン、AppConfig のアプリケーションや設定プロファイルには、置いてあるだけでかかる料金はありません。

呼ばれると、AppConfig の料金が加わります。課金は 2 種類あります（AWS Price List、確認日 2026-10-13）。

- 設定の問い合わせ 1 回につき 0.0000002。拡張機能が 45 秒ごとに AppConfig へ確認する、その 1 回です
- 設定を受け取るたびに 0.0008

2 つ目のほうが効きます。1 回 0.0008 は、Lambda のリクエスト 4,000 件ぶんの料金と同じです。AppConfig のドキュメントは、コールドスタートが多く、新しい設定を頻繁に受け取るほど料金が上がると注記しています。実行環境が新しくできるたびに、拡張機能が設定を 1 回受け取るからだと読めますが、請求で確かめてはいません。

実行環境 1 つが 1 か月動き続け、コールドスタートとフラグのデプロイを合わせて設定を 1,000 回受け取る、という仮定で計算すると、定価で **月 1.01** です。内訳は、アラームが 0.20、問い合わせ 58,400 回が 0.01、受け取り 1,000 回が 0.80 です。アラームの無料枠を引くと 0.81 になります。AppConfig の無料枠は確認できなかったので、引いていません。

この数字は、コールドスタートの回数にほぼ比例します。同時実行数が大きく上下する関数では、受け取りの回数が桁で増えます。[19章](/ja/chapters/19-observability.md)のログから、月あたりのコールドスタートの回数を数えてから見積もってください。

大量のリクエストを送りつけられた場合の上限は、04章と同じです。この章の API も、ステージのスロットリングが毎秒 10 件（burst 20）で止めます。API Gateway と Lambda とログの料金の上限は、[04章の費用のページ](/ja/chapters/04-http-api/wrap.md)の計算がそのまま当てはまります。AppConfig の問い合わせは、実行環境ごとに 45 秒に 1 回までなので、リクエストが増えても比例しては増えません。受け取りの回数は、新しくできる実行環境の数で決まり、この章では上限を付けていません。

CodeDeploy を使った場合の料金は、確認できていません。ECS の canary と blue/green は、切り替えの間と bake time の間、タスクが最大で 2 倍動くので、そのぶんの Fargate の料金がかかります。単価は 12章のものです。

## つまずきやすいところ

次の表は、実行して出会った問題ではなく、ドキュメントとコードを読んで、詰まりそうだと分かっている点をまとめたものです。

| こうなったら | ここを見る |
| --- | --- |
| デプロイしたのに、ふるまいが変わらない | 設計どおりです。新しいコードは `$LATEST` にあります。`vp run rollout:start --apply` で切り替えます |
| `rollout:start` が `already in ALARM` で断る | アラームが鳴っています。原因が前の切り替えなら、500 が止まってから 1〜2 分待ちます |
| `rollout:start` が `another shift is in progress` で断る | エイリアスが、別のバージョンに重みを与えています。`vp run rollout:status` で確かめ、不要なら `rollout:rollback --apply` で消します |
| 結果が `abandoned` | 切り替えの途中で、他の誰かがエイリアスを変えました。スクリプトは何も上書きしていません。`rollout:status` でいまの状態を見て、人が決めます |
| `no alarm reading` で戻された | アラームを読めない状態か、`INSUFFICIENT_DATA` が、`--max-blind` の秒数を超えて続きました。実行している人の `cloudwatch:DescribeAlarms` の権限と、アラームが消されていないかを確かめます |
| 切り替えは完了したのに、新しいバージョンが壊れている | リクエストが少なくて、アラームに材料が届かなかった可能性があります。`rollout:plan` の最後の 2 行を見て、段の時間を延ばすか、切り替えの間に `rollout:probe` を動かします |
| `rollout:probe` の `flags:` がいつまでも `defaults` | フラグを一度も配っていないか、関数が設定を読めていません。`vp run flags:status` と、関数のロググループの `flags` の行、拡張機能が書くログを見ます |
| フラグを変えたのに、反映が遅い | 配る時間（5 分）に、拡張機能の確認の間隔（45 秒）が足されます |
| 4xx が増えたのに、切り替えが止まらない | アラームが見ているのは `5xx` と関数のエラーだけです。新しいバージョンが正しいリクエストを 400 で断るような壊れ方は、この 2 つでは捕まりません |
| `rollout:infra:destroy` が設定プロファイルで失敗する | 保存した版が残っている可能性があります。`vp run flags:clear --apply` を先に実行します |

## 本番にするなら

- 切り替えを、途中で消えない場所で動かす。端末ではなく CI のジョブか、CloudFormation と CodeDeploy に任せます。ジョブの制限時間は、計画の合計より長くします
- アラームを、件数ではなく割合にする。「1 分に 1 件の 500」は、リクエストが多い API では常に鳴ります。エラー率と、最低限のリクエスト数を組み合わせた条件にし、遅延も加えます
- バージョンどうしを比べる。Lambda のメトリクスには、エイリアスの下でどのバージョンが実行されたかを表す `ExecutedVersion` というディメンションがあります。この章のアラームはエイリアス全体を見ているので、10% の新しいバージョンの失敗は、90% の正常なリクエストに薄められます
- 割合と時間を、リクエストの数から決める。10% で 5 分、という数字に根拠はありません。その間に新しいバージョンへ届く件数を計算して決めます
- 誰がエイリアスを動かせるかを分ける。`lambda:UpdateAlias` と AppConfig のデプロイの権限は、本番のふるまいを変える権限です。20章のデプロイ用のロールとは別に考えます
- フラグに持ち主と期限を付ける。リリース用のフラグは、100% になったらコードと設定の両方から消します。この章のテストが、片方だけ消したときに失敗します
- 止めなければならないスイッチを、フラグにしない。読めないときにどちらへ倒れるかを決められないものは、フラグに向きません
- データの形を変えるデプロイを、先に、別に出す。戻した先のバージョンが読めない形を、canary に書かせないでください
- 練習用のヘッダーを外す。`x-app-version` と `x-flags-origin` は、内部の様子を外に見せています

本番の前に見直す項目の全体は、[33章](/ja/chapters/33-production-readiness.md)にあります。

## 片付け

<!-- section: 31.cleanup -->

```bash
vp run flags:clear
vp run flags:clear --apply
vp run rollout:infra:destroy
```

`flags:clear` は、設定プロファイルに保存した版をすべて消します。版は `flags:deploy` が作ったもので、cdkd の state には入っていません。版が残っていると設定プロファイルを消せないのかどうかは、AppConfig の API リファレンスからは分かりませんでした。先に消しておけば、どちらでも困りません。

`rollout:start` が発行したバージョンも、cdkd の state には入っていません。Lambda の API リファレンスによると、関数を消すと、そのバージョンとエイリアスもすべて消えます。関数、エイリアス、アラーム、AppConfig のリソース、ロール、ロググループは、スタックと一緒に消えます。消した後に残るものと、かかり続ける料金は、無いはずです。実行して確かめてはいません。

04章の `AihHttpApi`、12章と 20章のスタックは、この章では何も変えていません。

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト（切り替えの計画、アラームの状態からの判断、切り替えの実行と失敗の再現、フラグの定義の検査、割合での公開、届かないときのフォールバック、AppConfig への呼び出しの順序、アプリへの組み込み、2 つのバージョンが同じレコードを読む場合、スタックのアサーション、CodeDeploy と ECS canary のテンプレート）。型検査。cdkd 0.296.28 での synth（`rollout:infra:synth`）。`rollout:plan` と `flags:check` の出力。手元のサーバーで、フラグのファイルの編集が次のリクエストから反映されること、壊れたファイルで直前の値が使われること、`rollout:probe` の集計。いずれも macOS（Apple silicon）で確かめました。

**まだ確かめていないこと。** AWS に触るものは、すべて未実行です。`rollout:infra:diff`、`rollout:infra:deploy`、`rollout:start`、`rollout:status`、`rollout:rollback`、`rollout:probe`（デプロイした API に対して）、`flags:deploy`、`flags:status`、`flags:stop`、`flags:clear`、`rollout:infra:drift`、`rollout:infra:destroy`。とくに次の点は、実環境での確認待ちです。

- cdkd が Cloud Control API 経由で、エイリアス、バージョン、AppConfig の 4 種類を作れること。スタックを更新してもエイリアスが動かないこと
- `UpdateAlias` の実際のふるまい。`RevisionId` が食い違ったときのエラーの名前、空の map で重みが消えること。SDK の応答の形は、API リファレンスと型定義から書いたものです
- 重み付きエイリアスの実際の振り分けと、`x-app-version` に入る値
- アラームが切り替えの間に `ALARM` になるまでの時間、作った直後の `INSUFFICIENT_DATA` がどれだけ続くか
- 拡張機能のふるまい。一度も配っていない設定への応答、コールドスタート直後に AppConfig に届かないときの応答、500 ミリ秒の期限が足りるか
- アラームの ARN に絞った `cloudwatch:DescribeAlarms` で、AppConfig の自動のロールバックが働くこと
- AppConfig の「設定の受け取り」が数えられる単位。料金の節の 1,000 回という仮定は、この読み方に依存しています
- 保存した版が残る設定プロファイルを消せるかどうか
- ECS の canary と CodeDeploy の構成。テンプレートを合成してテストで読んだだけで、デプロイするアプリには入っていません。ECS の circuit breaker がローリングアップデート以外の方式で働くか、12章のサービスを作り直さずに方式を変えられるかも未確認です
- CodeDeploy の Lambda と ECS へのデプロイの料金。Price List に対応する項目が無いことしか確かめていません
- Lambda の拡張機能で `Entity-Id` による固定が使えるかどうか。使っていません

**使わなかったもの。** CodeDeploy は、固定した版の cdkd が `UpdatePolicy` を扱わないので、デプロイするスタックには入れていません。AppConfig の `Entity-Id` と multi-variant のフラグは使わず、割合の計算をアプリの側に置きました。ECS のサービスは、時間単位の料金がかかるので作っていません。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| この構成を選んだ理由 | `examples/31-progressive-delivery/infra/lib/progressive-stack.ts`、`infra/test/progressive-stack.test.ts` | `test:unit` |
| バージョンとエイリアス | `examples/31-progressive-delivery/infra/lib/progressive-stack.ts`、`infra/test/progressive-stack.test.ts` | `rollout:infra:synth`、`test:unit` |
| 切り替えの計画 | `examples/31-progressive-delivery/src/shift/plan.ts`、`test/plan.test.ts`、`scripts/rollout.ts` | `rollout:plan`、`test:unit` |
| アラームから決める | `examples/31-progressive-delivery/src/shift/decide.ts`、`test/decide.test.ts` | `test:unit` |
| 切り替えを実行する | `examples/31-progressive-delivery/src/shift/run.ts`、`src/shift/aws.ts`、`test/run.test.ts`、`test/fakes.ts`、`scripts/rollout.ts` | `rollout:start`、`rollout:status`、`rollout:rollback`、`test:unit` |
| CodeDeploy に任せる場合 | `examples/31-progressive-delivery/infra/lib/codedeploy-sketch.ts`、`infra/test/sketches.test.ts` | `test:unit` |
| フラグの定義 | `examples/31-progressive-delivery/flags/flags.json`、`src/flags/document.ts`、`test/flags-document.test.ts` | `flags:check`、`test:unit` |
| フラグを読む | `examples/31-progressive-delivery/src/flags/evaluate.ts`、`test/flags-evaluate.test.ts` | `test:unit` |
| AppConfig に届かないとき | `examples/31-progressive-delivery/src/flags/reader.ts`、`test/flags-reader.test.ts`、`test/app.test.ts` | `test:unit` |
| フラグをアプリに組み込む | `examples/31-progressive-delivery/src/app.ts`、`src/compose.ts`、`src/env.ts`、`src/lambda.ts`、`test/app.test.ts` | `dev:rollout`、`test:unit` |
| フラグをデプロイする仕組み | `examples/31-progressive-delivery/infra/lib/progressive-stack.ts`、`src/flags/appconfig.ts`、`scripts/flags.ts`、`test/flags-appconfig.test.ts` | `flags:deploy`、`flags:status`、`flags:stop` |
| 両方のバージョンが読めるデータ | `examples/31-progressive-delivery/test/versions.test.ts`、`examples/12-containers/src/compat.ts` | `test:unit` |
| ECS のサービスを段階的に切り替える | `examples/31-progressive-delivery/infra/lib/ecs-canary-sketch.ts`、`infra/test/sketches.test.ts` | `test:unit` |
| 手元で動かす | `examples/31-progressive-delivery/src/dev.ts`、`.env.example`、`src/probe.ts`、`scripts/probe.ts` | `dev:rollout`、`rollout:probe` |
| デプロイ | `examples/31-progressive-delivery/infra/bin/app.ts` | `rollout:infra:diff`、`rollout:infra:deploy` |
| 片付け | `examples/31-progressive-delivery/scripts/flags.ts` | `flags:clear`、`rollout:infra:destroy` |
| 料金 | `data/pricing/`、`tools/src/pricing/calc.test.ts` | `test:unit` |

**一次情報**（確認日は、Lambda のエイリアスとメトリクス、CodeDeploy の設定、AppConfig の拡張機能とフラグの形式とデプロイ戦略が 2026-10-12、それ以外は 2026-10-13）

- Lambda: [重み付きエイリアス](https://docs.aws.amazon.com/lambda/latest/dg/configuring-alias-routing.html)、[メトリクスの種類](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-metrics-types.html)、[メトリクスの見方](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-metrics-view.html)、[環境変数](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html)、API リファレンスの [UpdateAlias](https://docs.aws.amazon.com/lambda/latest/api/API_UpdateAlias.html)、[PublishVersion](https://docs.aws.amazon.com/lambda/latest/api/API_PublishVersion.html)、[DeleteFunction](https://docs.aws.amazon.com/lambda/latest/api/API_DeleteFunction.html)
- CodeDeploy と CloudFormation: [deployment configuration](https://docs.aws.amazon.com/codedeploy/latest/userguide/deployment-configurations.html)、[UpdatePolicy 属性](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-attribute-updatepolicy.html)
- API Gateway: [HTTP API のメトリクス](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-metrics.html)
- AppConfig: [Lambda 拡張機能](https://docs.aws.amazon.com/appconfig/latest/userguide/appconfig-integration-lambda-extensions.html)、[拡張機能のしくみ](https://docs.aws.amazon.com/appconfig/latest/userguide/appconfig-integration-lambda-extensions-how-it-works.html)、[拡張機能の設定](https://docs.aws.amazon.com/appconfig/latest/userguide/appconfig-integration-lambda-extensions-config.html)、[拡張機能の版](https://docs.aws.amazon.com/appconfig/latest/userguide/appconfig-integration-lambda-extensions-versions.html)、[フィーチャーフラグの形式](https://docs.aws.amazon.com/appconfig/latest/userguide/appconfig-type-reference-feature-flags.html)、[デプロイ戦略](https://docs.aws.amazon.com/appconfig/latest/userguide/appconfig-creating-deployment-strategy.html)、[既定の戦略](https://docs.aws.amazon.com/appconfig/latest/userguide/appconfig-creating-deployment-strategy-predefined.html)、[エージェントの使い方](https://docs.aws.amazon.com/appconfig/latest/userguide/appconfig-agent-how-to-use.html)、[自動ロールバックの権限](https://docs.aws.amazon.com/appconfig/latest/userguide/setting-up-appconfig.html)、[バリデーター](https://docs.aws.amazon.com/appconfig/latest/userguide/appconfig-creating-configuration-and-profile-validators.html)、[DeleteConfigurationProfile](https://docs.aws.amazon.com/appconfig/2019-10-09/APIReference/API_DeleteConfigurationProfile.html)
- ECS: [blue/green](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-blue-green.html)、[canary](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/canary-deployment.html)、[circuit breaker](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-circuit-breaker.html)、[アラームによる失敗の検出](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-alarm-failure.html)、API リファレンスの [DeploymentConfiguration](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_DeploymentConfiguration.html)、[CanaryConfiguration](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_CanaryConfiguration.html)
- 料金: AWS Price List bulk API の [Systems Manager（AppConfig）](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSSystemsManager/current/ap-northeast-1/index.json)、[CodeDeploy](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSCodeDeploy/current/ap-northeast-1/index.json)。アラームの単価と無料枠は 19章で登録したものです
- 権限の出典: AWS service reference（[AppConfig](https://servicereference.us-east-1.amazonaws.com/v1/appconfig/appconfig.json)、CloudWatch、Lambda）
- cdkd: [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)（インストールしたパッケージの中身で、プロバイダーの登録と、`UpdatePolicy` と `CodeDeploy` が出てこないことを確認）
- 型定義: [aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0)（ECS のデプロイ方式、CodeDeploy、AppConfig）、[@aws-sdk/client-appconfig 3.1149.0](https://www.npmjs.com/package/@aws-sdk/client-appconfig/v/3.1149.0)（`StopDeployment` と `AllowRevert` の説明）
- Cloudflare: [Gradual deployments](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/gradual-deployments/)、[Flagship](https://developers.cloudflare.com/flagship/)、[Flagship の Concepts](https://developers.cloudflare.com/flagship/concepts/)
- Vercel: [Rolling Releases](https://vercel.com/docs/rolling-releases)、[Skew Protection](https://vercel.com/docs/skew-protection)、[Flags](https://vercel.com/docs/flags)

:::
