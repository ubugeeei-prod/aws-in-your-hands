---
title: "05 KV Store: 費用、注意点、片付け"
---

# 05 KV Store: 費用、注意点、片付け

## DynamoDB が合わないとき

<!-- section: 05.fit -->

この章の設計がうまくいったのは、読み方が 2 つしかなかったからです。次のような要求が出てきたら、DynamoDB では苦しくなります。

- あとから増える、決まっていない検索。「本文に特定の語を含むノート」「先月更新されたノートを全員分」のような条件は、key に入っていないので、table を全部読むことになります
- 複数の種類のデータをまたぐ集計や結合
- 複数の item にまたがる制約。「この利用者のノートは 100 件まで」のような決まりは、ノートへの条件付き書き込みだけでは守れません。この章は件数を別の item に持たせてしのぎましたが、席とノートを別々に書くぶん、ずれる余地が残りました。transaction の機能はありますが、1 回に扱える item 数や大きさに上限があります

1 件の item は 400 KB まで、という上限もあります。画像のような大きなデータは item に入れず、S3 に置きます（[07章](/ja/chapters/07-uploads.md)）。

こうした要求が中心なら、SQL のデータベースのほうが素直です。[13章](/ja/chapters/13-sql.md)で、Aurora DSQL、RDS for PostgreSQL、Aurora Serverless v2 を比べます。D1 に慣れている人には、そちらのほうが近い体験になるはずです。DynamoDB は「SQL が書けない D1」ではなく、別の種類の道具なんです。

### 複数のリージョンに置くなら

DynamoDB には、複数のリージョンに table の複製を置く global tables という機能があります。この本では実装しませんが、選ぶときに確かめることを挙げておきますね。

公式ドキュメント（読み取りの整合性のページ）によると、global tables には 2 つの整合性のモードがあります。既定のモードでは、変更は通常 1 秒以内にほかのリージョンへ複製され、リージョン間では結果整合です。もう 1 つのモードでは、書き込みが応答を返す前に、別のリージョンへ同期的に複製されます。

この章の楽観ロックがそのまま成り立つかどうかは、モードによって変わるはずです。既定のモードでは変更が非同期に複製されるので、あるリージョンでの条件の評価が、別のリージョンで行われたばかりの書き込みをまだ見ていない可能性があります。これは複製の説明からの推論で、公式ドキュメントで直接は確認していません。いずれにせよ、「global」という名前から、条件付き書き込みがリージョンをまたいで効くと推測してはいけません。使う前に、モード、対応するリージョン、transaction の範囲を、その時点の公式ドキュメントで確かめてください。

## お金の話

金額は USD、東京リージョン、on-demand、税別です。計算の入力と単価は[料金の計算](/ja/reference/pricing.md)にあります。

誰も使っていない間にかかるのは、table の保存量だけです。東京リージョンでは最初の 25 GB が無料で、それを超えたぶんが 1 GB あたり月 USD 0.285。この無料分は、公開されている価格表の段階として載っているものです。ノートが 10 MB なら 0 です。

使われると、読み書きの単位で数えます。

| 対象 | 単価 | 数え方 |
| --- | --- | --- |
| 書き込み（write request unit） | 100 万あたり USD 0.715 | 1 KB までの item 1 件の書き込みで 1 |
| 読み取り（read request unit） | 100 万あたり USD 0.1425 | 4 KB までの item 1 件で、強整合なら 1、結果整合なら 0.5 |

月 100 万リクエストで計算してみます。内訳は一覧 70%、1 件の取得 20%、作成と更新 8%、削除 2% として、一覧は 1 回で 20 KB を結果整合で読むとします。Lambda は 256 MB、arm64 で、平均実行時間は DynamoDB を呼ぶぶんだけ 04章より長い 60 ミリ秒という仮定です。計測値ではありません。

| 対象 | 数量 | 定価 | 毎月の無料枠の適用後 |
| --- | --- | --- | --- |
| API Gateway HTTP API | 100 万件 | 1.29 | 1.29（無料枠は確認できず、引いていない） |
| Lambda のリクエストと実行時間 | 100 万件、15,000 GB 秒 | 0.40 | 0 |
| CloudWatch Logs | 0.477 GB | 0.37 | 0 |
| DynamoDB の読み取り | 195 万 unit | 0.28 | 0.28 |
| DynamoDB の書き込み | 10 万 unit | 0.07 | 0.07 |
| DynamoDB の保存 | 1 GB | 0.00 | 0.00 |
| 小計 | | **2.41** | **1.64** |

この計算でいちばん動かしやすいのは、一覧の読み取りです。全体の 100 万リクエストのうち、DynamoDB の read request unit の 9 割を一覧が使っています。1 ページの件数を減らすと減ります。レスポンスから本文を外しただけでは減りません。repository が item を本文ごと読んでいるからです。逆に、一覧を強整合にすると、この行が 2 倍になります。

競合で拒否された更新も、write request unit を消費します。この計算は競合ゼロという仮定です。

それと、この表は件数の上限を入れる前の数え方のままです。作成と削除は、席の item への書き込みが 1 回ずつ増えます。この内訳なら、多くても 10 万 unit、USD 0.07 の上乗せです。

この表に入れていないものが 2 つあります。応答のデータ転送料金と、point-in-time recovery です（有効にすると、1 GB あたり月 USD 0.228 の保存料金がかかります。この章では無効です）。

### 叩かれ続けたら

URL を知っていれば、誰でも、何回でも呼べます。止めるものは 4 つあります。stage のスロットリング（API 全体で 1 秒に 10 件）、table の上限（1 秒に読み取り 150 unit、書き込み 40 unit）、ノートの件数（100 件）、レスポンスの大きさ（一覧は 20 KiB まで、ノート 1 件は 64 KiB まで）です。

1 秒 10 件が 30 日続くと、2,592 万件です。上の表と同じ仮定で、定価はこうなります。DynamoDB の 2 行は、table の上限に 30 日ずっと張り付いた場合の値にしました。大きなノートばかりを読み書きされたときの天井です。

| 対象 | 定価 |
| --- | --- |
| API Gateway HTTP API のリクエスト（2,592 万件） | 33.44 |
| Lambda のリクエストと実行時間（388,800 GB 秒） | 10.37 |
| CloudWatch Logs（12.36 GB） | 9.49 |
| DynamoDB の読み取り（3 億 8,880 万 unit） | 55.40 |
| DynamoDB の書き込み（1 億 368 万 unit） | 74.13 |
| DynamoDB の保存（100 件） | 0.00 |
| 合計 | **182.83** |

月に USD 183 ほど。throttling が効いていなかったとしても、DynamoDB のぶんは下の 3 行の USD 129.53 で止まります。API Gateway と Lambda のぶんは止まりません。

入っていないものは、04章と同じです。レスポンスのデータ転送は 04章と同じ計算で、一覧は 20 KiB までなので 30 日で USD 56 ほど、2,592 万件がすべて 64 KiB のノート 1 件だったとしても USD 180 ほどです。いちばん大きなノートばかりの一覧は 1 回で 77 unit ほどを読むので、table の読み取りの上限が先に効いて 1 秒に 2 回ほどしか通らないはずですが、確かめていません。実行時間の 60 ミリ秒も仮定です。table の上限に当たると SDK がやり直すので、そのぶん長くなります。

件数の上限には、但し書きが 2 つあります。いまは全員が同じ持ち主（`anonymous`）なので、100 件は「API 全体で 100 件」です。誰かが埋めれば、ほかの人は作れません。そして、誰でも消せます。量は絞れても、誰のノートかは区別できていないんです。それは 06章の仕事です。

IP アドレスごとに止めたいなら AWS WAF ですが、HTTP API には付けられないので、手前に CloudFront を置く構成になります。[21章](/ja/chapters/21-security.md)の web ACL は月 USD 8.00 と、リクエスト 100 万件あたり USD 0.60。その構成は、この本では作っていません。

stack を消せば、table も一緒に消えます。残りません。

## ハマりどころ

| こうなったら | ここを見る |
| --- | --- |
| `dev:notes` が `Invalid environment` で止まり、`NOTES_STORE` と出る | `examples/05-dynamodb/.env` はありますか |
| `NOTES_STORE=dynamodb` で起動して、最初のリクエストが 500 になる | DynamoDB Local は動いていますか（`db:local:start`）。table は作りましたか（`db:migrate:local`）。ログの `ResourceNotFoundException` を探す |
| デプロイ後、500 でログに `AccessDeniedException` | 実行 role に無い操作を呼んでいます。メッセージに操作名（`dynamodb:Scan` など）と table の ARN が出ます |
| デプロイ後、500 でログに `ResourceNotFoundException` | `TABLE_NAME` が指す table がありません。別のリージョンを見ていませんか |
| 更新が必ず 409 になる | 送っている `expectedVersion` は、直前に受け取ったノートの `version` ですか。作成の応答ではなく、最後の更新の応答の値を使います |
| 作ったノートが直後の一覧に出ない | 結果整合の読み取りでは起こり得ます。「読み取りの整合性を選ぶ」のとおりです |
| 一覧が途中で終わる | `nextCursor` が `null` になるまで読んでいますか |
| `GET /notes?limit=100` が 400 になる。一覧のノートに `body` が無い | 1 ページは 20 件までで、一覧は本文を載せません。続きは `nextCursor` で、本文は `GET /notes/:id` で取ります |
| ログに throttling を示すエラーが出る | この stack は table に上限を付けています（1 秒に読み取り 150 unit、書き込み 40 unit）。大きなノートを続けて読み書きすると当たります。それとは別に、新しい on-demand の table が受けられる流量には、初期の上限があります |
| `{"message":"Too Many Requests"}` のような 429 が返る | stage の throttling です。API 全体で 1 秒に 10 件を超えました。自分が叩いていなくても、ほかの誰かのぶんで起きます |
| `POST /notes` が 409 と `quota_exceeded` | ノートが 100 件あります。1 件消すと空きます。消しても空かないなら、席の item（`sk` が `QUOTA`）の `noteCount` が実際の件数より多くなっています |

## 本番にするなら

- **認証と、持ち主ごとの分離を足す。** いまは全員が同じノートを読み書きして、誰でも消せます（06章）
- **table を守る。** `removalPolicy` を `RETAIN` にして、削除保護と point-in-time recovery を有効にします。うっかり消したデータを戻す手順は [22章](/ja/chapters/22-recovery.md)で練習します
- **流量の上限を、自分の API に合わせる。** stage の 1 秒 10 件も、table の 150 と 40 も、練習用の値です。上げるときは、「叩かれ続けたら」の計算をやり直してください
- **本文を別の item に分ける。** 一覧のレスポンスは本文を載せませんが、DynamoDB からは本文ごと読んでいます。一覧の読み取りの料金を減らすなら、本文を別の item に置きます
- **作成を冪等にする。** 再試行で重複する問題を直します。呼び出し側が `Idempotency-Key` のような値を送り、サーバーがそれを鍵に条件付きで書く形です。この本では実装していません。同じ考え方を、[08章](/ja/chapters/08-async.md)が S3 のイベントを処理する worker で使っています
- **throttling と失敗を見張る。** DynamoDB のエラーと、409 の割合を見ます（[19章](/ja/chapters/19-observability.md)）。409 が多いなら、画面の作りか、ノートの分け方を見直す合図です
- **反映の経路を AWS CDK CLI と CloudFormation にする。** 02章で話したとおりです

## 片付け

<!-- section: 05.cleanup -->

```bash
vp run notes:infra:destroy
vp run db:local:stop
```

`notes:infra:destroy` で、table、関数、role、API、log group が消えます。table の中のノートもすべて消えて、戻せません。この stack は backup を取っていないので、そこだけ気をつけてください。

`db:local:stop` は、手元の DynamoDB Local のコンテナを消します。メモリに置く設定で起動しているので、中身も一緒に消えます。

残るのは、cdkd の bootstrap で作った保存場所（02章）と、そこに置かれたデプロイ用のファイルだけです。

::: details この章の検証メモ

**手元で確かめたこと。** contract test（メモリ）、DynamoDB へのリクエストの検査、アプリと client のテスト、インフラの assertion。型検査。synth（AWS SDK を含む bundle）。`dev:notes` をメモリで起動して、本文の `curl` を実行。一覧が本文を返さないこと、1 ページが 20 件で止まること、いちばん大きい題名を並べても 20 KiB を超えないことは、テストで固定しました。件数の上限を入れたあと、`test/dynamodb-local.test.ts` の 15 件（repository の規則 10 件と、件数の上限 5 件）を DynamoDB Local 3.3.1 に対して実行しました。Docker ではなく、AWS が配布する jar を Java で直接起動し、table は `scripts/local-db.ts migrate` で作っています。

**まだ確かめていないこと。** DynamoDB Local を Docker で動かすタスク（`db:local:start`、`db:local:stop`）は、Docker の daemon が使えなかったため、実行していません。`db:migrate:local`、`db:seed:local`、`db:reset:local`、`test:local:dynamodb` も、タスクとしては流していません。`notes:infra:diff`、`notes:infra:deploy`、`notes:smoke`、`notes:infra:drift`、`notes:infra:destroy` も、実際の AWS では動かしていません。

したがって、この章の中心である「条件付き書き込みが同時の書き込みを決まった数だけ通す」ことは、実際の DynamoDB の上では一度も確かめていません。確かめたのは、正しい条件式を送っていること、メモリの実装と DynamoDB Local が同じ規則に従うことです。DynamoDB の挙動についての記述は、公式ドキュメントに基づきます。

流量の上限も同じです。template に `OnDemandThroughput` と stage の `DefaultRouteSettings` が入っていることはテストで固定し、固定した版の cdkd（0.296.28）のソースがどちらも AWS の API に渡していることは読みました。実際に反映されること、table の上限に当たったときに返るエラーと SDK のやり直し方、上限より大きな 1 回の読み書きが通るかどうか、429 に料金がかかるかどうかは、確かめていません。「叩かれ続けたら」の金額は、単価と設定から計算しただけで、負荷をかけて測った値ではありません。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 読み方から key を決める | `examples/05-dynamodb/src/dynamodb-repository.ts`、`src/id.ts`、`src/notes.ts` | `test:unit` |
| 契約に version を足す | `examples/05-dynamodb/src/contract.ts` | `test:unit` |
| 保存先を差し替える | `examples/05-dynamodb/src/repository.ts`、`src/memory-repository.ts`、`src/dynamodb-repository.ts`、`src/compose.ts` | `test:unit` |
| 上書きを防ぐ: 条件付き書き込み、件数に上限を付ける | `examples/05-dynamodb/src/dynamodb-repository.ts`、`src/memory-repository.ts`、`src/notes.ts`、`src/app.ts`、`src/contract.ts`、`test/repository-contract.ts`、`test/dynamodb-repository.test.ts` | `test:unit` |
| 読み取りの整合性を選ぶ | `examples/05-dynamodb/src/dynamodb-repository.ts`、`test/dynamodb-repository.test.ts` | `test:unit` |
| 取りこぼさずにページを送る | `examples/05-dynamodb/src/repository.ts`、`src/app.ts`、`src/contract.ts`、`test/app.test.ts` | `test:unit` |
| 応答が届かなかったら | `examples/05-dynamodb/src/client.ts`、`test/app.test.ts` | `test:unit` |
| 手元で動かす | `examples/05-dynamodb/src/dev.ts`、`src/env.ts`、`test/env.test.ts`、`scripts/local-db.ts`、`test/fixtures/seed-notes.json`、`.env.example` | `dev:notes`、`db:local:start`、`db:migrate:local`、`db:seed:local`、`db:reset:local`、`db:local:stop` |
| テスト | `examples/05-dynamodb/test/`、`scripts/test-local.ts` | `test:unit`、`test:local:dynamodb` |
| AWS にのせる準備 | `examples/05-dynamodb/infra/lib/notes-stack.ts`、`infra/bin/app.ts`、`infra/test/notes-stack.test.ts`、`cdk.json` | `notes:infra:synth`、`test:unit` |
| デプロイして確かめる | `examples/05-dynamodb/src/lambda.ts`、`scripts/smoke.ts`、`tools/src/infra/` | `notes:infra:diff`、`notes:infra:deploy`、`notes:smoke`、`notes:infra:drift` |
| 片付け | `tools/src/infra/` | `notes:infra:destroy`、`db:local:stop` |
| お金の話 | `data/pricing/`、`tools/src/pricing/calc.test.ts` | `test:unit` |

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
