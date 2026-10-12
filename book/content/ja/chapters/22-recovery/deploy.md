---
title: "22 Backup: デプロイ"
---

# 22 Backup: デプロイ

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
