---
title: "64 Isolates: 費用、注意点、片付け"
---

# 64 Isolates: 費用、注意点、片付け

このページは、料金、つまずきやすい点、本番にするなら変えること、片付けを扱い、最後にこの章の検証メモを置きます。

## 費用

<!-- section: 64.cost -->

単価は、2026-10-13 に AWS Price List の bulk API で東京リージョンの値を読み直しました。金額は定価で、割引や credits は入れていません。

タグなしでデプロイした状態にあるのは、リポジトリだけです。料金はイメージの保存料で、イメージ 1 つを 0.1 GB と仮定すると 1 か月に USD 0.01 です。イメージは一度もビルドしていないので、実際の大きさは測っていません。workerd のバイナリだけで、展開後に 139 MB、圧縮した配布物で 40 MB あります。

タグを付けてデプロイすると、時間課金が始まります。リクエストが 1 件も来なくても、1 か月（730 時間）で USD 37.68、1 日で USD 1.24 です。1 か月の内訳は、Fargate の vCPU が USD 7.38、メモリが USD 1.61、ロードバランサーが USD 17.74、パブリック IPv4 アドレス 3 つが USD 10.95 です。アドレスは、ロードバランサーのノードに 2 つ、パブリックサブネットに置いたタスクに 1 つ付きます。

<<< @/examples/64-isolates/src/cost.ts{idle}

タスクをプライベートサブネットに置く構成（`-c taskSubnets=private`）では、イメージの取得とログのために、NAT ゲートウェイかインターフェースエンドポイントが要ります。その料金は 12章の費用の節に書きました。

負荷をかけたときの比較には、Cloudflare が料金のページの最初の例に使っている数字を借ります。1 か月に 1,500 万リクエスト、1 リクエストあたりの CPU 時間が 7 ms です。

<<< @/examples/64-isolates/src/cost.ts{load}

- **この章の構成。** USD 39.02 です。置いてあるだけの料金に、ロードバランサーの LCU の分がおよそ USD 1.33 加わります。タスクは、暇でも忙しくても同じ料金です。この負荷は、月の平均では 0.25 vCPU の 16% にあたります。瞬間的な集中に 1 つのタスクが耐えられるかは、計算していませんし、測ってもいません
- **04章の構成。** HTTP API と 256 MB の Lambda 関数で、USD 24.85 です。内訳は HTTP API が USD 19.35、Lambda のリクエストが USD 3.00、実行時間が USD 2.50 で、無料利用枠を引くと USD 22.15 になります。Lambda が課金するのは CPU 時間ではなく実行時間なので、1 リクエストを 04章のシナリオと同じ 50 ms と仮定しました
- **Workers。** Cloudflare のページの計算どおり、USD 8.00 です。月額 USD 5 に、1,000 万件を超えたリクエストの分 USD 1.50 と、3,000 万 ms を超えた CPU 時間の分 USD 1.50 が加わります

<<< @/examples/64-isolates/src/cost.ts{workers}

3 つの数字は、同じものを比べてはいません。Workers の料金には、世界中の拠点と、この章で失ったものすべてが含まれています。AWS の 2 つには、ログとデータ転送の料金が別にかかります。Cloudflare のページは、データ転送に追加の料金はかからないと書いています。そのうえで言えるのは、この大きさの負荷では、workerd をセルフホストする理由は料金にはならないということです。

## つまずきやすい点

<!-- section: 64.pitfalls -->

**compatibility date を未来にしてしまう。** workerd は起動を断ります。手元で 1 日先の日付を渡したときのメッセージは、`Can't set compatibility date in the future` でした。この章のスキーマは、固定した版が知っている日付より先を受け付けないので、設定のファイルを書く前に止まります。

**必須の設定が届いていない。** タスクの定義の環境変数と、設定の `fromEnvironment` の名前が食い違うと、binding は空になります。`ALLOWED_ORIGIN` が空なら、アプリの組み立てが失敗し、ヘルスチェックを含むすべてのリクエストが 500 になります。ECS は新しいタスクを健全と見なさないので、古いタスクが残り、circuit breaker がデプロイを戻します。この動きのうち、500 になるところまでは手元の workerd で確かめました。

**ノートが消える、または見えたり見えなかったりする。** ノートは workerd のプロセスのメモリの中にあります。デプロイでタスクが入れ替わると消えます。タスクを 2 つにすると、リクエストがどちらのタスクに届いたかで、見えるノートが変わります。

**1 つのリクエストが全体を止める。** worker の中の長いループは、同じプロセスのすべての worker と、ヘルスチェックを止めます。workerd は打ち切りません。原因になったリクエストは、workerd のログからは分かりません。04章のアプリがログを書くのは、リクエストを処理し終えたときだからです。

**イメージのアーキテクチャと glibc。** タスクの定義は arm64 です。x86-64 のマシンでビルドするときも、`--platform linux/arm64` が付いていることを確かめてください（`isolates:image:build` は付けます）。ベースイメージを Alpine や Amazon Linux 2023 に替えると、workerd の求める glibc 2.35 がありません。そのとき出るメッセージは、確かめていません。

**調べる場所。** タスクが起動しないときは、ECS のコンソールか `aws ecs describe-tasks` で、止まったタスクの停止理由を見ます。workerd と worker が書いた行は、スタックの出力 `TaskLogGroupName` のロググループにあります。この章には、12章の `ecs:logs` にあたるタスクを用意していません。

## 本番にするなら

<!-- section: 64.production -->

- **状態を外に出す。** メモリの中の `Map` を、タスクの外のデータストアに替えます。それまでは、タスクを 2 つ以上にできません。AWS の SDK が workerd の上で動くかは、この章では確かめていません
- **タスクを 2 つ以上にして、2 つの AZ に置く。** 状態を外に出したあとの話です。スケーリングは[41章](/ja/chapters/41-fargate.md)が扱います
- **HTTPS にする。** ロードバランサーに証明書を付けるか、前に CloudFront を置きます。設定の `forwardedProtoHeader` は、そのときのために入れてあります
- **workerd を上げ続ける。** V8 のセキュリティ修正は、workerd の新しい版として届きます。Cloudflare は自分のプラットフォームに 24 時間以内に出すと書いていますが、セルフホストでは、版を上げてイメージを作り直してデプロイするまでが自分の仕事です。[20章](/ja/chapters/20-shipping.md)のパイプラインに載せて、手作業にしないでください
- **信頼できないコードを載せない。** 1 つの workerd のプロセスに載せるのは、互いに信頼できる worker だけにします。信頼の境界が違うコードは、タスクを分けます
- **暴走に備える。** リクエストごとの CPU 時間の上限はありません。入口でリクエストの数を抑え（[21章](/ja/chapters/21-security.md)の WAF）、ヘルスチェックの失敗でタスクが入れ替わることを、アラームで知るようにします（[19章](/ja/chapters/19-observability.md)）
- **タスクをプライベートサブネットに移す。** 12章の選択肢がそのまま使えます

## 片付け

<!-- section: 64.cleanup -->

時間課金だけを止めてイメージを残すなら、タグなしでデプロイし直します。

```bash
vp run isolates:infra:diff
vp run isolates:infra:deploy
```

`diff` で、ロードバランサー、サービス、タスク定義などが削除される変更として表示され、リポジトリが残ることを確かめてから実行してください。

すべて消すなら、次の 2 つを、この順番で実行します。VPC を使っているスタックが残っていると、11章の destroy は拒否されます。

```bash
vp run isolates:infra:destroy
vp run net:infra:destroy
```

リポジトリは、中のイメージごと消えます。ロググループも一緒に消えます。残す設定がどのリソースにも付いていないことは、テストが確かめています。

手元には、`examples/64-isolates/.workerd/` に 139 MB のバイナリと、Docker のイメージが残ります。要らなければ消してください。

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト（5 ファイル、45 件）。そのうち `test/workerd.test.ts` の 11 件は、npm で入れた workerd 1.20261012.1（darwin-arm64）の実物を、Nix の devShell の中で起動して確かめています。04章のアプリがコントラクトどおりに答えること、同じコードの worker 2 つが 1 つのプロセスの中で状態を共有しないこと、処理中の 2 つのリクエストでモジュールスコープのリクエスト ID が入れ替わり `AsyncLocalStorage` では入れ替わらないこと、binding が設定と環境変数から届くこと、イメージ用の設定のファイルを workerd が受け付けることです。ほかのテストは、設定のスキーマと生成されるファイル、アダプター、料金の計算、スタックのアサーションを見ます。型検査。`isolates:bundle`、`dev:isolates`（curl で `/health`、`POST /notes`、`GET /notes`）、`isolates:observe`、`isolates:fetch`、`isolates:infra:synth`（既定、`-c imageTag=v1`、`-c imageTag=v1 -c taskSubnets=private`）、`isolates:image:build v1 --dry-run`、`isolates:image:push v1 --dry-run`。

手元の workerd で観察したこと。2000 ms の CPU ループは打ち切られず、同じプロセスの別の worker の `/health` は 1807 ms 待たされました。SIGTERM を送ると、処理中のリクエストに 201 を返してから終了コード 0 で終わり、その間に届いた新しいリクエストには 1500 ms 待っても答えませんでした。処理中のものが無ければ、アイドルの接続があっても 2 ms 以内に終わりました。1 日先の compatibility date は起動時に断られました。ファイルへの書き込みを macOS の `sandbox-exec` ですべて禁じた状態でも、起動してリクエストに答えました。

Linux arm64 の配布物について。npm のレジストリから取得した 39,889,339 バイトの SHA-512 が、レジストリの `dist.integrity` と一致しました。中のバイナリは動的リンクの aarch64 の ELF で、`libc.so.6` と `libm.so.6` を必要とし、`GLIBC_2.35` までの版のシンボルを参照しています（`file` と `strings` で読みました）。

**まだ確かめていないこと。** AWS に対しては、何も実行していません。`net:infra:deploy`、`isolates:infra:diff`、`isolates:infra:deploy`、`isolates:image:push`、`isolates:smoke`、`isolates:infra:drift`、`isolates:infra:destroy` のどれもです。コンテナイメージも、一度もビルドしていません。したがって、次はすべて確認待ちです。Linux arm64 の workerd が `debian:bookworm-slim` の上で起動すること。ユーザー `nobody` でポート 8080 を開けること。PID 1 として SIGTERM を受け取ること。`readonlyRootFilesystem` のまま Fargate で動くこと。ヘルスチェックが通り、入れ替えのあいだリクエストが失われないこと。ログが CloudWatch Logs に 1 行ずつ届くこと。イメージの大きさ。Amazon Linux 2023 の上で workerd が起動しないこと（条件を満たさないことを読んだだけで、試していません）。

手元の観察は macOS でのものです。Linux で同じかどうか、処理中のリクエストを workerd がいつまで待つのか、メモリを使い切ったときに何が起きるのかは、確かめていません。

一次情報で確かめられなかったこと。動いている workerd に、新しい設定やコードを無停止で読み込ませる手順は、README にもヘルプにも見つかりませんでした。SIGTERM の扱いを書いた文書も見つかりませんでした。workerd が上限を課さないことは、設定のスキーマに項目が無いことと、サーバーのソースの 2 か所を読んで判断しました。ソースのほかの部分は読んでいません。Vercel については、この章では何も調べていません。

共有ファイルについて。`workerd` のパッケージの postinstall スクリプトを pnpm が実行しないため、`vp install` のたびに警告が出ます。`pnpm-workspace.yaml` の `ignoredBuiltDependencies` に `workerd` を足せば消えますが、共有ファイルなので、この章からは変更していません。

cdkd が扱うリソースの種類。インストールされた `@go-to-k/cdkd` 0.296.28 のパッケージでは、`AWS::ECR::Repository`、`AWS::ECS::Cluster`、`Service`、`TaskDefinition`、`AWS::ElasticLoadBalancingV2::LoadBalancer`、`Listener`、`TargetGroup`、`AWS::IAM::Role`、`AWS::IAM::Policy`、`AWS::Logs::LogGroup`、`AWS::EC2::SecurityGroup`、`SecurityGroupIngress` が専用の実装に登録されています。`AWS::EC2::SecurityGroupEgress` は登録が無く、Cloud Control API 経由です。プロパティごとの一覧は、12章が同じ版から記録したものを使っています。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| workerd とは | `examples/64-isolates/src/release.ts` | |
| AWS での構成 | `examples/64-isolates/infra/lib/isolates-stack.ts`、`infra/bin/app.ts`、`src/config.ts` | `isolates:infra:synth` |
| アプリを worker にする | `examples/64-isolates/src/worker.ts`、`src/entry.ts`、`src/bundle.ts`、`test/worker.test.ts` | `isolates:bundle`、`test:unit` |
| 型から設定のファイルを作る | `examples/64-isolates/src/definition.ts`、`src/capnp.ts`、`src/deployments.ts`、`test/definition.test.ts` | `test:unit` |
| 1 つのプロセスの中の 2 つの worker | `examples/64-isolates/test/workerd.test.ts`、`test/harness.ts`、`src/runtime.ts` | `test:unit` |
| 1 つの worker の中の 2 つのリクエスト | `examples/64-isolates/src/entry-scoped.ts`、`test/workerd.test.ts`、`test/worker.test.ts` | `test:unit` |
| workerd が課さない上限 | `examples/64-isolates/src/spin.ts`、`scripts/observe.ts` | `isolates:observe` |
| イメージとスタック | `examples/64-isolates/src/release.ts`、`scripts/fetch.ts`、`Dockerfile`、`.dockerignore`、`src/image.ts`、`scripts/image.ts`、`infra/lib/isolates-stack.ts`、`infra/test/isolates-stack.test.ts` | `isolates:fetch`、`isolates:image:build`、`isolates:infra:synth`、`test:unit` |
| 手元の workerd で 04章のアプリを動かす | `examples/64-isolates/scripts/serve.ts`、`scripts/bundle.ts`、`scripts/observe.ts`、`test/` | `dev:isolates`、`isolates:bundle`、`isolates:observe`、`test:unit`、`isolates:infra:synth` |
| デプロイと動作確認 | `examples/64-isolates/scripts/image.ts`、`scripts/smoke.ts`、`infra/bin/app.ts` | `isolates:fetch`、`isolates:bundle`、`isolates:image:build`、`isolates:image:push`、`isolates:infra:diff`、`isolates:infra:deploy`、`isolates:smoke`、`isolates:infra:drift` |
| 費用 | `examples/64-isolates/src/cost.ts`、`test/pricing.test.ts`、`data/pricing/` | `test:unit` |
| 片付け | `tools/src/infra/` | `isolates:infra:destroy`、`net:infra:destroy` |

**一次情報**（確認日はすべて 2026-10-13）

- workerd（タグ v1.20261012.1）: [README](https://github.com/cloudflare/workerd/blob/v1.20261012.1/README.md)、[workerd.capnp](https://github.com/cloudflare/workerd/blob/v1.20261012.1/src/workerd/server/workerd.capnp)（設定のスキーマ）、[server.c++](https://github.com/cloudflare/workerd/blob/v1.20261012.1/src/workerd/server/server.c++)（`NullIsolateLimitEnforcer` の 2 か所）、[LICENSE](https://github.com/cloudflare/workerd/blob/v1.20261012.1/LICENSE)、[npm のレジストリ](https://registry.npmjs.org/workerd)（版、プラットフォーム、ダイジェスト）、インストールしたバイナリの `--help`
- Cloudflare Workers: [How Workers works](https://developers.cloudflare.com/workers/reference/how-workers-works/)、[Security model](https://developers.cloudflare.com/workers/reference/security-model/)、[Pricing](https://developers.cloudflare.com/workers/platform/pricing/)、[Limits](https://developers.cloudflare.com/workers/platform/limits/)、[Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)、[Compatibility dates](https://developers.cloudflare.com/workers/configuration/compatibility-dates/)
- AWS: [Architect for AWS Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html)（タスクの分離）、[Amazon Linux 2023 の glibc](https://docs.aws.amazon.com/linux/al2023/ug/glibc-gcc-and-binutils.html)、[Elastic Load Balancing pricing](https://aws.amazon.com/elasticloadbalancing/pricing/)（LCU の定義）
- AWS Price List bulk API: [ECS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/ap-northeast-1/index.json)、[ELB](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/current/ap-northeast-1/index.json)、[VPC](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/current/ap-northeast-1/index.json)、[Lambda](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/ap-northeast-1/index.json)、[API Gateway](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonApiGateway/current/ap-northeast-1/index.json)。この章が使う単価は、ほかの章が登録したものと同じ SKU で、値が変わっていないことを確かめました
- ほかのランタイム: [supabase/edge-runtime](https://github.com/supabase/edge-runtime)（README と、GitHub の API で見た最新のリリース日）
- 固定した版のパッケージ: [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)（`dist/` の JavaScript）

:::
