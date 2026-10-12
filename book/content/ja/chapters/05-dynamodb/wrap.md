---
title: "05 KV Store: 費用、注意点、片付け"
---

# 05 KV Store: 費用、注意点、片付け

## DynamoDB が合わないとき

<!-- section: 05.fit -->

この章の設計がうまくいったのは、読み方が 2 つしかなかったからです。次のような要求が出てきたら、DynamoDB では苦しくなります。

- あとから増える、決まっていない検索。「本文に特定の語を含むノート」「先月更新されたノートを全員分」のような条件は、key に入っていないので、table を全部読むことになります
- 複数の種類のデータをまたぐ集計や結合
- 複数の item にまたがる制約。「この利用者のノートは 100 件まで」のような決まりは、1 件の条件付き書き込みでは守れません。transaction の機能はありますが、1 回に扱える item 数や大きさに上限があります

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

この計算でいちばん動かしやすいのは、一覧の読み取りです。全体の 100 万リクエストのうち、DynamoDB の read request unit の 9 割を一覧が使っています。1 ページの件数を減らすか、一覧に本文を含めないようにすると減ります。逆に、一覧を強整合にすると、この行が 2 倍になります。

競合で拒否された更新も、write request unit を消費します。この計算は競合ゼロという仮定です。

この表に入れていないものが 2 つあります。応答のデータ転送料金と、point-in-time recovery です（有効にすると、1 GB あたり月 USD 0.228 の保存料金がかかります。この章では無効です）。

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
| ログに throttling を示すエラーが出る | 新しい on-demand の table が受けられる流量には、初期の上限があります。急に大量の流量をかけていませんか |

## 本番にするなら

- **認証と、持ち主ごとの分離を足す。** いまは全員が同じノートを読み書きします（06章）
- **table を守る。** `removalPolicy` を `RETAIN` にして、削除保護と point-in-time recovery を有効にします。うっかり消したデータを戻す手順は [22章](/ja/chapters/22-recovery.md)で練習します
- **流量の上限を決める。** on-demand の table には、1 秒あたりの読み書きの最大値を設定できます。上限のない公開 API は、料金の上限もありません
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

**手元で確かめたこと。** contract test（メモリ）、DynamoDB へのリクエストの検査、アプリと client のテスト、インフラの assertion。型検査。synth（AWS SDK を含む bundle）。`dev:notes` をメモリで起動して、本文の `curl` を実行。

**まだ確かめていないこと。** DynamoDB Local を使うタスク（`db:local:start`、`db:migrate:local`、`db:seed:local`、`db:reset:local`、`db:local:stop`、`test:local:dynamodb`）は、執筆時に Docker の daemon が使えなかったため、実行していません。`notes:infra:diff`、`notes:infra:deploy`、`notes:smoke`、`notes:infra:drift`、`notes:infra:destroy` も、実際の AWS では動かしていません。

したがって、この章の中心である「条件付き書き込みが同時の更新を 1 つだけ通す」ことは、DynamoDB の上では一度も確かめていません。確かめたのは、正しい条件式を送っていることと、メモリの実装が同じ規則に従うことです。DynamoDB の挙動についての記述は、公式ドキュメントに基づきます。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 読み方から key を決める | `examples/05-dynamodb/src/dynamodb-repository.ts`、`src/id.ts`、`src/notes.ts` | `test:unit` |
| 契約に version を足す | `examples/05-dynamodb/src/contract.ts` | `test:unit` |
| 保存先を差し替える | `examples/05-dynamodb/src/repository.ts`、`src/memory-repository.ts`、`src/dynamodb-repository.ts`、`src/compose.ts` | `test:unit` |
| 上書きを防ぐ: 条件付き書き込み | `examples/05-dynamodb/src/dynamodb-repository.ts`、`src/app.ts`、`test/repository-contract.ts`、`test/dynamodb-repository.test.ts` | `test:unit` |
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
