---
title: "22 Backup: PITR、snapshot、S3 versioning、AWS Backup"
revision: 2
---

# 22 Backup: PITR、snapshot、S3 versioning、AWS Backup

[05章](/ja/chapters/05-dynamodb.md)は「うっかり消したデータを戻す手順は 22章」と書いて、先に進みました。[07章](/ja/chapters/07-uploads.md)も、画像の bucket について同じ宿題を残しています。この章で、それをやります。

作るのは、復旧の練習（drill）です。ノートと画像をわざと消して、戻して、どれだけ時間がかかり、何を失ったかを記録する。そのための stack と、1 手順ずつのタスクと、記録の用紙を用意します。

話の中心は、戻す操作そのものより、その後にあります。table と bucket は、別々の仕組みで、別々の時刻に戻ります。戻した直後の 2 つは、たいてい食い違っています。それを見つけて、直す。この章のほとんどは、その話です。

先に、正直に書いておきます。AWS に対する復元は、この本の著者の側では 1 回も実行していません。手順とタスクは実行できる形で用意しましたが、復旧にかかった時間のような実測値は、この章のどこにもありません。測るのは、あなたです。手元で確かめたのは、食い違いの検出と修復のほうです。

前提は 05章と 07章です。[08章](/ja/chapters/08-async.md)の検査の記録も扱うので、読んであると話が早いです。コードは `examples/22-recovery/` にあります。

## 全体像

<!-- section: 22.overview -->

```figure
caption: recovery のタスクは、手元から table と bucket に書き、事故を起こし、別々に戻してから、突き合わせて直す
type: sequence
actor cli: vp run recovery:* | 手元, 自分の credentials
actor table: DynamoDB table Notes
actor bucket: S3 bucket Uploads
step cli -> table: seed, accident
step cli -> bucket: seed, accident
note cli: app と同じ書き方 (owner "drill")
step cli -> table: restore:table
note table: RestoreTableToPointInTime
note table: 新しい table, stack の外
step cli -> bucket: restore:objects
note bucket: delete marker を外す
note bucket: 古い version を上に copy
step table --> bucket: T1 と T2 は合っていること
step cli -> table: verify: Scan
step cli -> bucket: verify: ListObjectsV2
note cli: repair: 見つけたものを直す
```

```figure
caption: stack が作るのは table、bucket、検査する関数で、いちばん下の 2 つは指定したときだけ足される
node audit: Lambda function Audit | 読むだけ, 合わないものを数える
node table: DynamoDB table Notes | point-in-time recovery, 過去 35 日のどの秒にも
node bucket: S3 bucket Uploads | versioning, 古い version を 30 日
node vault: AWS Backup vault | 1 日 1 回の snapshot, 7 日保持
node replica: 2 つ目の bucket | S3 Replication, delete marker は複製しない
edge audit -> table: Scan (TABLE_NAME: -c table=<name> のあとは復元した table)
edge audit -> bucket: ListObjectsV2
edge table -> vault: -c backup=on のときだけ
edge bucket -> replica: -c replica=on のときだけ
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
