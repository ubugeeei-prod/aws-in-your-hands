---
title: "58 Ledger: 費用、注意点、片付け"
---

# 58 Ledger: 費用、注意点、片付け

章の最後のページです。料金、つまずきやすいところ、本番にする前に変えること、そして片付けをまとめます。片付けには、この章だけの注意があります。

## 料金

<!-- section: 58.cost -->

金額は USD、東京リージョン、オンデマンド、税別です。計算の入力と単価は[料金の計算](/ja/reference/pricing.md)にあります。単価は、2026-10-13 に AWS Price List の bulk API で確かめました。

既定のスタックには、時間で課金されるリソースがありません。ただし、ダイジェストの関数は、追記が無くても 1 時間ごとに動きます。1 回につき、S3 にバージョンの一覧を 1 回、最新のダイジェストの取得を 1 回、テーブルに `Query` を 1 回送ります。追記の無い月の定価は **USD 0.01**、毎月の無料枠を引くと **USD 0.00** です。内訳でいちばん大きいのは、730 回の `ListObjectVersions` の USD 0.0034 です。

月に 10 万件を追記する場合で計算します。記録 1 件は 300 バイト前後で、追記 1 回は、末尾を読む `Query` 1 回と書き込み 1 回です。ダイジェストは 1 時間ごとに 730 回、全体の監査は月に 1 回としました。関数は 256 MB で 0.5 秒と仮定しています。計測値ではありません。

| 対象 | 数量 | 定価 | 毎月の無料枠の適用後 |
| --- | --- | --- | --- |
| DynamoDB の書き込み | 10 万ユニット | 0.07 | 0.07 |
| DynamoDB の読み取り | 11.6 万ユニット | 0.02 | 0.02 |
| DynamoDB の保存 | 0.03 GB | 0.00 | 0.00 |
| S3 の PUT と LIST | 1,461 件 | 0.01 | 0.01 |
| S3 の GET | 1,460 件 | 0.00 | 0.00 |
| S3 の保存 | 0.001 GB | 0.00 | 0.00 |
| Lambda のリクエストと実行時間 | 730 件、91 GB 秒 | 0.00 | 0 |
| CloudWatch Logs | 0.0002 GB | 0.00 | 0 |
| 小計 | | **0.10** | **0.10** |

料金のほとんどは、追記そのものです。台帳にしたことで増えたのは、追記のたびに末尾を読む 1 ユニットと、1 時間ごとの S3 へのリクエストで、合わせても数セントです。

この計算に入れていないものがあります。番号の取り合いによるやり直しは 0 と仮定しました。断られた書き込みも、ユニットを使います。PartiQL の `INSERT` が `PutItem` と同じユニットで課金されるかは、確認していません。1 時間ごとのルールが関数を呼ぶこと自体の料金は、価格表のどの項目に当たるかを確認できなかったので、入れていません。月に 730 回です。Object Lock そのものに料金がかかるかどうかも、料金ページでは確かめていません。価格表のファイルに、Object Lock の名前の付いた項目はありませんでした。

ダイジェストは、追記のあった時間にだけ増えます。1 件は 150 バイトほどですが、関数は毎回すべてのバージョンを一覧するので、ダイジェストが 1,000 件を超えるごとに、1 回の実行の `ListObjectVersions` が 1 ページずつ増えます。1 年ぶん、8,760 件がたまると 9 ページで、月に 6,570 リクエスト、USD 0.03 です。全体の監査は、台帳の記録をすべて読みます。4 KB につき 1 ユニットなので、100 万件、300 MB で 75,000 ユニット、USD 0.01 です。

スタックを消したあとも、バケットとダイジェストは残り、保存の料金がかかり続けます。この規模なら、表示される金額は 0 のままです。compliance モードで長い期間を指定した場合は、その日まで消せないことを、金額とは別に覚えておいてください。

## つまずきやすいところ

| こうなったら | ここを見る |
| --- | --- |
| `ledger:verify` が `digest_mismatch` を返す | その番号より前のどこかが、ダイジェストを取ったあとで書き換えられています。22章のバックアップから戻した写しを別の台帳として検証し、同じダイジェストと合うものを探します |
| `truncated` を返す | 末尾が消えています。ダイジェストは、少なくともその番号まで記録があったことを示しています |
| `digest_hidden` を返す | 誰かがダイジェストに削除マーカーを置きました。中身は残っています。CloudTrail で、誰が置いたかを調べます |
| 関数が `LedgerDamagedError` で失敗し続ける | 前回のダイジェストから先が合っていません。ログの `findings` を見ます。直るまで、新しいダイジェストは書かれません |
| `BusyError` が出る | 同じ台帳への追記が重なり、5 回続けて番号を取られました。台帳を分けるか、追記を 1 か所に集めます |
| `BrokenTailError` が出る | 末尾の行が記録として読めません。誰かが書き換えています。追記を止めて、検証します |
| デプロイ後、追記が `AccessDeniedException` になる | 書き手のロールに `AppendAccess` のポリシーが付いているかを確かめます。`dynamodb:PutItem` を足して直してはいけません |
| ダイジェストの `PutObject` が断られる | 関数のロールが書けるのは `digests/notes/` の下だけです。台帳の名前を変えたなら、スタックの `LEDGER` も変えます |
| スタックを消したのにバケットが残っている | 仕様です。下の「片付け」を見てください |

## 本番にするなら

- 保持のモードと期間を決めます。期間は、「書き換えがあったことを、何年あとまで示せる必要があるか」です。ある書き換えを見つけられるのは、その書き換えより前に取られ、まだ消されていないダイジェストが 1 つでもあるあいだです。governance モードにするなら、`s3:BypassGovernanceRetention` を持つ人を数えられる状態にします
- ダイジェストのバケットを、別のアカウントに置きます。アプリのアカウントの管理者が、証拠に触れないようにするためです（33章）
- テーブルを守ります。`removalPolicy` を `RETAIN` にし、削除保護と point-in-time recovery を有効にします（22章）。台帳が消されたとき、ダイジェストは消されたことを教えてくれますが、記録を戻してはくれません
- 関数の失敗にアラームを付けます（19章）。失敗は、台帳が合わなくなったという知らせです
- 全体の監査を、定期的に、運用者とは別の人が実行します。監査を誰も実行しなければ、ダイジェストは置いてあるだけです
- スケジュールの間隔を、守られない時間として許せる長さにします
- 証跡で、テーブルとバケットのデータイベントを記録します（21章）。誰が書き換えたかを教えてくれるのは、ハッシュではなく CloudTrail です
- 記録に個人のデータを入れません。消せないからです
- 反映の経路を AWS CDK CLI と CloudFormation にします。02章で説明したとおりです

## 片付け

<!-- section: 58.cleanup -->

```bash
vp run ledger:infra:destroy
vp run ledger:purge --bucket <DigestBucketName>
vp run ledger:purge --bucket <DigestBucketName> --apply
```

`ledger:infra:destroy` で、テーブル、関数、ロール、ポリシー、ルール、ロググループが消えます。テーブルの記録は戻せません。

**ダイジェストのバケットは消えません。** 中のバージョンは、書かれてから保持期間が過ぎるまで、誰にも消せないか、特別な権限がないと消せません。既定の設定では、最後のダイジェストが書かれてから 1 日です。compliance モードで期間を指定した場合は、その期間です。期限の前に消す方法は、governance モードなら `s3:BypassGovernanceRetention` を使うこと、compliance モードなら AWS アカウントを閉じることしかありません。

`ledger:purge` は、バケットのすべてのバージョンを調べ、ロックの期限が過ぎたものと、まだのものを数えます。`--apply` を付けなければ、何も消しません。

<<< @/examples/58-ledger/src/purge.ts{plan}

`--apply` を付けると、期限が過ぎたバージョンと削除マーカーを消し、ロック中のものが 1 つも無ければ、バケットも消します。ロック中のものが残っていれば、最後の期限を表示して終わります。その時刻のあとで、もう一度実行してください。このタスクは、ロックを外すリクエストを送りません。

バケットにダイジェストを 1 件も書かなかった場合は、すぐに消せます。

`db:local:start` で DynamoDB Local を起動していたら、`vp run db:local:stop` で止めます。05章のテーブルも一緒に消えます。

残るのは、cdkd の bootstrap で作った保存場所（02章）と、そこに置かれたデプロイ用のファイルです。

::: details この章の検証メモ

**手元で確かめたこと。** `examples/58-ledger` のテスト（83 件が通り、DynamoDB Local 用の 1 件はスキップ）、型検査、`ledger:infra:synth`（リソース 12 個、AWS SDK を含むバンドル込み）を実行しました。`ledger:demo` を実行し、本文の出力はその実行のものです。ハッシュの固定値は、`shasum -a 256` でも同じ値になることを確かめました。ジャーナルの規則 5 件を PartiQL の `INSERT` と条件付きの `PutItem` の両方で、加えて追記から監査までの 1 件を、DynamoDB Local 3.3.1 に対して実行しました（11 件）。Docker は使わず、AWS が配布する jar を Java 21 で直接起動しています（ポート 8058、`-inMemory -sharedDb -disableTelemetry`）。`ledger:db:reset:local` と `ledger:test:local` は、環境変数 `DYNAMODB_ENDPOINT` でこのポートを指して、タスクとして実行しました。

**まだ確かめていないこと。** AWS には一度もデプロイしていません。`ledger:infra:diff`、`ledger:infra:deploy`、`ledger:append`、`ledger:digest`、`ledger:verify`、`ledger:infra:drift`、`ledger:infra:destroy`、`ledger:purge` は実行していません。DynamoDB Local を Docker で起動する `db:local:start` も、この章のためには実行していません。

したがって、次のことは実物の上では確かめていません。実際の DynamoDB が、重複した PartiQL の `INSERT` に `DuplicateItemException` を返すこと。DynamoDB Local 3.3.1 は `DuplicateItem` という名前で返したので、コードは両方を受けています。`dynamodb:PartiQLInsert` と `dynamodb:Query` だけのロールで、追記が通り、上書きが通らないこと。PartiQL の `INSERT` の課金単位。既定の保持期間だけを持つバケットへの `PutObject` が、`s3:PutObject` の権限だけで通り、ロックがかかること。SDK が付けるチェックサムで、Object Lock のバケットへの `PutObject` が受け付けられること。`If-None-Match` に対する 412。`ListObjectVersions` の応答の形。ロック中のバージョンの削除が 403 になることと、governance モードの解除。ロックの無いバージョンに対して `GetObjectRetention` が返すエラーの名前（`ledger:purge` は `NoSuchObjectLockConfiguration` を想定しています）。cdkd が Object Lock つきのバケット、ルール、Lambda の権限を実際に作れることと、`destroy` が `RETAIN` のバケットを残すこと。

Object Lock、バージョニング、条件付きの書き込みについての記述と、メモリ上のバケットのモデルは、S3 のユーザーガイドだけに基づいています。QLDB の開発者ガイドは 404 で読めなかったので、QLDB の説明は、AWS のブログ記事 2 本（日本語訳）だけに基づいています。料金の表は、単価と仮定から計算した値で、測った値ではありません。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 証明できることと、できないこと | `examples/58-ledger/test/verify.test.ts` | `test:unit` |
| 記録とハッシュ | `examples/58-ledger/src/entry.ts`、`src/journal.ts`、`test/entry.test.ts`、`test/journal-contract.ts` | `test:unit`、`ledger:test:local` |
| 番号を条件付き書き込みで守る | `examples/58-ledger/src/ledger.ts`、`test/ledger.test.ts` | `test:unit` |
| 書き手に上書きの権限を渡さない | `examples/58-ledger/src/dynamodb-journal.ts`、`infra/lib/ledger-stack.ts`、`test/adapters.test.ts`、`test/dynamodb-local.test.ts` | `test:unit`、`ledger:test:local` |
| ダイジェストを Object Lock のバケットに置く | `examples/58-ledger/src/digest.ts`、`src/s3-digests.ts`、`src/memory-digests.ts`、`src/digest-lambda.ts`、`test/digest.test.ts`、`test/memory-digests.test.ts`、`test/digest-lambda.test.ts` | `test:unit` |
| 検証 | `examples/58-ledger/src/verify.ts`、`src/audit.ts`、`test/verify.test.ts` | `test:unit` |
| 記録する中身 | `examples/58-ledger/src/events.ts`、`test/events.test.ts` | `test:unit` |
| 書き換えを再現する | `examples/58-ledger/scripts/demo.ts`、`scripts/local-db.ts`、`.env.example` | `ledger:demo`、`ledger:db:migrate:local`、`ledger:db:reset:local` |
| テスト | `examples/58-ledger/test/`、`infra/test/ledger-stack.test.ts`、`scripts/test-local.ts` | `test:unit`、`ledger:test:local` |
| スタック | `examples/58-ledger/infra/lib/ledger-stack.ts`、`infra/bin/app.ts`、`infra/test/ledger-stack.test.ts`、`cdk.json` | `ledger:infra:synth`、`test:unit` |
| デプロイして確かめる | `examples/58-ledger/scripts/ledger.ts` | `ledger:infra:diff`、`ledger:infra:deploy`、`ledger:append`、`ledger:digest`、`ledger:verify`、`ledger:infra:drift` |
| 料金 | `data/pricing/` | `test:unit` |
| 片付け | `examples/58-ledger/scripts/ledger.ts`、`src/purge.ts`、`test/purge.test.ts` | `ledger:infra:destroy`、`ledger:purge` |

**一次情報**（確認日はすべて 2026-10-13）

- QLDB の状態: [Services in Full Shutdown](https://docs.aws.amazon.com/general/latest/gr/full_shutdown_services.html)、[Services in Sunset](https://docs.aws.amazon.com/general/latest/gr/sunset_services.html)、[QLDB の製品ページ](https://aws.amazon.com/qldb/)（Aurora のページへ転送されます）、[監査のユースケースで Amazon QLDB を Amazon Aurora PostgreSQL に置き換える](https://aws.amazon.com/jp/blogs/news/replace-qldb-with-amazon-aurora-postgresql/)、[Amazon QLDB の Amazon Aurora PostgreSQL への移行](https://aws.amazon.com/jp/blogs/news/amazon-qldb-to-aurora-postgresql/)
- DynamoDB: [PartiQL insert statements](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ql-reference.insert.html)、[IAM security policies with PartiQL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ql-iam.html)、[IAM のサービスリファレンス（DynamoDB）](https://servicereference.us-east-1.amazonaws.com/v1/dynamodb/dynamodb.json)、[Logging DynamoDB operations by using AWS CloudTrail](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/logging-using-cloudtrail.html)、[Deploying DynamoDB locally](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.DownloadingAndRunning.html)
- S3: [Locking objects with Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html)、[Configuring S3 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-configure.html)、[How to prevent object overwrites with conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)、[ListObjectVersions（API リファレンス）](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectVersions.html)、[IAM のサービスリファレンス（S3）](https://servicereference.us-east-1.amazonaws.com/v1/s3/s3.json)
- 道具: [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)（インストールしたパッケージの中身を読みました）
- 料金: AWS Price List bulk API の [DynamoDB](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonDynamoDB/current/ap-northeast-1/index.json)、[S3](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ap-northeast-1/index.json)、[EventBridge](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSEvents/current/ap-northeast-1/index.json)
- Cloudflare と Vercel: [R2: Bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/)、[Vercel Blob](https://vercel.com/docs/vercel-blob)

:::
