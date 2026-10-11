---
title: "22 データとサービスを復旧する: PITR、snapshot、S3 versioning、AWS Backup"
revision: 1
---

# 22 データとサービスを復旧する: PITR、snapshot、S3 versioning、AWS Backup

[05章](/ja/chapters/05-dynamodb.md)は「うっかり消したデータを戻す手順は 22章」と書いて、先に進みました。[07章](/ja/chapters/07-uploads.md)も、画像の bucket について同じ宿題を残しています。この章で、それをやります。

作るのは、復旧の練習（drill）です。ノートと画像をわざと消して、戻して、どれだけ時間がかかり、何を失ったかを記録する。そのための stack と、1 手順ずつのタスクと、記録の用紙を用意します。

話の中心は、戻す操作そのものより、その後にあります。table と bucket は、別々の仕組みで、別々の時刻に戻ります。戻した直後の 2 つは、たいてい食い違っています。それを見つけて、直す。この章のほとんどは、その話です。

先に、正直に書いておきます。AWS に対する復元は、この本の著者の側では 1 回も実行していません。手順とタスクは実行できる形で用意しましたが、復旧にかかった時間のような実測値は、この章のどこにもありません。測るのは、あなたです。手元で確かめたのは、食い違いの検出と修復のほうです。

前提は 05章と 07章です。[08章](/ja/chapters/08-async.md)の検査の記録も扱うので、読んであると話が早いです。コードは `examples/22-recovery/` にあります。

## 全体像

<!-- section: 22.overview -->

```text
vp run recovery:*   (your laptop, your credentials)
  |  seed, accident      write and delete the way the app does (owner "drill")
  |  restore:table       RestoreTableToPointInTime --> a NEW table, outside the stack
  |  restore:objects     delete markers removed, old versions copied on top
  |  verify, repair      Scan + ListObjectsV2, then the fixes
  v
DynamoDB table "Notes"                          S3 bucket "Uploads"
  point-in-time recovery: on                      versioning: on
  NOTE#...  ATTACHMENT#...  INSPECTION#...        u/<owner>/<note>/<attachment>
  any second of the last 35 days                  old versions kept 30 days
        |                                               |
        +---- as of T1 ----  must agree  ---- as of T2 --+

Lambda function "Audit" (read-only)
  Scan + ListObjectsV2, counts what does not line up
  TABLE_NAME = the stack's table, or a restored one after `-c table=<name>`

only with -c backup=on    AWS Backup vault + one snapshot a day, kept 7 days
only with -c replica=on   second bucket + S3 Replication (delete markers not replicated)
```

stack が作るのは、table が 1 つ、bucket が 1 つ、関数が 1 つです。table の中身は 05章・07章・08章と同じ形で、ノート、添付の記録、検査の記録が 1 つの table に入っています。bucket は 07章の画像置き場と同じ key の形です。

API も画面もありません。この章の「アプリ」は、手元から実行するタスクと、table と bucket を読んで食い違いを数える関数です。データを書くところは、05章・07章・08章のコードをそのまま import して使っています。

下の 2 行は、何も指定しなければ作られません。どちらも置いてあるだけで料金が増えるので、名前を指定したときだけ作るようにしました。

## 守る仕組みは 3 種類あって、混ぜやすい

<!-- section: 22.not-backup -->

「データを守る設定」と聞いて思い浮かぶものは、だいたい次の 3 つのどれかです。守る相手が、それぞれ違います。

- **削除保護。** table そのものを消す操作（`DeleteTable`）を拒みます。table の中の item を消す操作には、何もしません
- **複製（replication）。** いまの状態の写しを、もう 1 か所に持ちます。置き場所が壊れたときに効きます
- **backup。** 過去の状態を取っておきます。データを間違って書き換えたときに効きます

うっかり消したノートを戻したいとき、効くのは 3 つ目だけです。

複製が効かない理由を、もう少し。複製は、変更を忠実に届ける仕組みです。間違った変更も、届けます。DynamoDB の global table は、ある replica での変更を、ほかの replica に非同期で届けます。ドキュメントによると、ふつうは 1 秒以内です。間違って消した item は、1 秒後には向こうでも消えています。

S3 の複製は、少し事情が違います。いまの形式の設定では、delete marker（すぐあとで説明します）は既定では複製されません。version を指定した削除も、複製されません。では安全かというと、上書きは複製されます。壊れた画像で上書きしたら、その壊れた version が向こうにも届きます。複製先でも versioning が有効なので古い version は残りますが、それは versioning が守っているのであって、複製が守っているわけではありません。

**複製は「いま」を 2 つにします。backup は「さっき」を取っておきます。** この章の既定の stack が有効にしているのは、後者の 2 つです。table の point-in-time recovery と、bucket の versioning。

## table を、時間ごと戻す

<!-- section: 22.pitr -->

PITR（point-in-time recovery）は、DynamoDB が table の変更を連続して記録しておいて、過去のある 1 秒の状態を取り出せるようにする機能です。有効にするのは、1 行です。

<<< @/examples/22-recovery/infra/lib/recovery-stack.ts{table}

戻せる範囲は、最大で過去 35 日。いちばん新しい側は「いま」ではなく、ドキュメントによると、ふつう 5 分ほど前までです。`recovery:status` が、その両端（`EarliestRestorableDateTime` と `LatestRestorableDateTime`）を表示します。

`deletionProtection` は、既定では切ってあります。練習用の stack は、片付けるときに table ごと消えてほしいからです。05章が予告した本番向けの設定は、`-c protect=on` を付けたときの形で、`removalPolicy` が `RETAIN` に、削除保護が有効になります。

### 戻すと、table が増える

ここが、PITR でいちばん大事なところです。**復元は、元の table を書き換えません。新しい table を作ります。**

これは良い知らせでもあります。元の table は、復元の間も読み書きできます。戻した結果が気に入らなければ、消してやり直せます。中身を確かめてから、使うかどうかを決められます。

悪い知らせは、新しい table が、CDK の stack の外にできることです。名前も違います。アプリは、まだ元の table を見ています。「戻した」と「使えるようになった」の間に、もう 1 仕事あります。その話は「切り替える」の節でします。

復元の依頼を組み立てるところは、AWS を呼ばない関数にしました。

<<< @/examples/22-recovery/src/pitr.ts{plan}

新しい table の名前には、依頼した時刻を入れています。2 回試しても名前がぶつからず、あとで「これは drill が作った table だ」と見分けられます。片付けのタスクは、名前にこの目印のない table を消すことを拒みます。

戻す範囲の外の時刻や、PITR が無効な table は、ここで断ります。AWS に聞けばエラーになるものですが、手元でわかるなら手元で止めたほうが、慌てているときには親切です。

### 引き継がれない設定

復元でできた table は、元の table の完全な写しではありません。ドキュメントによると、データ、index、暗号化の設定は引き継がれます。引き継がれないのは、auto scaling、IAM policy、CloudWatch の alarm、tag、stream、TTL、そして PITR の設定です。削除保護も、復元でできた table では既定で無効だと、別のページに書いてあります。

つまり、PITR で戻した table には、PITR がかかっていません。そのまま使い続けると、次の事故では戻せません。`recovery:protect` は、復元した table の PITR を有効にするためのタスクです。

もう 2 つ、覚えておくと役に立つことがあります。PITR を一度無効にして有効にし直すと、戻せる範囲はそこから数え直しになります。それから、PITR が有効な table を消すと、DynamoDB が system backup を 1 つ作って、35 日間残します。table ごと消してしまった場合の最後の手段です。どちらも、ドキュメントで読んだだけで、試してはいません。

### 手元の代わり

DynamoDB Local は PITR を持っていないので、テスト用に「過去に戻れる table」を自分で用意しました。

<<< @/examples/22-recovery/src/memory-table.ts{memory-table}

書き込みを時刻つきで全部覚えておいて、`restoreTo` で、ある時刻までを新しい table に流し直します。元の table には触りません。PITR の考え方の代わりであって、DynamoDB の代わりではありません。かかる時間も、5 分の遅れも、再現しません。

この table の上に、05章・07章・08章の repository を載せています。05章が repository 用に書いた contract のテストも、そのまま通しています。じつは最初、「読んでから書く」の間に `await` を挟んでしまい、「同じ version を持つ 2 人のうち、勝つのは 1 人だけ」のテストが落ちました。05章の contract が、ここで効きました。

## 画像は、version から戻す

<!-- section: 22.versioning -->

bucket のほうは、丸ごと「何時何分に戻す」という 1 つの操作を使いません。使うのは versioning です。

<<< @/examples/22-recovery/infra/lib/recovery-stack.ts{bucket}

versioning を有効にした bucket では、2 つのことが変わります。同じ key に書くと、上書きではなく、新しい version が積まれます。そして、version を指定せずに消すと、object は消えません。かわりに delete marker という目印が、いちばん新しい version として置かれます。ふつうに読むと 404 が返りますが、中身は下に残っています。

戻し方は、起きたことによって 2 つあります。

- **消された key。** delete marker を、その version ID を指定して消します。下の version が、またいちばん上になります
- **上書きされた key。** 古い version を、同じ key にコピーします。コピーが新しい version として積まれて、いちばん上になります

上書きされた key を戻すには、もう 1 つ方法があります。新しいほうの version を消すことです。この章では使いません。それは取り消せない操作で、「新しいほうが正しかった」と後でわかっても戻れないからです。コピーなら、何も失いません。

注意がいるのは、delete marker の消し方です。version ID を付けずに消そうとすると、S3 は marker を消さずに、marker をもう 1 つ積みます。戻すための削除は、いつも version ID つきです。

### どの key を、どう戻すかを決める

bucket 全体を「ある時刻の状態」に近づける計画を、key ごとに立てます。ここも、AWS を呼ばない関数です。

<<< @/examples/22-recovery/src/object-restore.ts{plan}

指定した時刻より後にできた key は、消しません。名前を挙げて、そのままにします。復元のつもりでデータを消すのは、2 つ目の事故だからです。

実行する側は短いです。

<<< @/examples/22-recovery/src/object-restore.ts{apply}

計画は、毎回 bucket を読み直して作ります。途中で止まっても、もう一度動かせば、済んだ手順は計画に出てきません。コピーで戻した key は、いちばん上の version の ETag が、戻したい version の ETag と同じになるので、「もう済んでいる」とわかります。ETag が同じになるのは、この bucket の暗号化（S3 が管理する鍵）と、分割しないアップロードの場合です。そうでない bucket では、この判定は使えません。

S3 から version の一覧を読むところには、1 つ癖があります。

<<< @/examples/22-recovery/src/s3-versioned-bucket.ts{list-versions}

`ListObjectVersions` は、中身のある version と delete marker を、別々のリストで返します。両者の前後関係は、時刻から組み立て直すしかありません。同じ key の 2 つが同じ時刻を持っていたら、S3 が「最新」と言っているほうを上にしています。実物でこの並びが正しく出るかは、確かめていません。

### versioning は、ほかの章の前提を変える

07章の「本番にするなら」に、versioning を有効にすると lifecycle rule の動きが変わる、と一言ありました。具体的には、こうです。

07章の bucket は、完了していないアップロードを 1 日で消す rule を持っています。versioning が有効だと、その rule は object を消さずに、delete marker を置きます。中身は、古い version として残り続けます。それを本当に消すのが、この章の rule の `noncurrentVersionExpiration` です。古くなってから 30 日で消します。この 30 日が、画像を戻せる期間です。これを付けないと、アップロードされたすべてのバイトが、永久に保存されて、課金されます。

08章の worker にも影響があります。versioning が有効な bucket では、ふつうの削除は `ObjectRemoved:DeleteMarkerCreated` というイベントになります。08章の stack が購読しているのは `ObjectRemoved:Delete` なので、そのままでは削除が worker に届きません。07章・08章の bucket の versioning を有効にするなら、そこも直す必要があります。この章の stack が 08章の stack に手を足さず、別の stack になっているのは、そのためです。

## 2 つの置き場所は、別の時刻に戻る

<!-- section: 22.skew -->

さて、ここからが本題です。

```text
time ------------------------------------------------------------------->
          T0                 T1                 T2               now
          |                  |                  |                 |
table     record A written   (restore point)    record A deleted
bucket    object A written                      delete marker on A

restore the table to T1, leave the bucket at "now":
  table says   "A has an image"
  bucket says  "A was deleted"          --> a record that points at nothing

restore the table to T1, where an upload finished at T2 instead:
  table says   nothing about it
  bucket says  "here are the bytes"     --> an object nobody points at
```

table は 1 秒単位で、好きな時刻に戻せます。bucket は、key ごとに version を選び直すことで戻します。2 つを「同じ瞬間」に揃える仕組みは、AWS にはありません。揃えるのは、あなたの仕事です。そして、たいていは少しずれます。table だけ戻して bucket を忘れることも、よくあります。

ずれると、何が壊れるでしょう。07章と 08章が、順序を工夫して守ってきた約束が壊れます。07章は「記録が、object より長生きしてはいけない」と決めて、消す順序と作る順序を逆にしました。table だけを過去に戻すと、その順序の工夫は、何の役にも立ちません。

1 つ、助かっていることがあります。ノートと添付の記録と検査の記録は、同じ table に入っています。だから、この 3 つは同じ時刻に戻ります。食い違うのは、table と bucket の間だけです。05章が table を 1 つにまとめたことが、ここで効いています。

### 何を約束と呼ぶか

検査は、table と bucket を読んで、次のどれかに当たるものを数えます。

<<< @/examples/22-recovery/src/invariants.ts{findings}

2 種類に分けています。`broken` は、アプリが当てにしていることが成り立っていない状態です。画像のない添付、別のバイトについての検査結果。`leftover` は、誰も指していないゴミで、掃除が片付けるはずのものです。切り替えを止めるべきなのは、`broken` があるときだけです。

検査そのものは、読んだ結果だけを見る関数です。

<<< @/examples/22-recovery/src/invariants.ts{check}

`graceMs` は、07章の「完了を待っているアップロード」のための猶予です。動いているサービスでは、置かれたばかりの object に記録がないのは普通のことなので、若い object は数えません。書き込みを止めた状態で検査するなら、待っているアップロードはないので、猶予を 0 にできます。タスクでは `--frozen` です。

読むところにも、1 つ決めごとがあります。

<<< @/examples/22-recovery/src/items.ts{classify}

復元した table は、アプリにとって「外から来たデータ」です。半年前の形の item が入っているかもしれません。だから、全部の item を schema に通してから信じます。読めない item は、例外にせず、`unreadable_item` として報告します。1 件読めないせいで検査全体が止まると、残りの状態がわからなくなるからです。

key の形（`NOTE#...`、`ATTACHMENT#...`、`INSPECTION#...`）は、05章・07章・08章がそれぞれ自分のファイルの中に持っていて、外に出していません。この章は同じ形を書き写して、3 つの章の repository が実際に書く item を読めることを、テストで固定しています。どれかの章が key の形を変えたら、このテストが落ちます。

### 戻し方ごとに、見つかるもの

| 起きたこと | 見つかるもの |
| --- | --- |
| table と bucket を、同じ時刻に戻した | なし |
| table だけ戻した。その時刻より後に、画像が消されていた | `attachment_without_object`、`inspection_without_object` |
| table だけ戻した。その時刻より後に、アップロードが完了していた | `object_without_record` |
| table だけ戻した。その時刻より後に、画像が上書きされていた | `inspection_for_other_bytes`、`attachment_size_mismatch` |
| 何も戻していない。事故の直後 | なし |

最後の行は、当たり前ですが大事です。きれいに消されたデータは、整合しています。検査は「食い違い」を見つけるもので、「間違い」は見つけません。事故に気づくのは、検査ではなく、人か、別の監視です。

## 食い違いを直す

<!-- section: 22.repair -->

直すには、どちらが正しいかを決めないといけません。この章は、**table を正として、bucket を合わせます。** table は好きな 1 秒に戻せるので、「この時刻のデータが正しい」という判断を、table のほうで表せるからです。

<<< @/examples/22-recovery/src/repair.ts{repair}

1 つずつ見ていきます。

**画像のない添付の記録。** bucket の version を見て、中身のある version が残っていれば、その上の delete marker を消して、画像を戻します。残っていなければ、記録のほうを消します。後者は、データを失ったということです。報告に `record_deleted` と出るので、drill の記録に書きます。

**object のない検査の記録。** 08章が「残っている穴」として書いた 2 つの経路は、どちらもこの形になります。削除のイベントが届かなかった、あるいは順序がわからなくて無視された結果、記録だけが残る。検査は、復元をしていなくても、これを見つけます。直すときは、消す前に object をもう一度見ます。同じ実行の中で、ひとつ前の手順が画像を戻したかもしれないからです。

**別のバイトについての検査結果。** 08章の worker の手順 1〜3 を、いま置いてあるバイトに対してやり直します。

### イベントのない修復が、sequencer をどうするか

08章の記録は、S3 のイベントが持つ sequencer で順序を決めていました。修復には、イベントがありません。つまり、sequencer がありません。

<<< @/examples/22-recovery/src/repair.ts{sequencer}

古い記録の sequencer に 1 を足した値を使います。これで、古い記録には勝てます。そして、ほかの何にも勝ちません。同じ key の、もっと後のイベントは、必ずこれ以上の sequencer を持っているからです。遅れて届いた本物のイベントは、普通に上書きするか、同じバイトについての重複として正しく無視されます。

消すときも同じ値を使います。「この sequencer より古い記録だけを消す」という 08章の条件に渡すと、検査で見た記録だけが消えて、その後に本物のイベントが書いた新しい記録は残ります。

### 何度動かしても、途中で止まっても

修復は、慌てている人が、失敗した後にもう一度実行するものです。だから、テストは「壊しながら」書きました。08章と同じやり方で、時計と順序を固定して、止める場所を注入しています。待ち時間には頼っていません。

| 注入すること | 結果 |
| --- | --- |
| dry run で実行する | 何も変わらない。報告される手順は、本番の実行と同じ |
| 同じ検査結果で、修復を 2 回実行する | 2 回目は、すべて「することがない」。状態は 1 回目の後と同じ |
| 2 つ目の delete marker を消すところで失敗させる | 1 つ目だけが戻った状態で止まる。もう一度の検査と修復で、全部戻る |
| 中身のある version をすべて消してから修復する | 画像は戻らない。記録を消して、そう報告する |
| 検査と修復の間に、新しいアップロードとそのイベントを挟む | 新しい記録は消えない |
| 修復が検査をやり直した後に、本物のイベントを届ける | 本物のイベントの記録が残る |
| object の復元を、コピーの 1 回目で失敗させる | 途中の状態で止まる。もう一度の実行で、元の状態に揃う |
| object の復元を、成功した後にもう一度実行する | 計画は空 |

コードのほうをわざと 6 か所壊して（コピー済みの判定を外す、object を見直さずに検査の記録を消す、古い sequencer のまま書く、新しい記録まで消す、ETag を比べない、version の fence を 1 つ手前で止める）、どれもテストが落ちることも確かめました。

### 人に残すもの

修復が手を出さないものが 2 つあります。

1 つは、記録のない object です。これは 07章の掃除の担当です。ただし、ここに罠があります。table を過去に戻すと、その後に完了したアップロードは、全部「記録のない object」になります。08章の掃除は 1 時間ごとに動いて、猶予を過ぎた記録のない object を消します。つまり、**table を戻して 1 時間ほど放っておくと、掃除が、復元で記録を失った画像を消し始めます。** 手元のテストでは、07章の掃除のコードをそのまま使って、これを再現しました。versioning が有効なら、消されても version から戻せます。有効でなければ、戻せません。切り替える前に、掃除の schedule を止めてください。

もう 1 つは、記録と大きさの合わない画像です。上書きされたのか、記録のほうが古いのか、修復には決められません。bucket を同じ時刻に戻せば解消します。戻せないなら、添付を消すか、そのままにするかを、人が決めます。

## 巻き戻った version 番号

<!-- section: 22.versions -->

table を戻すと、05章の約束にも穴が開きます。こちらは、検査では見つかりません。

05章の楽観的ロックは、version の番号を比べていました。「私が見たのは version 3。いまも 3 なら、4 にして保存する」。番号は増える一方なので、同じ番号は同じ内容を指す。それが前提でした。

復元は、番号を巻き戻します。

1. ノートが version 3 まで編集される。誰かのブラウザが、version 3 を表示したまま開いている
2. table を、version 1 だった時刻に戻して、切り替える
3. 別の人が、戻ったノートを 2 回編集する。version は 2、そして 3 になる
4. 開いたままだったブラウザが、「version 3 から」の保存を送る

4 は通ります。番号が合っているからです。でも、この 3 は、あの 3 ではありません。ブラウザは、見たこともない編集を上書きします。テストでは、この順序をそのまま再現しています。

直し方は、戻した table の番号を、元の table が配った番号より先に進めておくことです。

<<< @/examples/22-recovery/src/table-diff.ts{fence}

元の table で version 3 だったノートは、戻した table で version 4 にします。古いブラウザの「3 から」は、もう通りません。DynamoDB への書き込みは、条件付きです。

<<< @/examples/22-recovery/src/dynamodb-table.ts{raise-version}

上げるだけで、下げません。2 回実行しても、fence の後に誰かが編集していても、何も壊しません。

正直に言うと、これは半分しか塞げていません。事故で**消された**ノートは、元の table に残っていないので、どこまで番号が進んでいたかがわかりません。きちんと塞ぐには、version の比較に「何回目の復元の後か」を混ぜます。この章では実装していません。

### 切り替えで失うものを、先に数える

fence の材料は、元の table と戻した table の差分です。同じ差分が、もっと大事なことも教えてくれます。

<<< @/examples/22-recovery/src/table-diff.ts{diff}

`returning` は、戻ってくるノート。これが目的です。`lost` は、復元の時刻より後に作られたノートで、切り替えると見えなくなります。`rolledBack` は、巻き戻る編集です。

**「失ったデータ」は、この 2 つ目と 3 つ目です。** drill の記録に書く数は、ここから取ります。事故の 5 分前に戻せば、その 5 分間に書かれたものは、切り替えた先にはありません。元の table には残っているので、拾って書き戻すことはできます。それをやる道具は、この章にはありません。

## 手元で動かす

<!-- section: 22.local -->

AWS のアカウントがなくても、流れは見られます。

```bash
vp run recovery:demo
```

メモリの上の table と bucket で、事故から修復までを通します。出力は、こうなります。

```text
09:04:00  two notes, one inspected image each. This is the point to return to.
09:09:00  since then: one edit, one note deleted by mistake, one image overwritten, one new note.

restored the table to 09:04:00. The bucket is still at 09:09:00.
cutting over gives back 1 note, loses 1, undoes edits to 1.

check: the restored table against the bucket as it is: 4 findings
  broken   attachment_without_object  u/alice/0mv50u5c00001/0mv50vfmo0002
  broken   attachment_size_mismatch  u/alice/0mv50wpxc0003/0mv50y0800004
  leftover inspection_without_object  u/alice/0mv50u5c00001/0mv50vfmo0002
  broken   inspection_for_other_bytes  u/alice/0mv50wpxc0003/0mv50y0800004

restored the bucket to 09:04:00: remove_delete_marker, copy_version

check again: 0 findings

repair: 0 actions, 0 findings left for a person
raised the version of 1 rolled-back note past the number the live table had reached.

not restored, and not found by any check: "diary, written after the point". It exists only in the old table.
```

table だけ戻した時点で、食い違いが 4 件。bucket を同じ時刻に戻すと、0 件になります。修復の出番は、ありませんでした。

これが、おすすめの順序です。**まず 2 つを、できるだけ同じ時刻に戻す。修復は、それでも残ったものにだけ使う。** 修復を先にやると、検査の記録を「上書きされたバイト」に合わせて書き直した後で、bucket を戻すことになり、もう一度食い違います。

最後の行も見てください。復元の時刻より後に書かれた日記は、どの検査にも出てきません。失ったデータは、検査ではなく、差分が教えてくれます。

テストは、いつもと同じです。

```bash
vp run test:unit
```

この 2 つが再現しないものも、書いておきます。復元にかかる時間。`LatestRestorableDateTime` の遅れ。S3 の時刻の粒度。delete marker を消したときや、version をコピーしたときに、S3 が出すイベント。IAM。どれも、実物でしか確かめられません。

## AWS にのせる準備

<!-- section: 22.infra -->

料金がかかるもの、stack より長生きするものは、名前で頼んだときだけ作ります。

<<< @/examples/22-recovery/infra/bin/app.ts{context}

14章の `-c store=valkey` と同じやり方です。何も付けなければ、table、bucket、関数、ログ、role と、その policy だけ。テストが、既定の構成にあるリソースの種類の一覧を固定しています。vault も、plan も、2 つ目の bucket も、そこにはありません。

関数は、読むだけです。

<<< @/examples/22-recovery/infra/lib/recovery-stack.ts{role}

table の `Scan` と、bucket の一覧。書く権限は、1 つもありません。修復は、人が、自分の認証情報で、手元から実行します。食い違いを見つけるたびに関数が勝手に直す、という作りにはしていません。復元の直後は、何が正しいのかを人が決めている最中だからです。

`Scan` は、この本で初めて使います。05章は、role から `Scan` をわざと外していました。table 全体を読む操作は、高くて遅いからです。でも、「すべての item を見た」と言うための検査には、ほかに方法がありません。

<<< @/examples/22-recovery/src/dynamodb-table.ts{scan}

関数の本体は短いです。

<<< @/examples/22-recovery/src/audit-lambda.ts{handler}

どの table を読むかは、環境変数 `TABLE_NAME` だけで決まります。これが、あとで切り替えの取っ手になります。

### 頼んだときだけ作るもの

`-c backup=on` は、AWS Backup の vault と、1 日 1 回の snapshot の plan を足します。

<<< @/examples/22-recovery/infra/lib/recovery-stack.ts{backup}

PITR があるのに、なぜ別の backup が要るのか。PITR は table に付いた機能で、戻せるのは最大 35 日です。AWS Backup の snapshot は、table とは別の場所（vault）に、別の権限で、もっと長く置けます。ドキュメントも、2 つは置き換えではなく、両方使えば両方に課金されると書いています。この章の drill では使いません。置き方を示すところまでです。

plan が使う role には、AWS が用意した managed policy（`AWSBackupServiceRolePolicyForBackup`）が付きます。CDK がそうします。この本がずっと避けてきた「広い権限」ですが、backup のサービスが必要とする権限の一覧を自分で書いて保つより、ここは AWS のものを使うことにしました。テストは、付いているのが backup 用の 1 つだけで、復元用のものが混ざっていないことを見ています。

`-c replica=on` は、2 つ目の bucket と、そこへの複製です。

<<< @/examples/22-recovery/infra/lib/recovery-stack.ts{replica}

delete marker の複製は、無効のままです。テストで固定しています。なお、CDK はこの複製用の role に `CDKReplicationRole` という決まった名前を付けます。synth した template で見つけました。同じアカウントに同じ名前の role があると、ぶつかるはずです。

### cdkd が扱う種類

既定の構成の 7 種類（`AWS::DynamoDB::Table`、`AWS::S3::Bucket`、`AWS::S3::BucketPolicy`、`AWS::IAM::Role`、`AWS::IAM::Policy`、`AWS::Lambda::Function`、`AWS::Logs::LogGroup`）は、固定した版の cdkd（0.296.28）が専用の実装を持っています。`AWS::Backup::BackupVault`、`BackupPlan`、`BackupSelection` には、ありません。Cloud Control API 経由になります。どれも、インストールした package の中身を読んで確かめただけで、実物には作っていません。

## drill を実行する

<!-- section: 22.drill -->

ここから先は、実行していません。手順とタスクを用意したところまでです。

測るものを、先に決めておきます。

- **RTO（recovery time objective）** は、事故からサービスが元どおり使えるまでにかけてよい時間、という目標です。drill で測るのは、その実績です。終わりは、復元の API が返ったときではありません。デプロイした関数が、戻したデータを読んで、壊れたものが 0 件だと答えたときです
- **RPO（recovery point objective）** は、どれだけ前までのデータを失ってよいか、という目標です。drill で測るのは、復元した時刻から事故までの長さと、その間に書かれて失ったものの数です

記録は、ファイルに残します。

<<< @/examples/22-recovery/src/drill.ts{record}

すべての欄は、空で始まります。空のまま残った欄は「その手順をやらなかった」という意味で、集計はそこを数字で埋めません。

<<< @/examples/22-recovery/src/drill.ts{summary}

時刻は、一度書いたら書き直せないようにしてあります。記録は証拠なので。

### 準備と事故

```bash
vp run recovery:infra:deploy
vp run recovery:drill new first
vp run recovery:seed --apply
vp run recovery:status
```

`recovery:seed` は、`drill` という持ち主で、ノートを 3 件と、画像を 1 枚ずつ書きます。`--apply` を付けなければ、何を書くかを表示するだけです。この章の、AWS を変えるタスクは、全部そうなっています。

<<< @/examples/22-recovery/scripts/context.ts{flags}

`recovery:status` の `latest restorable` が、seed が表示した時刻を過ぎるまで待ちます。それより前には、戻せません。過ぎたら、事故を起こします。

```bash
vp run recovery:drill mark first lastGoodWriteAt
vp run recovery:accident --apply
vp run recovery:verify
```

<<< @/examples/22-recovery/scripts/recovery.ts{accident}

事故は、アプリ自身の削除で起こします。07章の「ノートを消すと添付も消える」処理が、そのまま走ります。もう 1 件のノートの画像は、画像でないバイトで上書きします。消すのも壊すのも、`drill` の持ち物だけです。

タスクは、事故の前と後の時刻を表示します。前のほうを、`recovery:drill mark first accidentAt --at <時刻>` で記録しておきます。

直後の `recovery:verify` は、上書きされた画像を見つけるはずです。消されたノートは、見つけません。きれいに消えているからです。

### 戻す

```bash
vp run recovery:drill mark first restoreRequestedAt
vp run recovery:restore:table --at <事故の前の時刻> --apply
vp run recovery:status
```

<<< @/examples/22-recovery/scripts/recovery.ts{restore-table}

`recovery:status` を、新しい table が `ACTIVE` になるまで、繰り返し見ます。なったら `tableActiveAt` を記録します。これが、table の復元にかかった時間です。ドキュメントは、データの量と index の数によって変わり、決まった完了時間は保証しない、と書いています。だから測ります。

<<< @/examples/22-recovery/scripts/recovery.ts{status}

続けて、bucket です。まず `--apply` なしで計画を読んで、それから実行します。

```bash
vp run recovery:restore:objects --at <同じ時刻>
vp run recovery:restore:objects --at <同じ時刻> --apply
vp run recovery:diff --table <復元した table>
vp run recovery:verify --table <復元した table> --frozen
vp run recovery:repair --table <復元した table> --frozen
```

<<< @/examples/22-recovery/scripts/recovery.ts{diff}

`recovery:diff` が表示する数を、`recovery:drill set first notesLost <数>` のように記録します。`recovery:verify` が `broken` を 0 件と言えば、次に進めます。0 でなければ、`recovery:repair` の計画を読んで、`--apply` で実行して、もう一度検査します。

仕上げに、version の fence と、PITR の付け直しです。

```bash
vp run recovery:diff --table <復元した table> --fence --apply
vp run recovery:protect --table <復元した table> --apply
```

## 切り替える

<!-- section: 22.cutover -->

戻した table は、正しい中身を持っています。でも、誰もそれを読んでいません。関数の `TABLE_NAME` は、元の table のままです。

<<< @/examples/22-recovery/infra/lib/recovery-stack.ts{cutover}

関数の環境変数、IAM の権限、stack の出力。この 3 つが、同じ 1 つの変数に付いています。context で table の名前を渡すと、3 つが一緒に動きます。環境変数だけを console で書き換えると、権限が元の table のままなので、関数は `AccessDenied` で止まります。テストが、3 つが揃って動くことを固定しています。

```bash
vp run recovery:infra:diff -c table=<復元した table>
vp run recovery:infra:deploy -c table=<復元した table>
vp run recovery:audit
vp run recovery:drill mark first serviceConfirmedAt
```

diff に出るのは、関数の環境変数と、policy の 1 文と、出力の値だけのはずです。table そのものは、作りも消しもしません。`recovery:audit` は、デプロイした関数を呼んで、関数が読んでいる table の名前と、食い違いの数を表示します。ここで `broken` が 0 なら、サービスが戻りました。RTO の時計を止めます。

1 つ、忘れやすいことがあります。次のデプロイで `-c table=` を付け忘れると、関数は元の table に戻ります。事故の後の table に、です。切り替えは、誰かの shell の履歴ではなく、ソースに書いてください。`cdk.json` の `context` に `table` を入れて、commit します。

### stack から見ると、復元した table は存在しない

ここで、IaC の話になります。

いまの状態を整理します。stack が持っている table は、元の table です。事故の後のデータが入ったまま、PITR も削除保護の設定も、ソースのとおりです。復元した table は、stack の外にあります。cdkd の state にも、template にも、出てきません。

```bash
vp run recovery:infra:drift
```

drift の検査は、state に記録された値と、実物を比べます。だから、**復元した table については、何も言いません。** 比べる相手が state にないからです。[20章](/ja/chapters/20-shipping.md)で見た「差が見つからなかった」と「すべて比べて一致した」の違いが、ここでそのまま出ます。drift が 0 件でも、いまサービスを支えている table は、検査の外にあります。手で付けた PITR も、付け忘れた削除保護も、誰も見ていません。

これを解消する道は 2 つあります。

1 つは、このままにする道です。`-c table` を `cdk.json` に固定して、復元した table の設定は別の手段で管理します。早いですが、table の設定がソースから外れたままになります。

もう 1 つは、復元した table を stack に取り込む道です。cdkd には、state からリソースを外す `orphan` と、すでにある実物を state に入れる `import` があります。元の table を `cdkd orphan AihRecovery/Notes` で外して、復元した table を `cdkd import AihRecovery --resource <logical ID>=<復元した table>` で、同じ logical ID に入れる。そうすれば、`-c table` は要らなくなり、drift の検査も復元した table を見るようになるはずです。「はず」と書いたのは、この 2 つのコマンドは、ヘルプの出力を読んだだけだからです。どちらも `--dry-run` を持っているので、試すなら、まずそれを読んでください。取り込んだ後は、ソースが言う設定（PITR が有効、など）と実物が違えば、今度は drift として見えます。

CloudFormation で管理している stack にも、既存のリソースを stack に取り込む仕組みがあります。cdkd のヘルプは、`import` を CDK CLI の `cdk import` に合わせた、と書いています。こちらは、確かめていません。

### table を作り直さない、という選択

切り替えが面倒なら、table を増やさない方法もあります。復元した table から、消えた item だけを読んで、元の table に書き戻す方法です。名前は変わらず、stack も触りません。事故の後に書かれたデータも、失いません。

そのかわり、書き戻す道具を自分で作ることになり、元の table で動いているアプリの書き込みとぶつからないように、条件付きで書く必要があります。消えたのが数件で、どれが消えたかがはっきりしているなら、こちらのほうが小さく済みます。table 全体がおかしいなら、切り替えです。この章が作ったのは、切り替えのほうだけです。`recovery:diff` の `returning` が、書き戻す候補の一覧にはなります。

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
- **事故の時刻を知る手段を持つ。** PITR は、時刻を渡せば戻してくれます。その時刻を知っているのは、あなただけです。誰が、いつ、何を消したかを追えるように、API の呼び出しを記録しておきます（21章の予定）
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
