---
title: "29 Lambda Tuning: 費用、注意点、片付け"
---

# 29 Lambda Tuning: 費用、注意点、片付け

## 料金

<!-- section: 29.cost -->

このページでは、ここまでの設定がそれぞれいくらになるかを計算します。金額は USD、東京リージョン、従量課金、税別で、Lambda のぶんだけです。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。API Gateway、DynamoDB、ログの料金は 04章、05章、19章で計算したとおりで、ここには入れていません。

**既定のままデプロイして誰も呼ばない月は、0 です。** 予約済み同時実行数を付けても変わりません。**provisioned concurrency を 1 つ付けると、呼ばれなくても月に 2.83 かかります。** 256 MB の場合の金額で、メモリと数に比例します。無料枠は適用されません。

使ったぶんは、次のようになります。

| 場合 | GB 秒 | 定価 | 毎月の無料枠の適用後 |
| --- | --- | --- | --- |
| 月 100 万回、256 MB、1 回 50 ms | 12,500 | 0.37 | 0 |
| 同じ回数で、1,024 MB にしても 50 ms のままだった | 50,000 | 0.87 | 0 |
| 256 MB で、1% がコールドスタートだった | 13,250 | 0.38 | 0 |
| provisioned concurrency 1、256 MB、呼び出しなし | 657,000 | 2.83 | 2.83 |

1 回 50 ミリ秒は 04章と同じ仮定です。3 行目は、1 万回のコールドスタートがそれぞれ 300 ミリ秒の初期化を伴うと仮定しました。300 ミリ秒は計測値ではありません。

3 行目からわかるのは、初期化の課金が小さいことです。この仮定で増えるのは月 0.01 です。バンドルを小さくしても、料金はほとんど変わりません。変わるのは、コールドスタートに当たった利用者が待つ時間です。

2 行目は逆の教訓です。メモリを 4 倍にして実行時間が縮まなければ、実行時間の料金は 4 倍になります。メモリは、測ってから変える設定です。

<<< @/examples/29-lambda-tuning/src/plan.ts{items}

自分の関数の数字で同じ計算をするには、`vp run tune:plan --memory 512 --ms 30 --requests 5000000` のように渡します。

### 叩かれたら

この API にも認証がなく、URL を知っていれば誰でも呼べます。歯止めは 19章と同じで、ステージのスロットリングが毎秒 10 件、テーブルの上限が毎秒 150 read request unit と 40 write request unit、ノートは 100 件までです。その上限に 1 か月張り付いたときの料金の全体は、19章の[叩かれたら](/ja/chapters/19-observability/wrap.md)に表があります。この章で変わるのは Lambda の行だけです。

19章の表は、1 回 60 ミリ秒、256 MB という仮定で、Lambda を 10.37 と計算していました。同じ仮定でメモリを 1,024 MB にすると 25.92 です。メモリを上げると、叩かれたときの上限も同じ割合で上がります。

もっと大きく効くのは実行時間です。叩かれている最中に DynamoDB が応答しなくなり、どの呼び出しも関数のタイムアウトの 10 秒まで動いたとします。毎秒 10 件が 30 日続くと 2,592 万回で、256 MB でも 869.19 になります。同時実行数は 100 に達します。

ここで予約済み同時実行数が効きます。5 を予約してあれば、実行環境は 5 つまでしか増えず、それを超えたリクエストは関数を動かさずに断られます。5 つの実行環境が 30 日のあいだ休みなく動き続けても、43.46 です。

この 2 つの金額は、仮定から計算した上限で、請求で確かめたものではありません。実際には、この章の関数は SDK のタイムアウトと 9 秒の締め切りで 10 秒より前に諦めます。それでも、タイムアウトと同時実行数の上限が、応答の話であると同時に料金の話でもあることは、この計算でわかります。URL を人に教える前か、スタックを数日以上残すときには、`-c reservedConcurrency=5` を付けてください。付けられないアカウントでは、タイムアウトを短くしておくことが歯止めになります。

スタックを消せば、この章のぶんの料金は止まります。

## Workers から来た人へ

<!-- section: 29.workers -->

Cloudflare Workers には、この章の半分ほどが当てはまりません。コードを動かす単位が違うからです。Workers は、すでに動いているランタイムの中に isolate を作ってコードを動かします。関数ごとに実行環境を作って初期化する Lambda とは、起動のしかたが違います。違いを並べます（Cloudflare の側は 2026-10-13 に公式ドキュメントで確かめた内容です）。

| | Cloudflare Workers | Lambda（この章） |
| --- | --- | --- |
| 実行の単位 | isolate。動いているランタイムの中に作られる | 実行環境。関数ごとに作って初期化する |
| 1 つの単位が同時に処理する数 | 複数。1 つのイベントループで並行に処理する | 1 件 |
| 起動 | 仮想マシン方式のコールドスタートは無い、とドキュメントにある | 空いた実行環境が無ければ初期化を待つ |
| 起動時のコードの制限 | 最上位のコードは 1 秒以内。デプロイのときに検査される | Init フェーズは 10 秒まで |
| メモリ | isolate あたり 128 MB で、選べない | 128 MB から 10,240 MB。CPU も比例する |
| コードの大きさ | 64 MiB（圧縮前） | 250 MB（展開後） |
| 実行時間の課金 | CPU を使った時間。待っている時間は課金されない | メモリ × 経過時間。待っている時間も課金される |
| あらかじめ温めておく設定 | 読んだページには見当たらない | provisioned concurrency（時間で課金） |

Workers では、メモリを選ぶことも、同時実行数を予約することも、温めた実行環境を買うこともありません。決めることが少ないぶん、決められることも少なくなります。1 件が短く、CPU をあまり使わず、世界中から呼ばれる API なら、Workers のままでいるのが素直です。待ち時間が課金されないので、外の API を待つ時間が長い処理でも、料金は読みやすくなります。

Lambda を選ぶのは、その枠に収まらないときです。128 MB を超えるメモリが要る、1 回の処理で CPU を 5 分より長く使う、といった場合です。そのかわり、この章で見た設定を自分で持つことになります。

共通する部分もあります。Workers のドキュメントも、バンドルが大きいと起動時間に響くこと、最上位で重い初期化をすると 1 秒の制限を超えることを書いています。バンドルを小さくすることと、最上位のコードを軽くすることは、どちらの基盤でも効きます。

Vercel の Functions は、Fluid compute という方式で、1 つのインスタンスが複数の呼び出しを同時に処理します。2025 年 4 月 23 日以降の新しいプロジェクトでは既定で有効で、バイトコードのキャッシュと、本番デプロイでの事前の起動によってコールドスタートを減らす、とドキュメントにあります（2026-10-13 時点）。

Lambda にも、1 つの実行環境が複数のリクエストを同時に処理する形態（Lambda Managed Instances）があります。ライフサイクルも課金も別のもので、この章では扱っていません。

## つまずきやすいところ

| こうなったら | ここを見る |
| --- | --- |
| バンドルの予算のテストが落ちる | `vp run tune:bundle` の内訳で、増えたパッケージを探します。全操作を持つクライアントのクラスを import していないか、`mainFields` の指定が残っているかを確かめます |
| デプロイ後、すべての呼び出しがエラーになる | 初期化で失敗しています。`vp run tune:report` と、ログの `platform.initReport` を見ます。`module` を先に辿る設定で読み込めなくなった依存がないかを、バンドルのテストで確かめます |
| `Init Duration` が REPORT に出ない | コールドスタートではない呼び出しです。provisioned concurrency を使っている場合、初期化は `platform.initReport` のほうに出ます |
| メモリを増やしたのに速くならない | 待っているのは CPU ではなく、DynamoDB などの応答です。メモリを戻します |
| タイムアウトの直後の 1 件だけが遅い | 実行環境がリセットされ、初期化をやり直しています。別の行としては報告されません |
| 500 が返り、ログに `AbortError` がある | ハンドラーの締め切りです。何を待っていたかをスタックトレースで確かめます。DynamoDB のスロットリングなら、05章と 19章の上限を見ます |
| `Status: timeout` の REPORT があるのに、アプリのログが無い | 締め切りより先に関数のタイムアウトが来ています。SDK を通らない待ち（自分で書いた `fetch` など）に、シグナルを渡しているかを確かめます |
| `-c reservedConcurrency=5` を付けたデプロイが断られる | アカウントの同時実行数の上限が低い状態です。`aws lambda get-account-settings` で確かめ、外してデプロイします |
| provisioned concurrency を付けたのに、コールドスタートが減らない | 呼び出しがエイリアスを通っているか、指定した数を超えていないかを確かめます。超えたぶんは `ProvisionedConcurrencySpilloverInvocations` に出ます |
| 429 が返る | ステージのスロットリング（毎秒 10 件、バースト 20）です。Lambda の側でスロットリングされたときは `Throttles` が増えますが、そのとき API Gateway が返すステータスは確かめていません |

## 本番にするなら

- 数字を取ってから変えます。この章の値（256 MB、10 秒、締め切りの 1 秒、SDK の 1 秒と 2 秒、予算の 400,000 バイト）は、どれも練習用です。まず 1〜2 週間、REPORT と入口の `Latency` を見ます
- コールドスタートを見張ります。`Init Duration` のある REPORT の割合と、その p95 を定期的に見ます。割合が急に増えたら、同時に来るリクエストが増えたか、実行時間が延びています
- 同時実行数にアラームを付けます。`ConcurrentExecutions` が上限に近づく前と、`Throttles` が 0 でなくなったときに知らせます（[19章](/ja/chapters/19-observability.md)）
- アカウントの上限を、必要になる前に確かめます。引き上げは Service Quotas からの申請です。クォータ全体の話は [32章](/ja/chapters/32-limits.md)にあります
- 関数ごとに予約済み同時実行数を決めます。1 つの関数の暴走が、同じリージョンのほかの関数を巻き込まないようにするためです
- provisioned concurrency は、必要な時間帯と数を測ってから付けます。付けるなら、`ProvisionedConcurrencySpilloverInvocations` と使用率を見て、数を見直します
- 設定の変更は、少しずつ出します。メモリやバンドルの変更も、コードの変更と同じように壊れます（[31章](/ja/chapters/31-progressive-delivery.md)）
- ミニファイしたスタックトレースの読み方を決めておきます。ソースマップを配るか、同じコミットを手元でバンドルし直して照らすかを、障害の前に決めます
- 反映の経路を AWS CDK CLI と CloudFormation にします。理由は 02章に書いたとおりです

## 片付け

<!-- section: 29.cleanup -->

```bash
vp run tune:infra:destroy
```

テーブル、関数、API、ロググループが消えます。provisioned concurrency を付けていた場合は、バージョンとエイリアスも消え、時間課金も止まります。ノートもログも一緒に消えます。

`vp run tune:bundle` が書いた `examples/29-lambda-tuning/dist/` は、手元に残ります。Git の管理外なので、消して構いません。

ほかに残るのは、cdkd の bootstrap で作った保存場所（02章）だけです。

## 分散システムとして見ると

実行環境は、関数のコードから見ると 1 台のマシンのようですが、いくつあるのかも、いつ消えるのかも、コードからは決められません。

- 状態の持ち主: ノートを持っているのはテーブルです。実行環境が持つのは、クライアント、接続、読み込んだコードといった、失っても作り直せるものだけです。実行環境を状態の置き場にすると、同時に 2 つ存在した時点で食い違います
- 不変条件（invariant）: 締め切りに達したリクエストは、関数のタイムアウトより前に、request ID の付いたいつもの形のエラーで終わる。ほかのリクエストの締め切りには影響されない
- 不変条件を壊そうとするテスト: 応答しないテーブルを相手に、締め切りが無ければリクエストが終わらないこと、締め切りが来れば 500 とログの行が出ること、2 件が同時に動いていても片方の締め切りがもう片方を止めないことを確かめています
- 部分的な失敗: 締め切りで止めた書き込みは、届いていないとは限りません。届いた後で応答だけが間に合わなかった場合、利用者には失敗と伝わり、テーブルには書かれています。SDK の再試行も、同じ書き込みを 2 回送ることがあります。利用者がやり直しても壊れないようにするのは、05章の条件付き書き込みと、08章の冪等性の役目です
- 共有される上限: 同時実行数の上限は、リージョンの中のすべての関数で分け合います。1 つの関数が遅くなって実行環境を使い切ると、関係のない関数がスロットリングされます。予約済み同時実行数は、この巻き込みを断つ仕切りです
- 遅れの偏り: コールドスタートは、平均には現れず、少数のリクエストにだけ現れます。平均で良し悪しを判断すると、見えません

::: details この章の検証メモ

**手元で確かめたこと。** REPORT 行と `platform.report` の読み取り（公式ドキュメントに載っている行を使用）、課金時間と GB 秒の計算、同時実行数の模型、タイムアウトの並びの検査、応答しないテーブルに対する締め切り、インフラのアサーションのユニットテスト。型検査。synth（esbuild のバンドル込み）。`tune:bundle` で 5 通りのバンドルのバイト数、内訳、Mac の上での読み込み時間を計測。デプロイするバンドルを素の Node.js 24 で読み込み、`/health` に答えること、DynamoDB の代役に `GetItem` を送って 404 を返すこと。CDK が作るバンドルが、計測したものと同じバイト数であること。`tune:plan` と `tune:report:sample` の出力。AWS CLI の `logs filter-log-events` と `lambda get-provisioned-concurrency-config` のヘルプで、スクリプトと本文が使う引数の名前。

**まだ確かめていないこと。** `tune:infra:deploy`、`tune:smoke`、`tune:report`、`tune:infra:drift`、`tune:infra:destroy` は、実際の AWS では動かしていません。とくに次の点は、ドキュメントから読み取ったか、計算しただけです。

- Lambda の上の時間のすべて。初期化の時間、コールドスタートの割合、メモリを変えたときの実行時間、バンドルを小さくした効果は、この章のどこにも実測値がありません
- JSON ログ形式の `platform.report` が、ドキュメントの形のまま CloudWatch Logs に入ること。`aws logs filter-log-events` の出力を `scripts/report.ts` が読めること
- `mainFields` を `module`, `main` にしてミニファイしたバンドルが、Lambda の Node.js 24 ランタイムで動くこと
- ハンドラーの締め切りが、Lambda の上で SDK の呼び出しを止め、500 とログを残すこと。関数がタイムアウトしたとき、または Lambda にスロットリングされたときに、API Gateway が返すステータス。API Gateway が待つのをやめた後の関数の動きと課金
- `-c reservedConcurrency` と `-c provisionedConcurrency` を付けたデプロイ。新しいアカウントで予約が断られる条件、provisioned concurrency の用意にかかる時間、cdkd が `AWS::Lambda::Version` と `AWS::Lambda::Alias` を Cloud Control API 経由で作成・更新・削除できること
- REPORT の `Init Duration` に、コードのダウンロードと実行環境の起動が含まれるかどうか
- 「叩かれたら」の金額。単価と仮定からの計算で、請求で確かめたものではありません
- AWS Lambda Power Tuning。README を読んだだけで、デプロイしていません

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 全体像 | `examples/29-lambda-tuning/src/lambda.ts`、`infra/lib/tuning-stack.ts` | `tune:infra:synth` |
| REPORT 行の読み方 | `examples/29-lambda-tuning/src/report.ts`、`test/report.test.ts`、`fixtures/report-lines.txt`、`scripts/report.ts` | `test:unit`、`tune:report:sample` |
| チューニングが要らない場合 | `examples/29-lambda-tuning/src/cost-inputs.ts` | `tune:plan` |
| バンドルを小さくする | `examples/29-lambda-tuning/src/bundle/`、`measure/aggregated.ts`、`test/bundle.test.ts`、`scripts/bundle.ts`、`infra/lib/tuning-stack.ts` | `test:unit`、`tune:bundle` |
| ハンドラーの外に置くもの | `examples/29-lambda-tuning/src/lambda.ts`、`src/compose.ts`、`test/deadline.test.ts` | `test:unit` |
| メモリを決める | `examples/29-lambda-tuning/src/cost-inputs.ts`、`src/plan.ts`、`scripts/plan.ts`、`test/cost-inputs.test.ts`、`test/plan.test.ts` | `test:unit`、`tune:plan` |
| 同時実行数 | `examples/29-lambda-tuning/src/concurrency.ts`、`test/concurrency.test.ts`、`infra/lib/tuning-stack.ts`、`infra/bin/app.ts`、`infra/test/tuning-stack.test.ts` | `test:unit`、`tune:infra:synth` |
| タイムアウトの並び | `examples/29-lambda-tuning/src/timeouts.ts`、`src/deadline.ts`、`src/lambda.ts`、`test/timeouts.test.ts`、`test/deadline.test.ts` | `test:unit` |
| レイヤーと extension | `examples/29-lambda-tuning/infra/lib/tuning-stack.ts` | |
| 手元で測る | `examples/29-lambda-tuning/scripts/bundle.ts`、`scripts/plan.ts`、`scripts/report.ts`、`src/bundle/measure.ts` | `tune:bundle`、`tune:plan`、`tune:report:sample`、`test:unit` |
| デプロイして測る | `examples/29-lambda-tuning/infra/bin/app.ts`、`scripts/smoke.ts`、`scripts/report.ts` | `tune:infra:diff`、`tune:infra:deploy`、`tune:smoke`、`tune:report`、`tune:infra:drift` |
| 料金 | `examples/29-lambda-tuning/src/cost-inputs.ts`、`src/plan.ts`、`test/cost-inputs.test.ts`、`data/pricing/` | `test:unit`、`tune:plan` |
| 片付け | `tools/src/infra/` | `tune:infra:destroy` |

**cdkd（0.296.28）での扱い。** `src/provisioning/register-providers.ts` に専用の実装があるもの: `AWS::Lambda::Function`、`AWS::Lambda::Permission`、`AWS::IAM::Role`、`AWS::IAM::Policy`、`AWS::DynamoDB::Table`、`AWS::Logs::LogGroup`、`AWS::ApiGatewayV2::*`。既定のスタックが使うのはこの範囲です。専用の実装が無く Cloud Control API 経由になるもの: `AWS::Lambda::Version`、`AWS::Lambda::Alias`（`-c provisionedConcurrency` を付けたときだけスタックに入る）。

**一次情報**（確認日はすべて 2026-10-13）

- [Understanding the Lambda execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html)、[Understanding Lambda function scaling](https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html)、[Lambda scaling behavior](https://docs.aws.amazon.com/lambda/latest/dg/scaling-behavior.html)（同時実行数のページには、関数が 10 秒に増やせる数を 500 と書いた段落が 1 つあります。本文は、スケーリングのページとクォータのページの 1,000 に従いました）
- [Configuring reserved concurrency for a function](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html)、[Configuring provisioned concurrency for a function](https://docs.aws.amazon.com/lambda/latest/dg/provisioned-concurrency.html)、[Improving startup performance with Lambda SnapStart](https://docs.aws.amazon.com/lambda/latest/dg/snapstart.html)
- [Configure Lambda function memory](https://docs.aws.amazon.com/lambda/latest/dg/configuration-memory.html)、[Configure Lambda function timeout](https://docs.aws.amazon.com/lambda/latest/dg/configuration-timeout.html)、[Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)、[Best practices for working with AWS Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html)
- [Building Lambda functions with Node.js](https://docs.aws.amazon.com/lambda/latest/dg/lambda-nodejs.html)、[Define Lambda function handler in Node.js](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-handler.html)、[Deploy Node.js Lambda functions with .zip file archives](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-package.html)
- [Lambda Telemetry API Event schema reference](https://docs.aws.amazon.com/lambda/latest/dg/telemetry-schema-reference.html)、[Configuring JSON and plain text log formats](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-cloudwatchlogs-logformat.html)、[Types of metrics for Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-metrics-types.html)、[Supported logs and discovered fields](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_AnalyzeLogData-discoverable-fields.html)（Lambda のログから自動で見つかる項目の一覧に `@initDuration` は載っていません。スクリプトは項目に頼らず、記録そのものを読みます）
- [Managing Lambda dependencies with layers](https://docs.aws.amazon.com/lambda/latest/dg/chapter-layers.html)、[Augment Lambda functions using Lambda extensions](https://docs.aws.amazon.com/lambda/latest/dg/lambda-extensions.html)
- [Creating and configuring an Amazon SQS event source mapping](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html)、[Quotas for configuring and running an HTTP API](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-quotas.html)
- [Reuse connections with keep-alive in Node.js](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/node-reusing-connections.html)、[@smithy/types 4.19.0](https://www.npmjs.com/package/@smithy/types/v/4.19.0)（SDK と一緒に入る型定義の `NodeHttpHandlerOptions` と `HttpHandlerOptions`）
- [AWS Lambda Pricing](https://aws.amazon.com/lambda/pricing/)（単価はスクリプトで表示されるため、課金の考え方と無料枠だけをここから読みました）、[AWS Lambda standardizes billing for INIT Phase](https://aws.amazon.com/blogs/compute/aws-lambda-standardizes-billing-for-init-phase/)
- AWS Price List bulk API: [Lambda](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/ap-northeast-1/index.json)（2026-10-09 公開の版）
- [esbuild: Platform と Main fields](https://esbuild.github.io/api/#platform)、[aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0)（`aws-lambda-nodejs/lib/bundling.js` のソース）
- [AWS Lambda Power Tuning](https://github.com/alexcasalboni/aws-lambda-power-tuning)（README のみ）
- [cdkd v0.296.28: register-providers.ts](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts)、[Resource types that support Cloud Control API](https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/supported-resources.html)
- [Cloudflare Workers: How Workers works](https://developers.cloudflare.com/workers/reference/how-workers-works/)、[Limits](https://developers.cloudflare.com/workers/platform/limits/)、[Pricing](https://developers.cloudflare.com/workers/platform/pricing/)、[Vercel: Fluid compute](https://vercel.com/docs/fluid-compute)

:::
