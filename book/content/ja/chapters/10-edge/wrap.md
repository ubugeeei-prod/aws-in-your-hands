---
title: "10 Edge: 費用、注意点、片付け"
---

# 10 Edge: 費用、注意点、片付け

## どこに置くか

<!-- section: 10.placement -->

ここまでの材料を、1 枚の表にします。

| | 静的な配信 | CloudFront Functions | Lambda@Edge | リージョンの Lambda |
| --- | --- | --- | --- | --- |
| 動く場所 | edge の cache | edge location | 読者に近いリージョン（複製） | 1 つのリージョン（この本では東京） |
| 動くタイミング | - | viewer request、viewer response | 4 つのイベントすべて | 呼ばれたとき（04章） |
| ネットワーク | - | 出られない | 出られる | 出られる |
| body | - | 読めない | 読める（切り詰めあり） | 読める |
| 状態 | cache だけ | KVS を読むだけ | 自分では持たない。外へ取りに行く | DynamoDB などへ（05章） |
| 実行時間 | - | 1 ミリ秒未満 | 30 秒まで | Lambda の上限まで（HTTP API 経由なら 30 秒） |
| コードの大きさ | - | 10 KB | 50 MB（圧縮後） | Lambda の上限まで |
| 設定の渡し方 | - | コードか KVS | コードか、実行時に取得 | 環境変数など |
| 100 万回あたりの定価 | リクエスト料金だけ | USD 0.10 | USD 0.60 と実行時間 | USD 0.20 と実行時間 |

迷ったときの順番は、左からです。

**静的に配れるなら、配る。** cache された応答は、コードを 1 行も動かしません。いちばん速くて、いちばん安くて、壊れる部品がいちばん少ない。

**リクエストとヘッダーだけで決まるなら、CloudFront Functions。** URL の書き換え、redirect、ヘッダーの追加、署名済みトークンの検査。全リクエストで動かしても気にならない単価です。

**ほかのサービスを呼ぶなら、まずリージョンの Lambda を考える。** データが東京にあるなら、コードも東京に置くのが素直です。読者に近い場所でコードを動かしても、そこから東京の DB まで往復するなら、近さの意味は薄れます。

**Lambda@Edge は、「cache の手前か直後で、どうしてもコードが要る」とき。** origin を選び分ける、origin の応答を加工して cache に入れる、body を見て origin に届く前に断る。そういう、CloudFront の流れの途中でしかできない仕事のためのものです。version の管理、`us-east-1`、環境変数なし、各リージョンに散らばるログ。運用の手間は 4 つの中でいちばん重いので、最後の選択肢にしておくのがいいと思います。

## Workers から来た人へ

<!-- section: 10.workers -->

Cloudflare Workers を使ってきた人は、この章を読みながら「それ、Worker 1 つで全部できるのでは」と思ったはずです。そのとおりです。率直に並べます。

| | Cloudflare Workers | CloudFront Functions | Lambda@Edge |
| --- | --- | --- | --- |
| ネットワーク（`fetch`） | できる。1 回の呼び出しで subrequest は Free 50、Paid は既定 10,000 | できない | できる |
| CPU 時間 | Free 10 ミリ秒、Paid は既定 30 秒（最大 5 分）。`fetch` や KV を待つ時間は数えない | 1 ミリ秒未満 | 実行時間で 30 秒まで |
| メモリ | isolate あたり 128 MB | 2 MB | viewer 側 128 MB、origin 側は Lambda の上限まで |
| コードの大きさ | 64 MiB（非圧縮） | 10 KB | 50 MB（圧縮後） |
| KV への書き込み | Worker から書ける | 関数からは書けない | KVS は使えない |
| KV の値の大きさ | 25 MiB | 1 KB（全体で 5 MB） | - |
| KV の整合性 | 結果整合。他の拠点では 60 秒以上かかることがある、と明記 | 遅れがある。数字は Developer Guide に見つからず | - |

CloudFront Functions は、Workers の対応物ではありません。名前と「edge で JavaScript が動く」という見た目は似ていますが、できることの桁が違います。Workers はアプリを書く場所で、CloudFront Functions は CDN の設定をコードで書く場所、くらいに思っておくと混ざりません。

AWS で Workers に近いことをしようとすると、部品を組み合わせることになります。入口の小さな判断は CloudFront Functions、アプリは東京の Lambda、データは DynamoDB。この本がここまでやってきた構成です。部品が多いのは事実で、「1 つの Worker に binding を足していく」あの手軽さは、AWS にはありません。

かわりに何があるかというと、部品ごとの境界です。CloudFront Functions は、ネットワークに出られないので、どう書いても外部の障害に巻き込まれません。全リクエストで動かしても 100 万回で USD 0.10 です。この絞り方が合う仕事なら、よくできた道具だと思います。

KV どうしの比較も 1 つだけ。Workers KV は「最大 60 秒以上」と、遅れの目安をドキュメントに書いています。CloudFront KVS は、Developer Guide に数字を見つけられませんでした。どちらも「書いた直後に全拠点で読める」とは言っていない、という点は同じです。

料金は、Workers の Standard プランが月 1,000 万リクエストと 3,000 万 CPU ミリ秒を含み、以降は 100 万リクエストあたり USD 0.30、100 万 CPU ミリ秒あたり USD 0.02。月額そのものは、この章では確認していません。

## お金の話

<!-- section: 10.cost -->

金額は USD、日本の edge、従量課金、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

置いてあるだけでかかる料金は、この章の構成にはありません。distribution も、関数も、呼ばれなければ 0 です。S3 の保存量は 3 つの HTML で数 KB。KVS については、Price List に載っている項目は「関数からの読み取り」と「API 操作」の 2 つだけで、保存量に対する項目は見つかりませんでした。

使うと、こうなります。月 100 万リクエスト、うちトップページ 10%、その他のページ 20%、ファイル 70%、sync を月 20 回という仮定です。

| 対象 | 数量 | 定価 | 毎月の無料枠の適用後 |
| --- | --- | --- | --- |
| CloudFront の HTTPS リクエスト | 100 万件 | 1.20 | 0 |
| CloudFront から読者への転送 | 19.07 GB | 2.17 | 0 |
| CloudFront Functions の実行 | 100 万回 | 0 | 0 |
| KVS の読み取り | 140 万回 | 0 | 0 |
| KVS の API 操作 | 80 回 | 0.08 | 0.08（無料枠は確認できず、引いていない） |
| Lambda@Edge のリクエスト | 1 万件 | 0.01 | 0.01 |
| Lambda@Edge の実行時間 | 62.5 GB 秒 | 0.00 | 0.00 |
| S3 への GET | 333,333 件 | 0.12 | 0.12 |
| 小計 | | **3.59** | **0.21** |

関数の実行と KVS の読み取りは、Price List の最初の段階（月 200 万回まで）がもともと USD 0 なので、定価の列も 0 です。それを超えると、実行は 100 万回あたり USD 0.10、読み取りは 100 万回あたり USD 0.03 になります。

読み取りの回数は、関数の書き方で変わります。この章の関数は、ファイルなら 1 回、ページなら 2 回。もし全リクエストで 3 回読んでいたら、300 万回になって無料の段階を超えます。「ファイルは redirect の表を引かない」という 1 行は、こういうところに効いてきます。

KVS の API 操作は、1,000 回あたり USD 1。関数の中の読み取りより、桁がずっと高い単価です。1 回の sync は 3 回の呼び出し（版の確認、一覧、更新）なので USD 0.003 ほどですが、キーが増えると一覧のページ数（50 件ごと）だけ増えます。CI から頻繁に `edge:kvs:plan` を回す、のような使い方をするなら、数えておいてください。

Lambda@Edge は、100 万リクエストあたり USD 0.60 と、1 GB 秒あたり USD 0.00005001。料金ページによると無料枠はありません。東京の Lambda（arm64）の 1 GB 秒あたり USD 0.0000133334 と比べると、実行時間の単価はおよそ 3.75 倍です。この表に入れていないものとして、Lambda@Edge が各リージョンに書くログ（CloudWatch Logs）の料金があります。

無料枠は従量課金の場合のもので、アカウント全体で共有です。

## ハマりどころ

| こうなったら | ここを見る |
| --- | --- |
| sync したのに、古い値が返る | まず待つ。edge への伝播には時間がかかります。`edge:kvs:plan` で差分が空なら、KVS には入っています |
| sync が認証のエラーで止まる | KVS の API は SigV4A で署名します。一時的な認証情報は version 2 の session token が必要で、STS の global endpoint（`sts.amazonaws.com`）が出すものは使えません。リージョンの STS endpoint を使う設定になっているか確認 |
| sync が「store is PROVISIONING」で止まる | KVS を作った直後です。`READY` になるまで待つ |
| デプロイ後、redirect が全部効かない | KVS が空ではありませんか。作り直した直後の KVS は空です。`edge:kvs:sync` をもう一度 |
| 手元のテストは通るのに、関数の作成が構文エラーになる | ドキュメントの一覧に無い構文を使っていませんか。Node.js は受け付けても、runtime 2.0 が受け付けないものがあります |
| `/digest` が 502 を返す | Lambda@Edge の応答が CloudFront の検査に通っていません。ログは `us-east-1` ではなく、実行されたリージョンの `/aws/lambda/us-east-1.aih-edge-body-digest` にあります |
| Lambda@Edge の関数を消せない | 複製が残っています。distribution から外してから、消えるまで数時間かかります |
| メンテナンスにしたのに、一部のページが見える | 伝播の途中か、ブラウザが前の応答を持っているかです。503 には `no-store` を付けているので、CloudFront の cache ではありません |

## 本番にするなら

- **KVS を書ける人を絞る。** `edge-data.json` を review して merge し、CI だけが sync する。コンソールからの直接の編集は、緊急時だけにします。この章の script は、直接の編集を次の `edge:kvs:plan` で差分として見せてくれます
- **メンテナンスのスイッチを、唯一の防御にしない。** 伝播には遅れがあり、KVS が読めないあいだは効きません。データを守るための締め出しは、origin の側でも行います
- **関数の指標を見る。** エラーと compute utilization です（アラームの組み立て方は [19章](/ja/chapters/19-observability.md)）。utilization が上限に近いなら、読み取りの回数や JSON の大きさを見直します
- **表の大きさを見積もる。** 5 MB、値は 1 KB。数万件の redirect を入れるつもりなら、先に計算を
- **Lambda@Edge の log group に保持期間を付ける。** 実行されたリージョンごとに自動で作られます。stack の外にあるので、自分で設定します
- **反映の経路を AWS CDK CLI と CloudFormation にする。** 02章で話したとおりです

## 片付け

<!-- section: 10.cleanup -->

```bash
vp run edge:unpublish --yes
vp run edge:infra:destroy
```

bucket、distribution、関数、KVS が消えます。KVS の中身も一緒です（`edge-data.json` があれば、いつでも入れ直せます）。

Lambda@Edge を試した場合は、順番があります。先に上の `edge:infra:destroy`（または、`-c bodyDigestVersionArn` なしの `edge:infra:deploy`）で distribution から外します。それから数時間待ちます。CloudFront が各地の複製を消し終わるまで、関数は消せません。

```bash
vp run edge:body:infra:destroy
```

これで残るものが 3 つあります。

- **Lambda@Edge の log group。** 実行されたリージョンごとの `/aws/lambda/us-east-1.aih-edge-body-digest` です。stack の外で自動的に作られたものなので、stack を消しても残ります。保存料金がかかり続けるので、CloudWatch のコンソールで、リージョンを切り替えながら消してください
- **service-linked role。** `AWSServiceRoleForLambdaReplicator` と `AWSServiceRoleForCloudFrontLogger` です。Lambda@Edge を初めて使ったときに自動で作られます。料金はかかりません
- **cdkd の保存場所。** `us-east-1` で bootstrap したなら、そちらにも残ります（02章）

::: details この章の検証メモ

**手元で確かめたこと。** 関数（デプロイするファイルを `node:vm` で実行）、KVS の計画と同期、SDK の adapter、Lambda@Edge の handler、2 つの stack のユニットテスト。型検査。synth（esbuild の bundle 込み、`-c bodyDigestVersionArn` あり・なし）。`dev:edge` を起動して、本文の `curl` と、`edge-data.json` の flag の切り替えを実行。`dev:edge:cdkd`（cdkd の emulator、Docker なし）を起動して、同じ `curl` で同じ応答を確認。SDK の client が SigV4A の形式で署名すること（ネットワークには出ていません）。

**まだ確かめていないこと。** AWS では何も実行していません。とくに、次の点は実環境での確認待ちです。`edge-router.js` が runtime 2.0 で動くこと（構文、10 KB、2 MB、compute utilization、ID なしの `cf.kvs()`、無いキーで `get()` が reject すること）。KVS の更新が edge に届くまでの時間。古い `If-Match` に KVS の API が返すエラーの種類。`@aws-sdk/signature-v4a` の署名を AWS が受け付けること。cdkd が `AWS::CloudFront::KeyValueStore` と `AWS::CloudFront::Function`、`us-east-1` の stack の `AWS::Lambda::Version` を実際に扱えること、`us-east-1` での bootstrap が必要かどうか。Node.js 24 が Lambda@Edge で使えること。Lambda@Edge の複製の削除にかかる時間、log group が作られる場所。「ハマりどころ」の表の症状は、ドキュメントから組み立てたもので、実際に起こして確かめたものではありません。runtime 2.0 の一覧に無い構文が実際に拒否されるかも、試していません。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 全体像 | `examples/10-edge/infra/lib/edge-stack.ts`、`infra/bin/app.ts` | - |
| 関数を読む | `examples/10-edge/infra/functions/edge-router.js`、`edge-data.json` | `test:unit` |
| Node.js で、同じファイルを動かす | `examples/10-edge/src/local/load-function.ts`、`infra/test/edge-router.test.ts` | `test:unit`、`typecheck` |
| 手元で動かす | `examples/10-edge/src/local/dev.ts`、`site/`、`scripts/kvs-file.ts` | `dev:edge`、`dev:edge:cdkd` |
| KVS は何を約束してくれるのか | `examples/10-edge/src/kvs/config.ts`、`test/kvs.test.ts` | `test:unit` |
| 表を安全に書き換える | `examples/10-edge/src/kvs/plan.ts`、`src/kvs/sync.ts`、`src/kvs/store.ts`、`scripts/kvs-sync.ts`、`test/sync.test.ts`、`test/store.test.ts` | `edge:kvs:plan`、`edge:kvs:sync`、`test:unit` |
| AWS にのせる準備 | `examples/10-edge/infra/lib/edge-stack.ts`、`infra/test/edge-stack.test.ts`、`cdk.json` | `edge:infra:synth`、`test:unit` |
| デプロイして、切り替えてみる | `tools/src/infra/`、`tools/src/site/publish.ts`、`examples/10-edge/scripts/kvs-sync.ts` | `edge:infra:diff`、`edge:infra:deploy`、`edge:publish`、`edge:kvs:plan`、`edge:kvs:sync`、`edge:infra:drift` |
| body を読みたくなったら: Lambda@Edge | `examples/10-edge/src/lambda-edge/body-digest.ts`、`infra/lib/body-digest-stack.ts`、`infra/test/body-digest-stack.test.ts`、`test/body-digest.test.ts` | `edge:body:infra:synth`、`edge:body:infra:deploy`、`edge:body:infra:destroy`、`test:unit` |
| お金の話 | `data/pricing/`、`tools/src/pricing/calc.ts` | `test:unit` |
| 片付け | `tools/src/site/unpublish.ts`、`tools/src/infra/` | `edge:unpublish`、`edge:infra:destroy`、`edge:body:infra:destroy` |

**一次情報**（確認日はすべて 2026-10-11）

- [Restrictions on CloudFront Functions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-function-restrictions.html)
- [JavaScript runtime 2.0 features for CloudFront Functions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-javascript-runtime-20.html)
- [CloudFront Functions event structure](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-event-structure.html)、[Test functions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/test-function.html)
- [Amazon CloudFront KeyValueStore](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions.html)、[Helper methods for key value stores](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-custom-methods.html)、[Work with key value data](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions-kvp.html)、[Create a key value store](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions-create.html)、[File format for key-value pairs](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions-create-s3-kvp.html)
- CloudFront KeyValueStore API: [UpdateKeys](https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_kvs_UpdateKeys.html)、[ListKeys](https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_kvs_ListKeys.html)
- [CloudFront quotas](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-limits.html)
- [Differences between CloudFront Functions and Lambda@Edge](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/edge-functions-choosing.html)、[Restrictions on all edge functions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/edge-function-restrictions-all.html)、[Edge function logs](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/edge-functions-logs.html)
- [Restrictions on Lambda@Edge](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-at-edge-function-restrictions.html)、[Set up IAM permissions and roles for Lambda@Edge](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-edge-permissions.html)、[Delete Lambda@Edge functions and replicas](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-edge-delete-replicas.html)
- [AWS News Blog: Introducing Amazon CloudFront KeyValueStore](https://aws.amazon.com/blogs/aws/introducing-amazon-cloudfront-keyvaluestore-a-low-latency-datastore-for-cloudfront-functions/)（仕様書ではなく、提供開始時の紹介記事）
- [Amazon CloudFront pay-as-you-go pricing](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/)、AWS Price List bulk API: [CloudFront](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudFront/current/index.json)
- Cloudflare: [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)、[Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/)、[How KV works](https://developers.cloudflare.com/kv/concepts/how-kv-works/)、[KV Limits](https://developers.cloudflare.com/kv/platform/limits/)
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)、[`src/provisioning/register-providers.ts`（v0.296.28）](https://raw.githubusercontent.com/go-to-k/cdkd/v0.296.28/src/provisioning/register-providers.ts)
- [@aws-sdk/signature-v4a 3.1138.0](https://registry.npmjs.org/@aws-sdk/signature-v4a)（導入したパッケージのソースも参照）

:::
