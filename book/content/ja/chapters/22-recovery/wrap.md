---
title: "22 Backup: 費用、注意点、片付け"
---

# 22 Backup: 費用、注意点、片付け

章の最後のページです。Cloudflare D1 との違い、料金、つまずきやすいところ、本番で足すもの、片付けの順に書きます。

## D1 の Time Travel から来た人へ

<!-- section: 22.cloudflare -->

Cloudflare D1 を使ってきた人は、ここまで読んで、手数が多いと感じたはずです。実際に、手数は D1 より多くなります。

D1 の Time Travel は最初から有効で、追加の料金がかかりません。過去 30 日（Workers Free plan では 7 日）の、分単位の時刻に戻せます。戻すとデータベースがその場で上書きされ、新しいデータベースはできません。binding も名前もそのままなので、切り替えの仕事がありません。

DynamoDB の PITR は、自分で有効にして、テーブルの大きさに応じた料金を払います。粒度は秒で、戻せるのは最大 35 日です。そして、必ず新しいテーブルができます。

どちらが良いかは、何を恐れるかによります。その場で上書きする復元は、速くて簡単です。その代わり、戻した瞬間に、いまのデータが見えなくなります。D1 は、戻す前の状態に帰るための bookmark を返すので、取り消しはできます。しかし、戻した結果と戻す前の状態を、並べて見比べることはできません。ドキュメントは、データベースを複製する機能はまだないと書いています。新しいテーブルを作る復元は、遅くて面倒です。その代わり、元のテーブルと並べて差分を数えてから、切り替えるかどうかを決められます。この章の `recovery:diff` は、その差分を数えています。

R2 については、S3 互換 API の対応表で、バージョニングの API（`GetBucketVersioning`、`PutBucketVersioning`）が未対応になっているところまでを確かめました。R2 にほかの復元の手段があるかは、調べていません。

D1 と R2 を組み合わせているなら、この章で長く扱った食い違いの話は、そのまま当てはまります。データベースを 10 分前に戻しても、バケットは戻りません。

## 料金

<!-- section: 22.cost -->

金額は USD、東京リージョン、従量課金、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

この章の訓練そのものが扱うのは、ノート 3 件と、33 バイトの画像 3 枚です。下の単価に当てはめると、1 セントに届きません。ただし、小さな量に最小の課金があるかどうかは、確かめていません。

金額の見当がつく大きさとして、テーブルが 1 GB、画像が 10 GB の場合を計算します。

最初の表は、戻せる状態を保つために上乗せされる料金です。テーブルや画像そのものの保存料は入れていません。

| 対象 | 月額 |
| --- | --- |
| PITR（1 GB のテーブル） | 0.23 |
| 古いバージョン（月に 1 GB ぶんが上書き・削除され、30 日残る） | 0.03 |
| 小計 | **0.25** |

PITR の単価は、1 GB・月あたり USD 0.228 です。料金はテーブルの大きさで決まり、戻せる日数を 35 日から 1 日に縮めても変わらないと、ドキュメントにあります。古いバージョンは、ふつうのオブジェクトと同じ単価で、1 つずつ丸ごと課金されます。3 回上書きした画像には、4 枚ぶんの料金がかかります。

次の表は、訓練を 1 回実行したときの料金です。

| 対象 | 定価 |
| --- | --- |
| 復元（1 GB） | 0.17 |
| 検査の `Scan`（1 GB を 4 回） | 0.15 |
| 復元したテーブルを 1 か月置いた場合の保存料（1 GB） | 0.00 |
| 小計 | **0.32** |

復元は、戻したデータ 1 GB あたり USD 0.171 です。検査は、テーブル全体を強い整合性で読むので、1 GB で約 26 万 read request unit を使い、4 回で USD 0.15 になります。テーブルが 100 倍になれば、検査 1 回が約 USD 3.7 になります。08章の掃除と同じで、**突き合わせの費用は、置いてあるものの量に比例します。**

保存料が 0.00 なのは、DynamoDB の保存料の最初の 25 GB が USD 0 の段だからです。アカウントの合計が 25 GB を超えていれば、1 GB あたり USD 0.285 かかります。金額よりも気をつけたいのは、復元したテーブルがスタックの外にあって、**スタックを消しても残る**ことです。PITR を付け直していれば、その料金も続きます。

最後の表は、指定したときだけ増える料金です。

| 構成 | 月額 |
| --- | --- |
| `-c backup=on`（1 GB のテーブル、毎日 1 回、7 日保持） | 0.80 |
| `-c replica=on`（画像 10 GB と古いバージョン 1 GB の写し、月 10,000 個の複製） | 0.32 |

AWS Backup は、1 GB・月あたり USD 0.114 です。0.80 は、7 つのスナップショットがそれぞれテーブル全体の大きさで課金されると仮定した数字です。差分で取られるのかどうかは、確かめていません。複製にかかるのは、2 つ目の保存料と、複製のリクエストの料金です。料金ページによると、同じリージョン内の複製には、データ転送の項目がありません。複製のリクエストは、通常の PUT と同じ単価として計算しました。

無料枠は、どの表でも引いていません。復元と AWS Backup に無料枠があるかどうかは、調べていません。

## つまずきやすいところ

| こうなったら | ここを見る |
| --- | --- |
| `recovery:restore:table` が「outside what can be restored」と言う | 指定した時刻が `latest restorable` より後です。`recovery:status` で確かめて、数分待ちます |
| `recovery:restore:table` が「not enabled」と言う | テーブルの PITR が無効です。この章のスタックでデプロイしたテーブルかどうかを確かめます |
| 復元したテーブルが、いつまでも `ACTIVE` にならない | 時間は、データの量とインデックスの数で変わります。保証された時間はありません。元のテーブルは、その間も使えます |
| `recovery:restore:objects` の計画が空 | `--at` の時刻が事故より前かどうか、時刻を UTC で渡しているかどうかを確かめます |
| 消したはずのオブジェクトの削除マーカーが、消すたびに増える | バージョン ID なしで削除マーカーを消そうとしています。削除マーカーが積まれるだけです |
| `recovery:verify` が、事故の直後なのに 0 件 | 正常です。きれいに消えたデータは、食い違いません |
| `recovery:verify` が、復元の直後に `object_without_record` を大量に出す | 復元の時刻より後のアップロードです。`--frozen` を付けていなければ、1 時間たつと出てきます |
| `recovery:audit` が、切り替えたのに元のテーブルの名前を言う | `-c table=` を付けてデプロイしたか、`cdk.json` に書いたかを確かめます |
| 関数が `AccessDenied` で失敗する | 環境変数だけを書き換えた場合に起きます。権限は、コンテキストを通して環境変数と一緒に変えます |
| `recovery:infra:destroy` が、バケットを消せない | バージョンが残っています。先に `recovery:empty --apply` を実行します |
| スタックを消したのに、DynamoDB の請求が続く | 復元したテーブルが残っています。`recovery:status` が一覧を出します |

## 本番にするなら

- **テーブルとバケットを守る設定にする。** `-c protect=on` の形で、`RETAIN` と削除保護が付きます。ただし、守れるのはテーブルそのものだけです。中身は、PITR とバージョニングが守ります。バージョンそのものを、保持期間が過ぎるまで消せなくする S3 Object Lock は、[58章](/ja/chapters/58-ledger.md)で使います
- **目標を先に決めて、訓練で確かめる。** RTO と RPO は、決めただけではただの数字で、測って初めて、足りるかどうかがわかります。テーブルが大きくなれば復元の時間も変わるので、定期的に測ります
- **事故の時刻を知る手段を持つ。** PITR は、時刻を渡せば戻してくれますが、その時刻を知っているのはあなただけです。誰が、いつ、何を消したかを追えるように、API の呼び出しを記録しておきます（道具は CloudTrail です。[21章](/ja/chapters/21-security.md)で読んだ event history は management event の記録なので、何が載るかは先に確かめておきます）
- **切り替えの間、書き込みを止める手段を持つ。** 動いているサービスの上で切り替えると、検査の猶予も、失うデータの数も、動き続けます。この章は、止める仕組みを作っていません
- **掃除を止める手順を、復旧の手順に入れる。** 08章のスケジュールは、記録を失った画像を消します
- **復元したテーブルを、ソースに戻す。** 取り込むか、作り直すかを決めます。スタックの外のテーブルで、いつまでもサービスを動かさないでください
- **version の比較に、復元の回数を混ぜる。** 番号の巻き戻りを、消されたノートも含めて塞ぎます
- **バックアップを、別のアカウントか別のリージョンにも置く。** PITR もバージョニングも、同じアカウントの同じリージョンにあります。アカウントごと失う事故には効きません。AWS Backup の cross-Region、cross-account の copy は、この章では扱っていません。リージョンが応答しなくなっても答え続ける構成は [28章](/ja/chapters/28-multi-region.md)、サーバーのディスクを別の場所へ複製し続ける AWS Elastic Disaster Recovery は [40章](/ja/chapters/40-disaster-recovery.md)で扱います
- **検査を、復旧のときだけのものにしない。** 08章の「残っている穴」のように、ふだんから少しずつ食い違いは生まれます。関数をスケジュールで動かして、`broken` が 0 でなくなったら知らせます。費用は、テーブルの大きさに比例します

## 片付け

<!-- section: 22.cleanup -->

```bash
vp run recovery:status
vp run recovery:drop-table --table <復元した table> --apply
vp run recovery:empty --apply
vp run recovery:infra:destroy
```

この順序で実行するのには、理由があります。

まず、復元したテーブルを消します。スタックの外にあるので、`destroy` では消えません。`recovery:status` が、名前に目印のあるテーブルを一覧にします。切り替えたままなら、先に `-c table=` なしでデプロイして、関数を元のテーブルに戻してください。`recovery:drop-table` は、関数がいま読んでいるテーブルを消すことを拒みます。

<<< @/examples/22-recovery/scripts/recovery.ts{drop-table}

次に、バケットを空にします。バージョニングが有効なバケットは、すべてのバージョンと削除マーカーを消すまで、空になりません。`recovery:empty --apply` を実行すると、バケットの中のものは、もう戻せません。

最後にスタックを消します。テーブル、バケット、関数、ログが消えます。PITR の記録も、テーブルと一緒に消えます。ドキュメントによると、PITR が有効だったテーブルにはシステムバックアップが 35 日残り、追加の料金はかかりません。

`-c protect=on`、`-c backup=on`、`-c replica=on` でデプロイしたスタックの片付けは、確かめていません。`protect` を付けたテーブルとバケットは、スタックを消しても残すことが目的なので、手で消すことになります。cdkd は、削除保護の付いたテーブルを、`--remove-protection` を付けない限り消さないことを、ソースで読みました。ボールトにスナップショットが残っている場合の動きは、わかりません。

訓練の記録は `reports/drills/` にあり、git の管理からは外してあります。残したい記録は、`examples/22-recovery/drill/TEMPLATE.md` の写しと一緒に、別の場所へ移してください。

## 分散システムとして見ると

状態の持ち主は 2 つあります。ノートと記録は DynamoDB が、バイトは S3 が持っていて、2 つをまたぐトランザクションはありません。07章と 08章は、書く順序と条件付きの書き込みで、途中で止まっても壊れた状態にならないようにしていました。

復元は、その工夫を素通りします。順序を守って書かれた 2 つの履歴から、別々の時刻を切り出すからです。**順序で守った約束は、時刻を巻き戻す操作の前では守られません。** 守り直すには、約束そのものを検査できる形で持っておく必要があります。この章では、`check` がその役目をします。

修復の設計は、08章のワーカーと同じ考え方です。どの手順も、自分が成り立つ条件を自分で確かめるので、2 回動いても、途中で止まっても、同じ状態に落ち着きます。違うのは、正しい順序を教えてくれるイベントがないことで、その不足は、古い記録にだけ勝つ sequencer で埋めました。

閉じていないところも書いておきます。検査は、テーブルとバケットを別々に読みます。動いているサービスの上では、2 つの読み取りの間に書き込みが入ります。猶予の時間で大半は避けられますが、消えた直後の添付が、一瞬だけ画像のない記録に見えることがあります。修復は、手を出す前にもう一度見るので、何も壊しません。ただし、報告には出ます。いちばん確かなのは、書き込みを止めて検査することです。

::: details この章の検証メモ

**手元で確かめたこと。** テーブルとバケットを別の時刻に戻したときの検出（同じ時刻、テーブルだけ、アップロードより前、上書きの後）。修復（画像の復活、バージョンが残っていない場合の記録の削除、検査のやり直し、遅れて届く本物のイベントとの順序、ドライラン、同じ検査結果での二重実行、途中での中断）。08章の「残っている穴」の形の検出と削除、検査の後に書かれた新しい記録を消さないこと。07章の掃除のコードが、復元後に記録のない画像を消すことと、消された画像をバージョンから戻せること。オブジェクトの復元の計画（消されたキー、複数の削除マーカー、上書き、後からできたキー、すでに消えていたキー、一覧の順序）と、再実行、途中での中断。version 番号の巻き戻りで古い保存が通ってしまうこと、フェンスで通らなくなること、フェンスの再実行。差分の集計。PITR の依頼の組み立てと、範囲外・無効・復元済みのテーブルの拒否。訓練の記録のテンプレートが空であること、集計、時刻の書き直しの拒否。3 つの章のリポジトリが書くアイテムの分類。05章のリポジトリのコントラクトテスト。DynamoDB と S3 へのリクエストの形。スタックのアサーション（既定の種類の一覧、PITR、バージョニングとライフサイクル、公開設定、権限、切り替えで環境変数と権限と出力が揃って変わること、`protect`・`backup`・`replica` の各構成）。型検査と synth。`recovery:demo` と `recovery:drill` の実行。加えて、コードを 6 か所わざと壊して、テストが落ちることを確かめました。

**まだ確かめていないこと。** AWS に対しては、何も実行していません。`recovery:infra:diff`、`deploy`、`drift`、`destroy`、`recovery:status`、`seed`、`accident`、`restore:table`、`restore:objects`、`diff`、`verify`、`repair`、`protect`、`audit`、`drop-table`、`empty` のどれもです。したがって、RPO と RTO の実測値はありません。次も、実物では確かめていません。PITR の復元にかかる時間と、`LatestRestorableDateTime` の遅れ。復元したテーブルに引き継がれる設定と、引き継がれない設定。削除マーカーを消した後と、バージョンをコピーした後の、ETag、`LastModified`、S3 のイベント。コピーしたバージョンの ETag が元と同じになること。`ListObjectVersions` で時刻が同じバージョンの並び。存在しないバージョン ID を指定した削除のレスポンス。`-c table=` でのデプロイの差分と、ドリフトの検査の出力。`cdkd orphan` と `cdkd import`（ヘルプを読んだだけ）。CloudFormation の resource import（ドキュメントも読めていません）。`-c protect=on`、`-c backup=on`、`-c replica=on` の作成と削除。AWS Backup のスナップショットが差分かどうか。小さな量への最小課金。DynamoDB 用と S3 用の実装は、リクエストの形をテストで固定しただけで、実物には送っていません。`recovery:seed` が書く検査の記録の sequencer は作り物で、画像は PNG の先頭 33 バイトだけです。表示できる画像ではありません。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| テーブルを過去の時刻に戻す | `examples/22-recovery/infra/lib/recovery-stack.ts`、`src/pitr.ts`、`src/memory-table.ts`、`test/pitr-drill.test.ts` | `test:unit`、`recovery:status`、`recovery:restore:table` |
| 画像はバージョンから戻す | `examples/22-recovery/src/versioned-bucket.ts`、`src/object-restore.ts`、`src/s3-versioned-bucket.ts`、`test/object-restore.test.ts` | `test:unit`、`recovery:restore:objects` |
| 2 つの置き場所は、別の時刻に戻る | `examples/22-recovery/src/invariants.ts`、`src/items.ts`、`src/audit.ts`、`test/skew.test.ts`、`test/adapters.test.ts` | `test:unit`、`recovery:demo`、`recovery:verify` |
| 食い違いを直す | `examples/22-recovery/src/repair.ts`、`test/skew.test.ts`、`test/world.ts` | `test:unit`、`recovery:repair` |
| 巻き戻った version 番号 | `examples/22-recovery/src/table-diff.ts`、`src/dynamodb-table.ts`、`test/table-diff.test.ts` | `test:unit`、`recovery:diff` |
| 手元で動かす | `examples/22-recovery/scripts/demo.ts`、`src/local.ts` | `recovery:demo`、`test:unit` |
| AWS にのせる準備 | `examples/22-recovery/infra/lib/recovery-stack.ts`、`infra/bin/app.ts`、`infra/test/recovery-stack.test.ts`、`src/audit-lambda.ts`、`cdk.json` | `recovery:infra:synth`、`test:unit` |
| 訓練を実行する | `examples/22-recovery/scripts/recovery.ts`、`scripts/context.ts`、`scripts/drill.ts`、`src/drill.ts`、`drill/TEMPLATE.md`、`drill/record.template.json` | `recovery:drill`、`recovery:seed`、`recovery:accident`、`recovery:restore:table`、`recovery:restore:objects`、`recovery:diff`、`recovery:verify`、`recovery:repair`、`recovery:protect` |
| 切り替える | `examples/22-recovery/infra/lib/recovery-stack.ts`、`infra/bin/app.ts` | `recovery:infra:diff`、`recovery:infra:deploy`、`recovery:audit`、`recovery:infra:drift` |
| 片付け | `examples/22-recovery/scripts/recovery.ts` | `recovery:drop-table`、`recovery:empty`、`recovery:infra:destroy` |
| 料金 | `data/pricing/` | `test:unit` |

**一次情報**（確認日はすべて 2026-10-12）

- [Point-in-time backups for DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Point-in-time-recovery.html)、[Enable point-in-time recovery in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/PointInTimeRecovery_Howitworks.html)、[Restoring a DynamoDB table to a point in time](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/PointInTimeRecovery.Tutorial.html)、[RestoreTableToPointInTime](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_RestoreTableToPointInTime.html)
- [Basic operations on DynamoDB tables](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/WorkingWithTables.Basics.html)（削除保護）、[How DynamoDB global tables work](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/V2globaltables_HowItWorks.html)
- [Retaining multiple versions of objects with S3 Versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html)、[Working with delete markers](https://docs.aws.amazon.com/AmazonS3/latest/userguide/DeleteMarker.html)、[Managing delete markers](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ManagingDelMarkers.html)、[Restoring previous versions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/RestoringPreviousVersions.html)、[ListObjectVersions](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectVersions.html)
- [Lifecycle configuration elements](https://docs.aws.amazon.com/AmazonS3/latest/userguide/intro-lifecycle-rules.html)、[Emptying a general purpose bucket](https://docs.aws.amazon.com/AmazonS3/latest/userguide/empty-bucket.html)、[Event notification types and destinations](https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-event-types-and-destinations.html)
- [What does Amazon S3 replicate?](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication-what-is-isnot-replicated.html)、[Replicating delete markers between buckets](https://docs.aws.amazon.com/AmazonS3/latest/userguide/delete-marker-replication.html)
- [Advanced DynamoDB backup](https://docs.aws.amazon.com/aws-backup/latest/devguide/advanced-ddb-backup.html)、[Restore a Amazon DynamoDB table](https://docs.aws.amazon.com/aws-backup/latest/devguide/restoring-dynamodb.html)
- AWS Price List bulk API: [DynamoDB](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonDynamoDB/current/ap-northeast-1/index.json)、[AWS Backup](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSBackup/current/ap-northeast-1/index.json)。[Amazon S3 pricing](https://aws.amazon.com/s3/pricing/)（複製の項目。抜粋で読みました）
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)（インストールしたパッケージの `cdkd import --help`、`cdkd orphan --help`、同梱の dist）
- [Cloudflare D1: Time Travel and backups](https://developers.cloudflare.com/d1/reference/time-travel/)、[Cloudflare R2: S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/)

:::
