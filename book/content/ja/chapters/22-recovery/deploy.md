---
title: "22 Backup: デプロイ"
---

# 22 Backup: デプロイ

このページでは、スタックを AWS にデプロイし、訓練を手順どおりに進めて、最後に関数が読むテーブルを復元したテーブルへ切り替えます。

## AWS にのせる準備

<!-- section: 22.infra -->

料金がかかるものと、スタックより長く残るものは、コンテキストで名前を指定したときだけ作ります。

<<< @/examples/22-recovery/infra/bin/app.ts{context}

14章の `-c store=valkey` と同じやり方です。何も付けなければ、作るのはテーブル、バケット、関数、ログ、ロールと、そのポリシーだけです。既定の構成にあるリソースの種類の一覧は、テストで固定しています。ボールトも、バックアッププランも、2 つ目のバケットも、その一覧にはありません。

関数は読むだけです。

<<< @/examples/22-recovery/infra/lib/recovery-stack.ts{role}

関数に許可しているのは、テーブルの `Scan` とバケットの一覧だけで、書く権限は 1 つもありません。修復は、人が自分の認証情報を使って、手元から実行します。食い違いを見つけるたびに関数が自動で直す作りにしなかったのは、復元の直後は、何が正しいのかを人が決めている最中だからです。

`Scan` を使うのは、この本ではこの章が初めてです。05章は、ロールから `Scan` をわざと外していました。テーブル全体を読む操作は、高くて遅いからです。それでも、すべてのアイテムを見たと言える検査をするには、`Scan` のほかに方法がありません。

<<< @/examples/22-recovery/src/dynamodb-table.ts{scan}

関数の本体は短く済みます。

<<< @/examples/22-recovery/src/audit-lambda.ts{handler}

どのテーブルを読むかは、環境変数 `TABLE_NAME` だけで決まります。あとで切り替えるときには、この環境変数を変えます。

### 指定したときだけ作るもの

`-c backup=on` は、AWS Backup のボールト（vault）と、1 日 1 回スナップショットを取るバックアッププランを足します。

<<< @/examples/22-recovery/infra/lib/recovery-stack.ts{backup}

PITR があるのに別のバックアップを足すのは、置ける場所と期間が違うからです。PITR はテーブルに付いた機能で、戻せるのは最大 35 日です。AWS Backup のスナップショットは、テーブルとは別の場所であるボールトに、別の権限で、もっと長く置けます。ドキュメントも、2 つは互いの置き換えではなく、両方使えば両方に課金されると書いています。この章の訓練では AWS Backup を使わず、置き方を示すだけにしました。

バックアッププランが使うロールには、AWS が用意したマネージドポリシー（`AWSBackupServiceRolePolicyForBackup`）が付きます。付けるのは CDK です。マネージドポリシーは、この本がずっと避けてきた広い権限にあたります。それでも、AWS Backup が必要とする権限の一覧を自分で書いて保つよりはよいと考えて、AWS のものを使うことにしました。テストは、付いているのがバックアップ用の 1 つだけで、復元用のものが混ざっていないことを確かめています。

`-c replica=on` は、2 つ目のバケットと、そこへの複製を足します。

<<< @/examples/22-recovery/infra/lib/recovery-stack.ts{replica}

削除マーカーの複製は無効のままで、テストで固定しています。なお、CDK はこの複製用のロールに `CDKReplicationRole` という決まった名前を付けます。synth したテンプレートを読んで気づきました。同じアカウントに同じ名前のロールがあると、ぶつかるはずです。

### cdkd が扱う種類

既定の構成の 7 種類（`AWS::DynamoDB::Table`、`AWS::S3::Bucket`、`AWS::S3::BucketPolicy`、`AWS::IAM::Role`、`AWS::IAM::Policy`、`AWS::Lambda::Function`、`AWS::Logs::LogGroup`）には、固定した版の cdkd（0.296.28）が専用の実装を持っています。`AWS::Backup::BackupVault`、`BackupPlan`、`BackupSelection` には専用の実装がなく、Cloud Control API 経由になります。どれも、インストールしたパッケージの中身を読んで確かめただけで、実物には作っていません。

## 訓練を実行する

<!-- section: 22.drill -->

この節から先の手順は、実行していません。用意したのは手順とタスクまでです。

測るものを、先に決めておきます。

- **RTO（recovery time objective）** は、事故からサービスが元どおり使えるまでにかけてよい時間の目標です。訓練では、その実績を測ります。測り終わりは、復元の API が返ったときではなく、デプロイした関数が戻したデータを読んで、壊れたものが 0 件だと答えたときです
- **RPO（recovery point objective）** は、どれだけ前までのデータを失ってよいかの目標です。訓練では、復元した時刻から事故までの長さと、その間に書かれて失ったものの数を測ります

記録はファイルに残します。

<<< @/examples/22-recovery/src/drill.ts{record}

時刻の欄は、[04章](/ja/chapters/04-http-api.md)の `utcTimestamp` で確かめます。集計は時刻どうしを引き算するので、UTC の 1 つの書き方だけを受け付け、オフセットの付いた時刻や存在しない日は断ります。

すべての欄は空で始まります。空のまま残った欄は、その手順をやらなかったことを表し、集計はその欄を数字で埋めません。

<<< @/examples/22-recovery/src/drill.ts{summary}

記録は証拠なので、時刻は一度書いたら書き直せないようにしてあります。

### 準備と事故

```bash
vp run recovery:infra:deploy
vp run recovery:drill new first
vp run recovery:seed --apply
vp run recovery:status
```

`recovery:seed` は、`drill` という持ち主で、ノートを 3 件と、画像を 1 枚ずつ書きます。`--apply` を付けなければ、何を書くかを表示するだけです。この章のタスクのうち AWS を変えるものは、すべて同じ作りになっています。

<<< @/examples/22-recovery/scripts/context.ts{flags}

`recovery:status` の `latest restorable` が、seed が表示した時刻を過ぎるまで待ちます。過ぎるまでは、seed の後の状態に戻せないからです。過ぎたら、事故を起こします。

```bash
vp run recovery:drill mark first lastGoodWriteAt
vp run recovery:accident --apply
vp run recovery:verify
```

<<< @/examples/22-recovery/scripts/recovery.ts{accident}

事故は、アプリ自身の削除で起こします。07章の「ノートを消すと添付も消える」処理が、そのまま走ります。もう 1 件のノートの画像は、画像でないバイトで上書きします。消すのも壊すのも、`drill` の持ち物だけです。

タスクは、事故の前と後の時刻を表示します。前のほうの時刻を、`recovery:drill mark first accidentAt --at <時刻>` で記録しておきます。

直後の `recovery:verify` は、上書きされた画像を見つけるはずです。消されたノートは、きれいに消えているので見つけません。

### 戻す

```bash
vp run recovery:drill mark first restoreRequestedAt
vp run recovery:restore:table --at <事故の前の時刻> --apply
vp run recovery:status
```

<<< @/examples/22-recovery/scripts/recovery.ts{restore-table}

新しいテーブルが `ACTIVE` になるまで、`recovery:status` を繰り返し実行します。`ACTIVE` になったら `tableActiveAt` を記録します。ここまでが、テーブルの復元にかかった時間です。ドキュメントは、復元の時間はデータの量とインデックスの数によって変わり、決まった完了時間は保証しないと書いています。だから自分で測ります。

<<< @/examples/22-recovery/scripts/recovery.ts{status}

続けてバケットを戻します。まず `--apply` なしで計画を読み、それから実行します。

```bash
vp run recovery:restore:objects --at <同じ時刻>
vp run recovery:restore:objects --at <同じ時刻> --apply
vp run recovery:diff --table <復元した table>
vp run recovery:verify --table <復元した table> --frozen
vp run recovery:repair --table <復元した table> --frozen
```

<<< @/examples/22-recovery/scripts/recovery.ts{diff}

`recovery:diff` が表示する数を、`recovery:drill set first notesLost <数>` のように記録します。`recovery:verify` が `broken` を 0 件と報告すれば、次に進めます。0 件でなければ、`recovery:repair` の計画を読み、`--apply` で実行して、もう一度検査します。

仕上げに、version のフェンスを入れ、PITR を付け直します。

```bash
vp run recovery:diff --table <復元した table> --fence --apply
vp run recovery:protect --table <復元した table> --apply
```

## 切り替える

<!-- section: 22.cutover -->

戻したテーブルには正しい中身が入っていますが、まだ誰も読んでいません。関数の `TABLE_NAME` が、元のテーブルのままだからです。

<<< @/examples/22-recovery/infra/lib/recovery-stack.ts{cutover}

関数の環境変数、IAM の権限、スタックの出力の 3 つは、同じ 1 つの変数から作っています。コンテキストでテーブルの名前を渡すと、3 つが一緒に変わります。環境変数だけをコンソールで書き換えると、権限が元のテーブルのままなので、関数は `AccessDenied` で止まります。3 つが揃って変わることは、テストで固定しています。

```bash
vp run recovery:infra:diff -c table=<復元した table>
vp run recovery:infra:deploy -c table=<復元した table>
vp run recovery:audit
vp run recovery:drill mark first serviceConfirmedAt
```

diff に出るのは、関数の環境変数と、ポリシーの 1 文と、出力の値だけのはずです。テーブルそのものは、作りも消しもしません。`recovery:audit` は、デプロイした関数を呼んで、関数が読んでいるテーブルの名前と、食い違いの数を表示します。この出力で `broken` が 0 なら、サービスは戻っています。RTO の計測は、ここで止めます。

忘れやすいことが 1 つあります。次のデプロイで `-c table=` を付け忘れると、関数は元のテーブル、つまり事故の後のデータが入ったテーブルに戻ります。切り替えは、誰かのシェルの履歴ではなく、ソースに書いてください。`cdk.json` の `context` に `table` を入れて、コミットします。

### スタックから見ると、復元したテーブルは存在しない

切り替えた後の状態を、IaC の側から整理します。スタックが持っているテーブルは、元のテーブルです。事故の後のデータが入ったままで、PITR も削除保護の設定も、ソースのとおりです。復元したテーブルはスタックの外にあり、cdkd のステートにも、テンプレートにも出てきません。

```bash
vp run recovery:infra:drift
```

ドリフトの検査は、ステートに記録された値と実物を比べます。そのため、**復元したテーブルについては何も報告しません。** 比べる相手がステートにないからです。[20章](/ja/chapters/20-shipping.md)で見た「差が見つからなかった」と「すべて比べて一致した」の違いが、そのまま現れます。ドリフトが 0 件でも、いまサービスを支えているテーブルは検査の外にあります。手で付けた PITR も、付け忘れた削除保護も、誰も見ていません。

この状態を解消する道は 2 つあります。

1 つは、このままにする道です。`-c table` を `cdk.json` に固定して、復元したテーブルの設定は別の手段で管理します。早く済みますが、テーブルの設定がソースから外れたままになります。

もう 1 つは、復元したテーブルをスタックに取り込む道です。cdkd には、ステートからリソースを外す `orphan` と、すでにある実物をステートに入れる `import` があります。元のテーブルを `cdkd orphan AihRecovery/Notes` で外し、復元したテーブルを `cdkd import AihRecovery --resource <logical ID>=<復元した table>` で同じ logical ID に入れます。そうすれば `-c table` は要らなくなり、ドリフトの検査も復元したテーブルを見るようになるはずです。「はず」と書いたのは、この 2 つのコマンドについては、ヘルプの出力を読んだだけだからです。どちらも `--dry-run` を持っているので、試すなら、まずその出力を読んでください。取り込んだ後は、PITR が有効であることのようにソースが宣言している設定と実物が違えば、ドリフトとして見えるようになります。

CloudFormation で管理しているスタックにも、既存のリソースをスタックに取り込む仕組みがあります。cdkd のヘルプは、`import` を CDK CLI の `cdk import` に合わせたと書いています。CloudFormation の仕組みのほうは、確かめていません。

### テーブルを作り直さない選択

切り替えが面倒なら、テーブルを増やさない方法もあります。復元したテーブルから消えたアイテムだけを読んで、元のテーブルに書き戻す方法です。テーブルの名前は変わらず、スタックにも触りません。事故の後に書かれたデータも失いません。

その代わり、書き戻す道具を自分で作ることになります。元のテーブルで動いているアプリの書き込みとぶつからないように、条件付きで書く必要もあります。消えたのが数件で、どれが消えたかがはっきりしているなら、書き戻すほうが小さく済みます。テーブル全体がおかしいなら、切り替えを選びます。この章が作ったのは、切り替えのほうだけです。ただし、`recovery:diff` の `returning` は、書き戻す候補の一覧として使えます。
