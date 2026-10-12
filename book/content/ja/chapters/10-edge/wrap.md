---
title: "10 Edge: 費用、注意点、片付け"
---

# 10 Edge: 費用、注意点、片付け

[前のページ](/ja/chapters/10-edge/deploy.md)までで、CloudFront Functions と KVS、Lambda@Edge をひととおり動かしました。このページでは、処理の置き場所の選び方と Workers との違いを整理し、そのあとで料金、つまずきやすい点、片付けを扱います。

## どこに置くか

<!-- section: 10.placement -->

この章で見てきた 4 つの置き場所を、表で比べます。

| | 静的な配信 | CloudFront Functions | Lambda@Edge | リージョンの Lambda |
| --- | --- | --- | --- | --- |
| 動く場所 | エッジのキャッシュ | エッジロケーション | 読者に近いリージョン（複製） | 1 つのリージョン（この本では東京） |
| 動くタイミング | - | viewer request、viewer response | 4 つのイベントすべて | 呼ばれたとき（04章） |
| ネットワーク | - | 出られない | 出られる | 出られる |
| ボディ | - | 読めない | 読める（切り詰めあり） | 読める |
| 状態 | キャッシュだけ | KVS を読むだけ | 自分では持たない。外へ取りに行く | DynamoDB などへ（05章） |
| 実行時間 | - | 1 ミリ秒未満 | 30 秒まで | Lambda の上限まで（HTTP API 経由なら 30 秒） |
| コードの大きさ | - | 10 KB | 50 MB（圧縮後） | Lambda の上限まで |
| 設定の渡し方 | - | コードか KVS | コードか、実行時に取得 | 環境変数など |
| 100 万回あたりの定価 | リクエスト料金だけ | USD 0.10 | USD 0.60 と実行時間 | USD 0.20 と実行時間 |

迷ったときは、表の左から順に検討します。

静的に配れるものは、静的に配ります。キャッシュされた応答はコードを 1 行も動かさないので、いちばん速く、いちばん安く、壊れる部品もいちばん少なくなります。

リクエストとヘッダーだけで決まる処理は、CloudFront Functions に置きます。URL の書き換え、リダイレクト、ヘッダーの追加、署名済みトークンの検査がこれに当たります。全リクエストで動かしても負担にならない単価です。

ほかのサービスを呼ぶ処理は、まずリージョンの Lambda を検討します。データが東京にあるなら、コードも東京に置くのが自然です。読者に近い場所でコードを動かしても、そこから東京のデータベースまで往復するなら、近くで動かす利点は小さくなります。

Lambda@Edge は、キャッシュの手前か直後でどうしてもコードが必要なときに使います。オリジンを選び分ける、オリジンの応答を加工してキャッシュに入れる、ボディを見てオリジンに届く前に断る、といった CloudFront の流れの途中でしかできない仕事のためのものです。バージョンの管理、`us-east-1`、環境変数なし、各リージョンに分かれるログと、運用の手間は 4 つの中でいちばん大きいので、最後の選択肢にするのがよいと考えています。

## Workers から来た人へ

<!-- section: 10.workers -->

Cloudflare Workers を使ってきた人は、この章の内容は Worker 1 つで全部できると感じたはずです。実際にできます。違いを表にまとめます。

| | Cloudflare Workers | CloudFront Functions | Lambda@Edge |
| --- | --- | --- | --- |
| ネットワーク（`fetch`） | できる。1 回の呼び出しで subrequest は Free 50、Paid は既定 10,000 | できない | できる |
| CPU 時間 | Free 10 ミリ秒、Paid は既定 30 秒（最大 5 分）。`fetch` や KV を待つ時間は数えない | 1 ミリ秒未満 | 実行時間で 30 秒まで |
| メモリ | isolate あたり 128 MB | 2 MB | ビューワー側 128 MB、オリジン側は Lambda の上限まで |
| コードの大きさ | 64 MiB（非圧縮） | 10 KB | 50 MB（圧縮後） |
| KV への書き込み | Worker から書ける | 関数からは書けない | KVS は使えない |
| KV の値の大きさ | 25 MiB | 1 KB（全体で 5 MB） | - |
| KV の整合性 | 結果整合。他の拠点では 60 秒以上かかることがある、と明記 | 遅れがある。数字は Developer Guide に見つからず | - |

CloudFront Functions は、Workers に対応する製品ではありません。名前と、エッジで JavaScript が動くという点は似ていますが、できることの規模が桁違いです。Workers はアプリを書く場所で、CloudFront Functions は CDN の設定をコードで書く場所だと考えると、混同せずに済みます。

AWS で Workers に近いことをするには、部品を組み合わせます。入口の小さな判断は CloudFront Functions、アプリは東京の Lambda、データは DynamoDB という、この本がここまで作ってきた構成です。部品が多いのは事実で、1 つの Worker にbindingを足していく手軽さは、AWS にはありません。

その代わりに AWS にあるのは、部品ごとの境界です。CloudFront Functions はネットワークに出られないので、どう書いても外部の障害に巻き込まれません。料金も、全リクエストで動かして 100 万回あたり USD 0.10 です。この制約が合う仕事には、よくできた道具だと思います。

KV どうしでは、遅れの書き方が違います。Workers KV は「最大 60 秒以上」と、遅れの目安をドキュメントに書いています。CloudFront KVS については、Developer Guide に数字を見つけられませんでした。書いた直後に全拠点で読めるとは、どちらも言っていません。

料金は、Workers の Standard プランが月 1,000 万リクエストと 3,000 万 CPU ミリ秒を含み、以降は 100 万リクエストあたり USD 0.30、100 万 CPU ミリ秒あたり USD 0.02 です。月額そのものは、この章では確認していません。

## 料金

<!-- section: 10.cost -->

金額は USD、日本のエッジ、従量課金、税別です。計算の内訳は[料金の計算](/ja/reference/pricing.md)にあります。

この章の構成には、置いてあるだけでかかる料金はありません。ディストリビューションも関数も、呼ばれなければ 0 です。S3 の保存量は、3 つの HTML で数 KB です。KVS については、Price List に載っている項目が「関数からの読み取り」と「API 操作」の 2 つだけで、保存量に対する項目は見つかりませんでした。

使ったときの料金は次の表のとおりです。月 100 万リクエスト、そのうちトップページ 10%、その他のページ 20%、ファイル 70%、同期を月 20 回と仮定しています。

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

関数の実行と KVS の読み取りは、Price List の最初の段階（月 200 万回まで）がもともと USD 0 なので、定価の列も 0 です。200 万回を超えると、実行は 100 万回あたり USD 0.10、読み取りは 100 万回あたり USD 0.03 になります。

読み取りの回数は、関数の書き方で変わります。この章の関数は、ファイルなら 1 回、ページなら 2 回読みます。仮に全リクエストで 3 回読んでいたら、300 万回になり、無料の段階を超えます。ファイルではリダイレクトの表を引かないという 1 行が、料金の差になります。

KVS の API 操作は 1,000 回あたり USD 1 で、関数の中の読み取りより桁違いに高い単価です。1 回の同期は 3 回の呼び出し（版の確認、一覧、更新）なので USD 0.003 ほどですが、キーが増えると、一覧のページ数（50 件ごと）の分だけ呼び出しが増えます。CI から頻繁に `edge:kvs:plan` を実行するような使い方をするなら、回数を数えておいてください。

Lambda@Edge は、100 万リクエストあたり USD 0.60 と、1 GB 秒あたり USD 0.00005001 です。料金ページによると、無料枠はありません。東京の Lambda（arm64）の 1 GB 秒あたり USD 0.0000133334 と比べると、実行時間の単価はおよそ 3.75 倍です。Lambda@Edge が各リージョンに書くログ（CloudWatch Logs）の料金は、この表に入れていません。

無料枠は従量課金の場合のもので、アカウント全体で共有されます。

### 叩かれたら

このディストリビューションは、URL を知っていれば誰でも呼べます。ボットに大量のリクエストを送られた場合に、何が止めて何が止めないのかを確認しておきます。

静的なページとファイルを守るのは、キャッシュです。既定のビヘイビアは GET と HEAD だけを受け付け、`CachingOptimized` のキャッシュポリシーを使います。このポリシーは、クエリ文字列も cookie もキャッシュキーに入れません（CDK の型定義にそう書かれています）。そのため、`?x=<乱数>` を付けたリクエストを送られても、同じキャッシュが返るだけで、S3 には届きません。S3 に届くのは、存在しないパスを次々に変えて送られた場合です。この場合は、1 回ごとに S3 への GET（100 万回あたり USD 0.37）が増えます。

ただし、キャッシュが止めるのはオリジンへの到達だけです。キャッシュから返したリクエストにも、次の料金がかかります。

- CloudFront のリクエスト: 100 万回あたり USD 1.20
- CloudFront Functions の実行: 100 万回あたり USD 0.10（全リクエストで動きます）
- KVS の読み取り: 100 万回あたり USD 0.03。ファイルなら 1 回、ページなら 2 回、トップページなら 3 回
- 読者への転送: 1 GB あたり USD 0.114

そして、**リクエストの数そのものに上限はありません。** 04章の API Gateway には、秒あたりの上限を無料で付けられました。従量課金の CloudFront のディストリビューションには、それに当たる設定がありません。たとえば 1 秒 1,000 回のリクエストを 1 日続けられると 8,640 万回になり、リクエストが USD 103.68、関数が USD 8.64、KVS の読み取り（1 回ずつ）が USD 2.59 かかります。1 回 20 KB の応答なら、転送が 1,648 GB で USD 187.87 です。合わせて USD 302.78 になります（定価。月ごとの無料枠は引いていません）。この金額は 1 秒 1,000 回の場合の計算で、リクエストがもっと速ければ、その分だけ増えます。

`/digest` を足した場合は、Lambda@Edge の分が加わります。POST 以外は手前の関数が 405 で断るので、かかるのは上と同じくリクエストと関数の実行だけで、100 万回あたり USD 1.30 です。POST は 1 回ごとに Lambda@Edge が動き、100 万回あたり USD 2.27 かかります。内訳は、CloudFront のリクエスト 1.20、関数 0.10、KVS の読み取り 2 回で 0.06、Lambda@Edge のリクエスト 0.60、実行時間 0.31（128 MB、50 ミリ秒という仮定）です。Lambda@Edge には予約済み同時実行数を付けられないので、関数の側で回数を絞る方法もありません。各リージョンに書かれるログの料金は、この金額に入れていません。

対策として足せるものは 3 つあります。

- AWS WAF のレートベースのルール（rate-based rule）。ディストリビューションに web ACL を付けて、同じ IP アドレスからの回数を絞ります。[21章](/ja/chapters/21-security.md)で作ります。料金は、web ACL が月 USD 5、ルール 1 つにつき月 USD 1、検査したリクエスト 100 万回あたり USD 0.60 です。置いてあるだけで月額がかかるので、この章では足していません。正確な上限ではなく「近くで絞る」ものだという点も、21章で説明します
- CloudFront の定額プラン。料金ページには、月 USD 0（Free）、15（Pro）、200（Business）、1,000（Premium）のプランが載っています。どのプランに何が含まれるか、この章の構成（KVS、Lambda@Edge）で使えるかは、確認していません
- 請求の通知。01章で設定した予算の通知です。リクエストを止めてはくれませんが、気づくことはできます。ただし、届くのは 8〜12 時間後です

## つまずきやすいところ

| こうなったら | ここを見る |
| --- | --- |
| 同期したのに、古い値が返る | まず待ちます。エッジロケーションへの伝播には時間がかかります。`edge:kvs:plan` で差分が空なら、KVS には入っています |
| 同期が認証のエラーで止まる | KVS の API は SigV4A で署名します。一時的な認証情報には version 2 のセッショントークンが必要で、STS のグローバルなエンドポイント（`sts.amazonaws.com`）が出すものは使えません。リージョンの STS エンドポイントを使う設定になっているか確認します |
| `edge:kvs:plan` や `edge:kvs:sync` が「the store is PROVISIONING, not READY」で止まる | KVS を作った直後です。`READY` になるまで待ちます |
| デプロイ後、リダイレクトが全部効かない | KVS が空になっていないか確認します。作り直した直後の KVS は空です。`edge:kvs:sync` をもう一度実行します |
| 手元のテストは通るのに、関数の作成が構文エラーになる | ドキュメントの一覧に無い構文を使っていないか確認します。Node.js は受け付けても、ランタイム 2.0 が受け付けないものがあります |
| `/digest` が 405 を返す | POST 以外は、`edge-router.js` が Lambda@Edge の手前で断ります。`curl -X POST` で送っているか確認します |
| `/digest` が 502 を返す | Lambda@Edge の応答が CloudFront の検査に通っていません。ログは `us-east-1` ではなく、実行されたリージョンの `/aws/lambda/us-east-1.aih-edge-body-digest` にあります |
| Lambda@Edge の関数を消せない | 複製が残っています。ディストリビューションから外したあと、複製が消えるまで数時間かかります |
| メンテナンスにしたのに、一部のページが見える | 伝播の途中か、ブラウザが前の応答を持っているかのどちらかです。503 には `no-store` を付けているので、CloudFront のキャッシュが原因ではありません |

## 本番にするなら

- 入口で回数を絞ります。「叩かれたら」に書いたとおり、このディストリビューションにはリクエスト数の上限がありません。本番のトラフィックを受ける前に、AWS WAF のレートベースのルールを付けます（[21章](/ja/chapters/21-security.md)）。`/digest` のように 1 回ごとにコードが動くパスでは、とくに必要です
- KVS を書ける人を絞ります。`edge-data.json` をレビューしてマージし、CI だけが同期するようにします。コンソールからの直接の編集は、緊急時に限ります。直接の編集があれば、次の `edge:kvs:plan` に差分として出ます
- メンテナンスのスイッチを、唯一の防御にしません。伝播には遅れがあり、KVS が読めないあいだはスイッチが効きません。データを守るための締め出しは、オリジンの側でも行います
- 関数のメトリクスを見ます。見るのはエラーと compute utilization です（アラームの組み立て方は [19章](/ja/chapters/19-observability.md)）。utilization が上限に近いなら、読み取りの回数や JSON の大きさを見直します
- 表の大きさを見積もります。全体で 5 MB、値は 1 KB までです。数万件のリダイレクトを入れるつもりなら、先に計算してください
- Lambda@Edge のロググループに保持期間を付けます。ロググループは実行されたリージョンごとに自動で作られ、スタックの外にあるので、自分で設定します
- 反映の経路を AWS CDK CLI と CloudFormation にします。理由は 02章に書いたとおりです

## 片付け

<!-- section: 10.cleanup -->

```bash
vp run edge:unpublish --yes
vp run edge:infra:destroy
```

バケット、ディストリビューション、関数、KVS が消えます。KVS の中身も一緒に消えますが、`edge-data.json` があれば、いつでも入れ直せます。

Lambda@Edge を試した場合は、消す順番が決まっています。先に上の `edge:infra:destroy`（または、`-c bodyDigestVersionArn` なしの `edge:infra:deploy`）で、ディストリビューションから関数を外します。それから数時間待ちます。CloudFront が各地の複製を消し終わるまで、関数は消せません。

```bash
vp run edge:body:infra:destroy
```

ここまで実行しても、次の 3 つが残ります。

- Lambda@Edge のロググループ。実行されたリージョンごとの `/aws/lambda/us-east-1.aih-edge-body-digest` です。スタックの外で自動的に作られたものなので、スタックを消しても残ります。保存料金がかかり続けるので、CloudWatch のコンソールで、リージョンを切り替えながら消してください
- サービスにリンクされたロール（service-linked role）。`AWSServiceRoleForLambdaReplicator` と `AWSServiceRoleForCloudFrontLogger` です。Lambda@Edge を初めて使ったときに自動で作られます。料金はかかりません
- cdkd の保存場所。`us-east-1` で bootstrap したなら、`us-east-1` にも残ります（02章）

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテストで、関数（デプロイするファイルを `node:vm` で実行）、KVS の計画と同期、SDK のアダプター、Lambda@Edge のハンドラー、2 つのスタックを確かめました。型検査と synth（esbuild のバンドル込み、`-c bodyDigestVersionArn` あり・なし）も通しています。`dev:edge` を起動して、本文の `curl` と、`edge-data.json` のフラグの切り替えを実行しました。`dev:edge:cdkd`（cdkd のエミュレーター、Docker なし）も起動して、同じ `curl` で同じ応答を確認しました。SDK のクライアントが SigV4A の形式で署名することも確かめています（ネットワークには出ていません）。`/digest` への POST 以外を、関数が KVS を読まずに 405 で断ることは、同じ `node:vm` のテストで確かめました。

**まだ確かめていないこと。** AWS では何も実行していません。とくに次の点は、実環境での確認が残っています。`edge-router.js` がランタイム 2.0 で動くこと（構文、10 KB、2 MB、compute utilization、ID なしの `cf.kvs()`、無いキーで `get()` が reject すること）。KVS の更新がエッジロケーションに届くまでの時間。古い `If-Match` に KVS の API が返すエラーの種類。`@aws-sdk/signature-v4a` の署名を AWS が受け付けること。cdkd が `AWS::CloudFront::KeyValueStore` と `AWS::CloudFront::Function`、`us-east-1` のスタックの `AWS::Lambda::Version` を実際に扱えること、`us-east-1` での bootstrap が必要かどうか。Node.js 24 が Lambda@Edge で使えること。Lambda@Edge の複製の削除にかかる時間、ロググループが作られる場所。「つまずきやすいところ」の表の症状は、ドキュメントから組み立てたもので、実際に起こして確かめたものではありません。ランタイム 2.0 の一覧に無い構文が実際に拒否されるかも、試していません。`/digest` の 405 も同じです。CloudFront Functions が `allow` ヘッダーの付いた応答を受け付けること、POST 以外のリクエストで Lambda@Edge が実際に動かないことは、デプロイして確かめていません。「叩かれたら」の金額は単価からの計算で、請求で確かめたものではありません。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 全体像 | `examples/10-edge/infra/lib/edge-stack.ts`、`infra/bin/app.ts` | - |
| 関数を読む | `examples/10-edge/infra/functions/edge-router.js`、`edge-data.json` | `test:unit` |
| 同じファイルを Node.js で動かす | `examples/10-edge/src/local/load-function.ts`、`infra/test/edge-router.test.ts` | `test:unit`、`typecheck` |
| 手元で動かす | `examples/10-edge/src/local/dev.ts`、`site/`、`scripts/kvs-file.ts` | `dev:edge`、`dev:edge:cdkd` |
| KVS が約束すること、しないこと | `examples/10-edge/src/kvs/config.ts`、`test/kvs.test.ts` | `test:unit` |
| 表を安全に書き換える | `examples/10-edge/src/kvs/plan.ts`、`src/kvs/sync.ts`、`src/kvs/store.ts`、`scripts/kvs-sync.ts`、`test/sync.test.ts`、`test/store.test.ts` | `edge:kvs:plan`、`edge:kvs:sync`、`test:unit` |
| AWS にのせる準備 | `examples/10-edge/infra/lib/edge-stack.ts`、`infra/test/edge-stack.test.ts`、`cdk.json` | `edge:infra:synth`、`test:unit` |
| デプロイと切り替え | `tools/src/infra/`、`tools/src/site/publish.ts`、`examples/10-edge/scripts/kvs-sync.ts` | `edge:infra:diff`、`edge:infra:deploy`、`edge:publish`、`edge:kvs:plan`、`edge:kvs:sync`、`edge:infra:drift` |
| Lambda@Edge でボディを読む | `examples/10-edge/src/lambda-edge/body-digest.ts`、`infra/lib/body-digest-stack.ts`、`infra/test/body-digest-stack.test.ts`、`test/body-digest.test.ts` | `edge:body:infra:synth`、`edge:body:infra:deploy`、`edge:body:infra:destroy`、`test:unit` |
| 料金 | `data/pricing/`、`tools/src/pricing/calc.ts` | `test:unit` |
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
