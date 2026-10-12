---
title: "05 KV Store: 費用、注意点、片付け"
---

# 05 KV Store: 費用、注意点、片付け

章の最後のページです。DynamoDB が向かない要求、この構成の料金、つまずきやすいところ、本番にする前に変えること、片付けの手順をまとめます。

## DynamoDB が合わないとき

<!-- section: 05.fit -->

この章の設計がうまくいったのは、読み方が 2 種類しかなかったからです。次のような要求が出てくると、DynamoDB では扱いにくくなります。

- あとから増える、前もって決まっていない検索。「本文に特定の語を含むノート」や「先月更新されたノートを全員分」のような条件はキーに入っていないので、テーブルを全部読むことになります
- 複数の種類のデータをまたぐ集計や結合
- 複数のアイテムにまたがる制約。「この利用者のノートは 100 件まで」のような決まりは、ノートへの条件付き書き込みだけでは守れません。この章は件数を別のアイテムに持たせて対処しましたが、枠とノートを別々に書くぶん、ずれる余地が残りました。トランザクションの機能はありますが、1 回に扱えるアイテムの数や大きさに上限があります

アイテム 1 件は 400 KB までという上限もあります。画像のような大きなデータはアイテムに入れず、S3 に置きます（[07章](/ja/chapters/07-uploads.md)）。

こうした要求が中心なら、SQL のデータベースのほうが無理なく書けます。[13章](/ja/chapters/13-sql.md)で、Aurora DSQL、RDS for PostgreSQL、Aurora Serverless v2 を比べます。D1 に慣れている人には、そちらのほうが近い使い心地になるはずです。DynamoDB は SQL が書けない D1 ではなく、別の種類のデータベースです。

### 複数のリージョンに置くなら

DynamoDB には、テーブルの複製を複数のリージョンに置く global tables という機能があります。この本では実装しませんが、選ぶときに確かめることを挙げておきます。

公式ドキュメント（読み取りの整合性のページ）によると、global tables には整合性のモードが 2 つあります。既定のモードでは、変更は通常 1 秒以内にほかのリージョンへ複製され、リージョン間では結果整合です。もう 1 つのモードでは、書き込みがレスポンスを返す前に、別のリージョンへ同期的に複製されます。

この章の楽観ロックがそのまま成り立つかどうかは、モードによって変わるはずです。既定のモードでは変更が非同期に複製されるので、あるリージョンでの条件の評価が、別のリージョンで行われたばかりの書き込みをまだ見ていない可能性があります。これは複製の説明からの推論で、公式ドキュメントで直接は確認していません。いずれにせよ、「global」という名前から、条件付き書き込みがリージョンをまたいで効くと推測してはいけません。使う前に、モード、対応するリージョン、トランザクションの範囲を、その時点の公式ドキュメントで確かめてください。

## 料金

金額は USD、東京リージョン、オンデマンド、税別です。計算の入力と単価は[料金の計算](/ja/reference/pricing.md)にあります。

誰も使っていない間にかかるのは、テーブルの保存量の料金だけです。東京リージョンでは最初の 25 GB が無料で、それを超えたぶんが 1 GB あたり月 USD 0.285 です。この無料分は、公開されている価格表に段階として載っているものです。ノートが 10 MB なら 0 です。

使われると、読み書きのユニットで数えます。

| 対象 | 単価 | 数え方 |
| --- | --- | --- |
| 書き込み（write request unit） | 100 万あたり USD 0.715 | 1 KB までのアイテム 1 件の書き込みで 1 |
| 読み取り（read request unit） | 100 万あたり USD 0.1425 | 4 KB までのアイテム 1 件で、強整合なら 1、結果整合なら 0.5 |

月 100 万リクエストで計算します。内訳は一覧 70%、1 件の取得 20%、作成と更新 8%、削除 2% とし、一覧は 1 回で 20 KB を結果整合で読むとします。Lambda は 256 MB、arm64 で、平均の実行時間は、DynamoDB を呼ぶぶんだけ 04章より長い 60 ミリ秒と仮定しました。計測値ではありません。

| 対象 | 数量 | 定価 | 毎月の無料枠の適用後 |
| --- | --- | --- | --- |
| API Gateway HTTP API | 100 万件 | 1.29 | 1.29（無料枠は確認できず、引いていない） |
| Lambda のリクエストと実行時間 | 100 万件、15,000 GB 秒 | 0.40 | 0 |
| CloudWatch Logs | 0.477 GB | 0.37 | 0 |
| DynamoDB の読み取り | 195 万ユニット | 0.28 | 0.28 |
| DynamoDB の書き込み | 10 万ユニット | 0.07 | 0.07 |
| DynamoDB の保存 | 1 GB | 0.00 | 0.00 |
| 小計 | | **2.41** | **1.64** |

この計算でいちばん動かしやすいのは、一覧の読み取りです。100 万リクエストが使う DynamoDB の read request unit のうち、9 割を一覧が使っています。1 ページの件数を減らせば減ります。レスポンスから本文を外しただけでは減りません。リポジトリがアイテムを本文ごと読んでいるからです。逆に、一覧を強整合にすると、読み取りの行が 2 倍になります。

競合で拒否された更新も、write request unit を消費します。この計算は、競合が 1 件も起きないと仮定しています。

この表は、件数の上限を入れる前の数え方のままです。上限を入れたので、作成と削除では、枠のアイテムへの書き込みが 1 回ずつ増えます。この内訳なら、上乗せは多くても 10 万ユニット、USD 0.07 です。

この表に入れていないものが 2 つあります。レスポンスのデータ転送料金と、point-in-time recovery です。point-in-time recovery は、有効にすると 1 GB あたり月 USD 0.228 の保存料金がかかります。この章では無効です。

### 叩かれたら

URL を知っていれば、誰でも、何回でも呼べます。止めるものは 4 つあります。ステージのスロットリング（API 全体で 1 秒に 10 件）、テーブルの上限（1 秒に読み取り 150 ユニット、書き込み 40 ユニット）、ノートの件数の上限（100 件）、レスポンスの大きさの上限（一覧は 20 KiB まで、ノート 1 件は 64 KiB まで）です。

1 秒に 10 件のリクエストが 30 日続くと、2,592 万件です。上の表と同じ仮定で、定価は次のようになります。DynamoDB の読み取りと書き込みの 2 行は、30 日のあいだずっとテーブルの上限まで使われた場合の値にしました。大きなノートばかりを読み書きされたときの天井です。

| 対象 | 定価 |
| --- | --- |
| API Gateway HTTP API のリクエスト（2,592 万件） | 33.44 |
| Lambda のリクエストと実行時間（388,800 GB 秒） | 10.37 |
| CloudWatch Logs（12.36 GB） | 9.49 |
| DynamoDB の読み取り（3 億 8,880 万ユニット） | 55.40 |
| DynamoDB の書き込み（1 億 368 万ユニット） | 74.13 |
| DynamoDB の保存（100 件） | 0.00 |
| 合計 | **182.83** |

月に USD 183 ほどです。スロットリングが効いていなかったとしても、DynamoDB のぶんは下の 3 行の USD 129.53 で止まります。API Gateway と Lambda のぶんは止まりません。

この表に入っていないものは、04章と同じです。レスポンスのデータ転送は 04章と同じ計算で、一覧は 20 KiB までなので 30 日で USD 56 ほど、2,592 万件がすべて 64 KiB のノート 1 件だったとしても USD 180 ほどです。いちばん大きなノートばかりの一覧は 1 回で 77 ユニットほどを読むので、テーブルの読み取りの上限が先に効いて 1 秒に 2 回ほどしか通らないはずですが、確かめていません。実行時間の 60 ミリ秒も仮定です。テーブルの上限に当たると SDK がやり直すので、そのぶん長くなります。

件数の上限には、但し書きが 2 つあります。いまは全員が同じ持ち主（`anonymous`）なので、100 件は API 全体での 100 件です。誰かが埋めれば、ほかの人は作れません。また、ノートは誰でも消せます。量は絞れても、誰のノートかは区別できていません。区別するのは 06章です。

IP アドレスごとに止めたいなら AWS WAF を使いますが、HTTP API には付けられないので、手前に CloudFront を置く構成になります。[21章](/ja/chapters/21-security.md)の web ACL は、月 USD 8.00 と、リクエスト 100 万件あたり USD 0.60 です。その構成は、この本では作っていません。

スタックを消せば、テーブルも一緒に消えて、何も残りません。

## つまずきやすいところ

| こうなったら | ここを見る |
| --- | --- |
| `dev:notes` が `Invalid environment` で止まり、`NOTES_STORE` と出る | `examples/05-dynamodb/.env` があるかを確かめます |
| `NOTES_STORE=dynamodb` で起動して、最初のリクエストが 500 になる | DynamoDB Local が動いているか（`db:local:start`）、テーブルを作ったか（`db:migrate:local`）を確かめ、ログで `ResourceNotFoundException` を探します |
| デプロイ後、500 でログに `AccessDeniedException` | 実行ロールに無い操作を呼んでいます。メッセージに操作名（`dynamodb:Scan` など）とテーブルの ARN が出ます |
| デプロイ後、500 でログに `ResourceNotFoundException` | `TABLE_NAME` が指すテーブルがありません。別のリージョンを見ていないかを確かめます |
| 更新が必ず 409 になる | 送っている `expectedVersion` が、直前に受け取ったノートの `version` かどうかを確かめます。作成のレスポンスではなく、最後の更新のレスポンスの値を使います |
| 作ったノートが直後の一覧に出ない | 結果整合の読み取りでは起こり得ます。[しくみと実装](/ja/chapters/05-dynamodb/build.md)の「読み取りの整合性を選ぶ」のとおりです |
| 一覧が途中で終わる | `nextCursor` が `null` になるまで読んでいるかを確かめます |
| `GET /notes?limit=100` が 400 になる。一覧のノートに `body` が無い | 1 ページは 20 件までで、一覧は本文を載せません。続きは `nextCursor` で、本文は `GET /notes/:id` で取ります |
| ログにスロットリングを示すエラーが出る | このスタックはテーブルに上限を付けています（1 秒に読み取り 150 ユニット、書き込み 40 ユニット）。大きなノートを続けて読み書きすると当たります。それとは別に、新しいオンデマンドのテーブルが受けられるリクエストの量には、初期の上限があります |
| `{"message":"Too Many Requests"}` のような 429 が返る | ステージのスロットリングです。API 全体で 1 秒に 10 件を超えました。自分が呼んでいなくても、ほかの誰かのリクエストで起きます |
| `POST /notes` が 409 と `quota_exceeded` | ノートが 100 件あります。1 件消すと空きます。消しても空かないなら、枠のアイテム（`sk` が `QUOTA`）の `noteCount` が実際の件数より多くなっています |

## 本番にするなら

- 認証と、持ち主ごとの分離を足します。いまは全員が同じノートを読み書きでき、誰でも消せます（06章）
- テーブルを守ります。`removalPolicy` を `RETAIN` にして、削除保護と point-in-time recovery を有効にします。誤って消したデータを戻す手順は [22章](/ja/chapters/22-recovery.md)で練習します
- スロットリングとテーブルの上限を、自分の API に合わせます。ステージの 1 秒 10 件も、テーブルの 150 と 40 も、練習用の値です。上げるときは、「叩かれたら」の計算をやり直してください
- 本文を別のアイテムに分けます。一覧のレスポンスは本文を載せませんが、DynamoDB からは本文ごと読んでいます。一覧の読み取りの料金を減らすなら、本文を別のアイテムに置きます
- 作成を冪等にして、再試行でノートが重複する問題を直します。呼び出し側が `Idempotency-Key` のような値を送り、サーバーがその値をキーにして条件付きで書く形です。この本では実装していません。同じ考え方を、[08章](/ja/chapters/08-async.md)が S3 のイベントを処理するワーカーで使っています
- スロットリングと失敗を見張ります。DynamoDB のエラーと、409 の割合を見ます（[19章](/ja/chapters/19-observability.md)）。409 が多いなら、画面の作りか、ノートの分け方を見直す合図です
- 反映の経路を AWS CDK CLI と CloudFormation にします。02章で説明したとおりです

## 片付け

<!-- section: 05.cleanup -->

```bash
vp run notes:infra:destroy
vp run db:local:stop
```

`notes:infra:destroy` で、テーブル、関数、ロール、API、ロググループが消えます。このスタックはバックアップを取っていないので、テーブルの中のノートもすべて消えて、戻せません。

`db:local:stop` は、手元の DynamoDB Local のコンテナを消します。データをメモリに置く設定で起動しているので、中身も一緒に消えます。

残るのは、cdkd の bootstrap で作った保存場所（02章）と、そこに置かれたデプロイ用のファイルだけです。

::: details この章の検証メモ

**手元で確かめたこと。** コントラクトテスト（メモリ）、DynamoDB へのリクエストの検査、アプリとクライアントのテスト、インフラのアサーションを実行しました。型検査と、AWS SDK を含むバンドルの synth も通しています。`dev:notes` をメモリで起動して、本文の `curl` を実行しました。一覧が本文を返さないこと、1 ページが 20 件で止まること、いちばん大きい題名を並べても 20 KiB を超えないことは、テストで固定しました。件数の上限を入れたあと、`test/dynamodb-local.test.ts` の 15 件（リポジトリの規則 10 件と、件数の上限 5 件）を DynamoDB Local 3.3.1 に対して実行しました。このときは Docker を使わず、AWS が配布する jar を Java で直接起動し、テーブルは `scripts/local-db.ts migrate` で作っています。この実行は、保存されたアイテムと入力の検査を Valibot に替える前のものです。替えたあとは、DynamoDB Local に対するテストを実行していません。

**まだ確かめていないこと。** DynamoDB Local を Docker で動かすタスク（`db:local:start`、`db:local:stop`）は、Docker のデーモンが使えなかったため、実行していません。`db:migrate:local`、`db:seed:local`、`db:reset:local`、`test:local:dynamodb` も、タスクとしては実行していません。`notes:infra:diff`、`notes:infra:deploy`、`notes:smoke`、`notes:infra:drift`、`notes:infra:destroy` も、実際の AWS では動かしていません。

したがって、この章の中心である「条件付き書き込みが同時の書き込みを決まった数だけ通す」ことは、実際の DynamoDB の上では一度も確かめていません。確かめたのは、正しい条件式を送っていることと、メモリの実装と DynamoDB Local が同じ規則に従うことです。DynamoDB の挙動についての記述は、公式ドキュメントに基づきます。

テーブルの上限とステージのスロットリングも同じです。テンプレートに `OnDemandThroughput` とステージの `DefaultRouteSettings` が入っていることはテストで固定し、固定した版の cdkd（0.296.28）のソースがどちらも AWS の API に渡していることは読みました。実際に反映されること、テーブルの上限に当たったときに返るエラーと SDK のやり直し方、上限より大きな 1 回の読み書きが通るかどうか、429 に料金がかかるかどうかは、確かめていません。「叩かれたら」の金額は、単価と設定から計算しただけで、負荷をかけて測った値ではありません。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 読み方からキーを決める | `examples/05-dynamodb/src/dynamodb-repository.ts`、`src/id.ts`、`src/notes.ts` | `test:unit` |
| 契約に version を足す | `examples/05-dynamodb/src/contract.ts` | `test:unit` |
| 保存先を差し替える | `examples/05-dynamodb/src/repository.ts`、`src/memory-repository.ts`、`src/dynamodb-repository.ts`、`src/compose.ts` | `test:unit` |
| 条件付き書き込みで上書きを防ぐ、件数に上限を付ける | `examples/05-dynamodb/src/dynamodb-repository.ts`、`src/memory-repository.ts`、`src/notes.ts`、`src/app.ts`、`src/contract.ts`、`test/repository-contract.ts`、`test/dynamodb-repository.test.ts` | `test:unit` |
| 読み取りの整合性を選ぶ | `examples/05-dynamodb/src/dynamodb-repository.ts`、`test/dynamodb-repository.test.ts` | `test:unit` |
| 取りこぼさずにページを送る | `examples/05-dynamodb/src/repository.ts`、`src/app.ts`、`src/contract.ts`、`test/app.test.ts` | `test:unit` |
| レスポンスが届かなかったとき | `examples/05-dynamodb/src/client.ts`、`test/app.test.ts` | `test:unit` |
| 手元で動かす | `examples/05-dynamodb/src/dev.ts`、`src/env.ts`、`test/env.test.ts`、`scripts/local-db.ts`、`test/fixtures/seed-notes.json`、`.env.example` | `dev:notes`、`db:local:start`、`db:migrate:local`、`db:seed:local`、`db:reset:local`、`db:local:stop` |
| テスト | `examples/05-dynamodb/test/`、`scripts/test-local.ts` | `test:unit`、`test:local:dynamodb` |
| AWS にのせる準備 | `examples/05-dynamodb/infra/lib/notes-stack.ts`、`infra/bin/app.ts`、`infra/test/notes-stack.test.ts`、`cdk.json` | `notes:infra:synth`、`test:unit` |
| デプロイして確かめる | `examples/05-dynamodb/src/lambda.ts`、`scripts/smoke.ts`、`tools/src/infra/` | `notes:infra:diff`、`notes:infra:deploy`、`notes:smoke`、`notes:infra:drift` |
| 片付け | `tools/src/infra/` | `notes:infra:destroy`、`db:local:stop` |
| 料金 | `data/pricing/`、`tools/src/pricing/calc.test.ts` | `test:unit` |

**一次情報**（確認日はすべて 2026-10-11）

- [DynamoDB read consistency](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html)
- [DynamoDB condition expression CLI example](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html)
- [Paginating table query results in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.Pagination.html)
- [DynamoDB on-demand capacity mode](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/on-demand-capacity-mode.html)
- [Constraints in Amazon DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Constraints.html)
- AWS Price List bulk API: [DynamoDB](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonDynamoDB/current/ap-northeast-1/index.json)
- [Cloudflare D1: Local development](https://developers.cloudflare.com/d1/best-practices/local-development/)
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)

:::
