---
title: "22 Backup: 費用、注意点、片付け"
---

# 22 Backup: 費用、注意点、片付け

## D1 の Time Travel から来た人へ

<!-- section: 22.cloudflare -->

Cloudflare D1 を使ってきた人は、ここまで読んで「手数が多い」と思ったはずです。そのとおりです。

D1 の Time Travel は、最初から有効で、追加の料金がかかりません。過去 30 日（Workers Free plan では 7 日）の、分単位の時刻に戻せます。そして、戻すと、database がその場で上書きされます。新しい database はできません。binding も、名前も、そのままです。切り替えの仕事がありません。

DynamoDB の PITR は、自分で有効にして、table の大きさに応じた料金を払います。粒度は秒で、最大 35 日。そして、必ず新しい table ができます。

どちらが良いかは、何を恐れるかによります。その場で上書きする復元は、速くて簡単です。そのかわり、戻した瞬間に、いまのデータが見えなくなります。D1 は、戻す前の状態に帰るための bookmark を返してくれるので、取り消しはできます。ただ、戻した結果と、戻す前を、並べて見比べることはできません。ドキュメントは、database を複製する機能はまだない、と書いています。新しい table を作る復元は、遅くて面倒です。そのかわり、元の table と並べて、差分を数えてから、切り替えるかどうかを決められます。この章の `recovery:diff` は、それをやっています。

R2 については、S3 互換 API の対応表で、versioning の API（`GetBucketVersioning`、`PutBucketVersioning`）が未対応になっているところまでを確かめました。R2 にほかの復元の手段があるかは、調べていません。

そして、D1 と R2 を組み合わせているなら、この章の本題は、そのまま当てはまります。database を 10 分前に戻しても、bucket は戻りません。

## お金の話

<!-- section: 22.cost -->

金額は USD、東京リージョン、従量課金、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

この章の drill そのものは、ノート 3 件と、33 バイトの画像 3 枚です。下の単価に当てはめると、1 セントに届きません。ただし、小さな量に最小の課金があるかどうかは、確かめていません。

意味のある大きさで見てみます。table が 1 GB、画像が 10 GB の場合です。

**戻せる状態を保つための上乗せ。** table や画像そのものの保存料は入れていません。「戻せる」ことに払う分だけです。

| 対象 | 月額 |
| --- | --- |
| PITR（1 GB の table） | 0.23 |
| 古い version（月に 1 GB ぶんが上書き・削除され、30 日残る） | 0.03 |
| 小計 | **0.25** |

PITR の単価は、1 GB・月あたり USD 0.228 です。table の大きさで決まり、戻せる日数を 35 日から 1 日に縮めても変わらないと、ドキュメントにあります。古い version は、ふつうの object と同じ単価で、1 つずつ丸ごと課金されます。3 回上書きした画像は、4 枚ぶんです。

**drill を 1 回。**

| 対象 | 定価 |
| --- | --- |
| 復元（1 GB） | 0.17 |
| 検査の `Scan`（1 GB を 4 回） | 0.15 |
| 復元した table を 1 か月置いた場合の保存料（1 GB） | 0.00 |
| 小計 | **0.32** |

復元は、戻したデータ 1 GB あたり USD 0.171 です。検査は、table 全体を強い整合性で読むので、1 GB で約 26 万 read request unit。4 回で USD 0.15 です。table が 100 倍になれば、検査 1 回が約 USD 3.7 になります。08章の掃除と同じで、**突き合わせの費用は、置いてあるものの量に比例します。**

保存料が 0.00 なのは、DynamoDB の保存料の最初の 25 GB が USD 0 の段だからです。アカウントの合計がそれを超えていれば、1 GB あたり USD 0.285 かかります。それより大事なのは、復元した table が stack の外にあって、**stack を消しても残る**ことです。PITR を付け直していれば、その分も続きます。

**頼んだときだけ増えるもの。**

| 構成 | 月額 |
| --- | --- |
| `-c backup=on`（1 GB の table、毎日 1 回、7 日保持） | 0.80 |
| `-c replica=on`（画像 10 GB と古い version 1 GB の写し、月 10,000 個の複製） | 0.32 |

AWS Backup は、1 GB・月あたり USD 0.114 です。0.80 は、7 つの snapshot がそれぞれ table 全体の大きさで課金される、と仮定した数字です。差分で取られるのかどうかは、確かめていません。複製は、2 つ目の保存料と、複製のリクエストの料金です。料金ページによると、同じリージョン内の複製には、データ転送の項目がありません。複製のリクエストは、通常の PUT と同じ単価として計算しました。

無料枠は、どの表でも引いていません。復元と AWS Backup に無料枠があるかどうかは、調べていません。

## ハマりどころ

| こうなったら | ここを見る |
| --- | --- |
| `recovery:restore:table` が「outside what can be restored」と言う | 指定した時刻が `latest restorable` より後です。`recovery:status` で確かめて、数分待ちます |
| `recovery:restore:table` が「not enabled」と言う | table の PITR が無効です。この章の stack でデプロイした table ですか |
| 復元した table が、いつまでも `ACTIVE` にならない | 時間は、データの量と index の数で変わります。保証された時間はありません。元の table は、その間も使えます |
| `recovery:restore:objects` の計画が空 | `--at` の時刻は、事故より前ですか。時刻は UTC で渡していますか |
| 消したはずの object が、消すたびに増える | version ID なしで delete marker を消そうとしています。marker が積まれるだけです |
| `recovery:verify` が、事故の直後なのに 0 件 | 正常です。きれいに消えたデータは、食い違いません |
| `recovery:verify` が、復元の直後に `object_without_record` を大量に出す | 復元の時刻より後のアップロードです。`--frozen` を付けていなければ、1 時間たつと出てきます |
| `recovery:audit` が、切り替えたのに元の table の名前を言う | `-c table=` を付けてデプロイしましたか。`cdk.json` に書きましたか |
| 関数が `AccessDenied` で失敗する | 環境変数だけを書き換えていませんか。権限は、context を通して一緒に動かします |
| `recovery:infra:destroy` が、bucket を消せない | version が残っています。`recovery:empty --apply` が先です |
| stack を消したのに、DynamoDB の請求が続く | 復元した table が残っています。`recovery:status` が一覧を出します |

## 本番にするなら

- **table と bucket を守る設定にする。** `-c protect=on` の形です。`RETAIN` と削除保護。ただし、守れるのは table そのものだけです。中身は、PITR と versioning が守ります
- **目標を先に決めて、drill で確かめる。** RTO と RPO は、決めただけでは数字です。測って初めて、足りるかどうかがわかります。table が大きくなれば、復元の時間も変わります。定期的にやります
- **事故の時刻を知る手段を持つ。** PITR は、時刻を渡せば戻してくれます。その時刻を知っているのは、あなただけです。誰が、いつ、何を消したかを追えるように、API の呼び出しを記録しておきます（道具は CloudTrail です。[21章](/ja/chapters/21-security.md)で読んだ event history は management event の記録なので、何が載るかは先に確かめておきます）
- **切り替えの間、書き込みを止める手段を持つ。** 動いているサービスの上で切り替えると、検査の猶予も、失うデータの数も、動き続けます。この章は、止める仕組みを作っていません
- **掃除を止める手順を、復旧の手順に入れる。** 08章の schedule は、記録を失った画像を消します
- **復元した table を、ソースに戻す。** 取り込むか、作り直すか。いつまでも「stack の外の table」でサービスを動かさない
- **version の比較に、復元の回数を混ぜる。** 番号の巻き戻りを、消されたノートも含めて塞ぎます
- **backup を、別のアカウントか別のリージョンにも置く。** PITR も versioning も、同じアカウントの同じリージョンにあります。アカウントごと失う事故には、効きません。AWS Backup の cross-Region、cross-account の copy は、この章では扱っていません
- **検査を、復旧のときだけのものにしない。** 08章の「残っている穴」のように、ふだんから少しずつ食い違いは生まれます。関数を schedule で動かして、`broken` が 0 でなくなったら知らせます。費用は、table の大きさに比例します

## 片付け

<!-- section: 22.cleanup -->

```bash
vp run recovery:status
vp run recovery:drop-table --table <復元した table> --apply
vp run recovery:empty --apply
vp run recovery:infra:destroy
```

順序に意味があります。

まず、復元した table を消します。stack の外にあるので、`destroy` は消してくれません。`recovery:status` が、名前に目印のある table を一覧にします。切り替えたままなら、先に `-c table=` なしでデプロイして、関数を元の table に戻してください。`recovery:drop-table` は、関数がいま読んでいる table を消すことを拒みます。

<<< @/examples/22-recovery/scripts/recovery.ts{drop-table}

次に、bucket を空にします。versioning が有効な bucket は、すべての version と delete marker を消すまで、空になりません。これを実行すると、bucket の中のものは、もう戻せません。

最後に stack です。table、bucket、関数、ログが消えます。PITR の記録も、table と一緒に消えます。ドキュメントによると、PITR が有効だった table には、system backup が 35 日残ります。追加の料金はかからないと書いてあります。

`-c protect=on`、`-c backup=on`、`-c replica=on` でデプロイした stack の片付けは、確かめていません。`protect` を付けた table と bucket は、stack を消しても残るのが目的なので、手で消すことになります。cdkd は、削除保護の付いた table を、`--remove-protection` を付けない限り消さないことを、ソースで読みました。vault に snapshot が残っている場合の動きは、わかりません。

drill の記録は `reports/drills/` にあります。git は無視します。残したい記録は、`examples/22-recovery/drill/TEMPLATE.md` の写しと一緒に、別の場所へ移してください。

## 分散システムとして見ると

状態の持ち主は 2 人います。ノートと記録は DynamoDB、バイトは S3。2 人をまたぐ transaction はありません。07章と 08章は、書く順序と、条件付きの書き込みで、「途中で止まっても、壊れた状態にはならない」ようにしていました。

復元は、その工夫を素通りします。順序を守って書かれた 2 つの履歴から、別々の時刻を切り出すからです。**順序で守った約束は、時刻を巻き戻す操作の前では、守られません。** 守り直すには、約束そのものを検査できる形で持っておく必要があります。この章の `check` が、それです。

修復の設計は、08章の worker と同じ考え方です。どの手順も、自分が成り立つ条件を自分で確かめる。だから、2 回動いても、途中で止まっても、同じところに落ち着きます。違うのは、正しい順序を教えてくれるイベントがないことで、そこは「古い記録にだけ勝つ sequencer」で埋めました。

閉じていないところも、書いておきます。検査は、table と bucket を別々に読みます。動いているサービスの上では、2 つの読み取りの間に書き込みが入ります。猶予の時間で大半は避けられますが、消えた直後の添付は、一瞬「画像のない記録」に見えることがあります。修復は、手を出す前にもう一度見るので、それで壊すことはありません。ただ、報告には出ます。書き込みを止めて検査するのが、いちばん確かです。

::: details この章の検証メモ

**手元で確かめたこと。** table と bucket を別の時刻に戻したときの検出（同じ時刻、table だけ、アップロードより前、上書きの後）。修復（画像の復活、version が残っていない場合の記録の削除、検査のやり直し、遅れて届く本物のイベントとの順序、dry run、同じ検査結果での二重実行、途中での中断）。08章の「残っている穴」の形の検出と削除、検査の後に書かれた新しい記録を消さないこと。07章の掃除のコードが、復元後に記録のない画像を消すことと、それを version から戻せること。object の復元の計画（消された key、複数の delete marker、上書き、後からできた key、すでに消えていた key、一覧の順序）と、再実行、途中での中断。version 番号の巻き戻りで古い保存が通ってしまうこと、fence で通らなくなること、fence の再実行。差分の集計。PITR の依頼の組み立てと、範囲外・無効・復元済みの table の拒否。drill の記録の template が空であること、集計、時刻の書き直しの拒否。3 つの章の repository が書く item の分類。05章の repository contract。DynamoDB と S3 へのリクエストの形。stack の assertion（既定の種類の一覧、PITR、versioning と lifecycle、公開設定、権限、切り替えで環境変数と権限と出力が揃って動くこと、`protect`・`backup`・`replica` の各構成）。型検査と synth。`recovery:demo` と `recovery:drill` の実行。それから、コードを 6 か所わざと壊して、テストが落ちることを確かめました。

**まだ確かめていないこと。** AWS に対しては、何も実行していません。`recovery:infra:diff`、`deploy`、`drift`、`destroy`、`recovery:status`、`seed`、`accident`、`restore:table`、`restore:objects`、`diff`、`verify`、`repair`、`protect`、`audit`、`drop-table`、`empty` のどれもです。したがって、RPO と RTO の実測値はありません。次も、実物では確かめていません。PITR の復元にかかる時間と、`LatestRestorableDateTime` の遅れ。復元した table に引き継がれる設定と、引き継がれない設定。delete marker を消した後と、version をコピーした後の、ETag、`LastModified`、S3 のイベント。コピーした version の ETag が元と同じになること。`ListObjectVersions` で時刻が同じ version の並び。存在しない version ID を指定した削除の応答。`-c table=` でのデプロイの差分と、drift の検査の出力。`cdkd orphan` と `cdkd import`（ヘルプを読んだだけ）。CloudFormation の resource import（ドキュメントも読めていません）。`-c protect=on`、`-c backup=on`、`-c replica=on` の作成と削除。AWS Backup の snapshot が差分かどうか。小さな量への最小課金。DynamoDB 用と S3 用の実装は、リクエストの形をテストで固定しただけで、実物には送っていません。`recovery:seed` が書く検査の記録の sequencer は作り物で、画像は PNG の先頭 33 バイトだけです。表示できる画像ではありません。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| table を、時間ごと戻す | `examples/22-recovery/infra/lib/recovery-stack.ts`、`src/pitr.ts`、`src/memory-table.ts`、`test/pitr-drill.test.ts` | `test:unit`、`recovery:status`、`recovery:restore:table` |
| 画像は、version から戻す | `examples/22-recovery/src/versioned-bucket.ts`、`src/object-restore.ts`、`src/s3-versioned-bucket.ts`、`test/object-restore.test.ts` | `test:unit`、`recovery:restore:objects` |
| 2 つの置き場所は、別の時刻に戻る | `examples/22-recovery/src/invariants.ts`、`src/items.ts`、`src/audit.ts`、`test/skew.test.ts`、`test/adapters.test.ts` | `test:unit`、`recovery:demo`、`recovery:verify` |
| 食い違いを直す | `examples/22-recovery/src/repair.ts`、`test/skew.test.ts`、`test/world.ts` | `test:unit`、`recovery:repair` |
| 巻き戻った version 番号 | `examples/22-recovery/src/table-diff.ts`、`src/dynamodb-table.ts`、`test/table-diff.test.ts` | `test:unit`、`recovery:diff` |
| 手元で動かす | `examples/22-recovery/scripts/demo.ts`、`src/local.ts` | `recovery:demo`、`test:unit` |
| AWS にのせる準備 | `examples/22-recovery/infra/lib/recovery-stack.ts`、`infra/bin/app.ts`、`infra/test/recovery-stack.test.ts`、`src/audit-lambda.ts`、`cdk.json` | `recovery:infra:synth`、`test:unit` |
| drill を実行する | `examples/22-recovery/scripts/recovery.ts`、`scripts/context.ts`、`scripts/drill.ts`、`src/drill.ts`、`drill/TEMPLATE.md`、`drill/record.template.json` | `recovery:drill`、`recovery:seed`、`recovery:accident`、`recovery:restore:table`、`recovery:restore:objects`、`recovery:diff`、`recovery:verify`、`recovery:repair`、`recovery:protect` |
| 切り替える | `examples/22-recovery/infra/lib/recovery-stack.ts`、`infra/bin/app.ts` | `recovery:infra:diff`、`recovery:infra:deploy`、`recovery:audit`、`recovery:infra:drift` |
| 片付け | `examples/22-recovery/scripts/recovery.ts` | `recovery:drop-table`、`recovery:empty`、`recovery:infra:destroy` |
| お金の話 | `data/pricing/` | `test:unit` |

**一次情報**（確認日はすべて 2026-10-12）

- [Point-in-time backups for DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Point-in-time-recovery.html)、[Enable point-in-time recovery in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/PointInTimeRecovery_Howitworks.html)、[Restoring a DynamoDB table to a point in time](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/PointInTimeRecovery.Tutorial.html)、[RestoreTableToPointInTime](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_RestoreTableToPointInTime.html)
- [Basic operations on DynamoDB tables](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/WorkingWithTables.Basics.html)（削除保護）、[How DynamoDB global tables work](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/V2globaltables_HowItWorks.html)
- [Retaining multiple versions of objects with S3 Versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html)、[Working with delete markers](https://docs.aws.amazon.com/AmazonS3/latest/userguide/DeleteMarker.html)、[Managing delete markers](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ManagingDelMarkers.html)、[Restoring previous versions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/RestoringPreviousVersions.html)、[ListObjectVersions](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectVersions.html)
- [Lifecycle configuration elements](https://docs.aws.amazon.com/AmazonS3/latest/userguide/intro-lifecycle-rules.html)、[Emptying a general purpose bucket](https://docs.aws.amazon.com/AmazonS3/latest/userguide/empty-bucket.html)、[Event notification types and destinations](https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-event-types-and-destinations.html)
- [What does Amazon S3 replicate?](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication-what-is-isnot-replicated.html)、[Replicating delete markers between buckets](https://docs.aws.amazon.com/AmazonS3/latest/userguide/delete-marker-replication.html)
- [Advanced DynamoDB backup](https://docs.aws.amazon.com/aws-backup/latest/devguide/advanced-ddb-backup.html)、[Restore a Amazon DynamoDB table](https://docs.aws.amazon.com/aws-backup/latest/devguide/restoring-dynamodb.html)
- AWS Price List bulk API: [DynamoDB](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonDynamoDB/current/ap-northeast-1/index.json)、[AWS Backup](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSBackup/current/ap-northeast-1/index.json)。[Amazon S3 pricing](https://aws.amazon.com/s3/pricing/)（複製の項目。抜粋で読みました）
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)（インストールした package の `cdkd import --help`、`cdkd orphan --help`、同梱の dist）
- [Cloudflare D1: Time Travel and backups](https://developers.cloudflare.com/d1/reference/time-travel/)、[Cloudflare R2: S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/)

:::
