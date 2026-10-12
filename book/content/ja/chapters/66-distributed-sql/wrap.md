---
title: "66 Distributed SQL: 費用、注意点、片付け"
---

# 66 Distributed SQL: 費用、注意点、片付け

このページでは、3 台のクラスターの料金と、借りた場合との比較、うまく動かないときの調べ方、本番で使うなら足すもの、片付けの手順を順に扱います。最後に、この章の検証メモがあります。

## 料金

<!-- section: 66.cost -->

金額はすべて ap-northeast-1 の定価で、単位は USD、1 か月は 730 時間です。クエリを 1 つも送らずに 3 台を動かしたままにすると、内訳は次のようになります。

- `t4g.medium` のインスタンスが 3 台で USD 94.61
- gp3 のボリュームが 3 台分の 84 GiB で USD 8.06（ルートの 8 GiB は仮定で、実際の大きさは確かめていません。データは 1 台 20 GiB です）
- 11章のスタックに足すインターフェースエンドポイントが、3 つを 3 つのゾーンに置いて USD 91.98
- バケットに置くアーカイブが USD 0.01

合計は USD 194.66 で、その半分近くが、Session Manager をプライベートサブネットに届かせるためのエンドポイントです。エンドポイントを除くと USD 102.67 になります。既定の構成（ノードなし）は、バケットのアーカイブの USD 0.01 だけです。

<<< @/examples/66-distributed-sql/src/cost.ts{fixed}

`t4g.medium` は練習のための選択です。YugabyteDB の文書が AWS で勧める M ファミリーのいちばん小さい `m7g.large` にすると、エンドポイントを除いた金額は USD 238.89 になります。文書が本番の YSQL に挙げている目安は 16 コア以上、64 GB 以上で、そこまで行くと桁が変わります。

### ゾーンをまたぐ転送

マネージドなデータベースでは見えなかった料金が、もう 1 つあります。複製のための、ゾーンをまたぐ転送です。同じリージョンのゾーンのあいだの転送は 1 GB あたり USD 0.01 で、AWS の文書によれば、送る側と受ける側の両方で計量されます。tablet のリーダーは、書き込みを別のゾーンにいる 2 つのフォロワーへ送るので、1 バイトの書き込みが 4 回数えられます。

<<< @/examples/66-distributed-sql/src/cost.ts{transfer}

毎秒 10 件の書き込みが、1 件あたり 2,000 バイトを運ぶと仮定すると、1 か月で 210.24 GB が計量され、USD 2.10 です。この負荷では誤差の範囲ですが、書き込みに比例して増えるので、毎秒 1,000 件なら USD 210.24 になり、インスタンスの料金を超えます。

この数字は下限で、測った値ではありません。1 件あたり 2,000 バイトは仮定です。ハートビート、トランザクションの状態の記録、別のゾーンのリーダーへ回される読み取り、クライアントとノードのあいだの転送は入れていません。本当の値は、動かしたクラスターの CloudWatch の `NetworkOut` と、請求の `DataTransfer-Regional-Bytes` を読まないとわかりません。

### 借りた場合との比較

同じ負荷を、毎秒 10 件の書き込みと 90 件の読み取り、データ 10 GB として比べます。

| | 1 か月 | 前提 |
| --- | --- | --- |
| この章の 3 台 | USD 196.77 | `t4g.medium` がこの負荷をさばけるかは測っていません |
| Aurora DSQL | USD 68.65 | 1 件あたりの DPU は 13章の仮定（読み取り 0.00675、書き込み 0.18525）。測っていません |
| Aurora Serverless v2 | USD 55.95 から | 0.5 ACU のまま動いた場合の下限。I/O の料金は入れていません |

<<< @/examples/66-distributed-sql/src/cost.ts{managed}

3 つの数字は、どれも仮定の上に立っています。それでも言えることはあります。自分で動かす場合の料金は、負荷がゼロでも USD 194.66 から始まり、負荷が増えてもマシンを足すまではほとんど変わりません。Aurora DSQL は、負荷がなければ保存料金だけで、負荷に比例して増えます。この表の負荷を 4 倍にすると、DSQL の計算は USD 262.60 になり、この章の 3 台（転送を入れて USD 203.07）を上回ります。ただし、その負荷を `t4g.medium` の 3 台がさばけるかどうかは別の問題で、測っていません。そして、どの行にも、運用する人の時間は入っていません。

スタックを消したあとも、既定では 3 つのデータボリュームが残り、月に USD 5.76 かかります。

## つまずきやすいところ

<!-- section: 66.pitfalls -->

このページの内容のうち、AWS の上で起きることは、文書と手元のクラスターから予想したもので、実機では見ていません。調べるときは、次の順でタスクを実行します。

```bash
vp run distsql:status
vp run distsql:logs a
vp run distsql:health
```

- **`distsql:status` が何も返さない。** ノードが Systems Manager に届いていません。11章のネットワークを、エンドポイントを 3 つ付けて、3 つのゾーンでデプロイしたかを確かめます
- **サービスが `inactive` のまま。** ユニットは、バイナリとフラグファイルが無いと、エラーを出さずに起動を見送ります。`distsql:install` と `distsql:configure` を済ませたかを見てください
- **`yb-tserver` が起動してすぐ落ちる。** ログを読みます。証明書が見つからないなら、`distsql:certs` を済ませたか、証明書のファイル名がノードのアドレスと合っているかを見ます。手元では、共有メモリを使えない環境で `initdb` が失敗して落ちました
- **ノードが突然止まる。** 時計のずれが `max_clock_skew_usec` を超えると、プロセスは自分で止まります。`distsql:status` の chrony の行を見てください。systemd が 5 秒後に起こし直しますが、時計が直るまで繰り返します
- **`yb-admin` がリーダーを見つけられずにタイムアウトする。** TLS を有効にしたクラスターでは、`--certs_dir_name` が要ります。手元では、付けないと 60 秒待って失敗しました
- **`SHOW transaction_isolation` が `read committed` と答える。** 自分で起動したクラスターでは、実際に効いているのは Snapshot です。`SHOW yb_effective_transaction_isolation_level` で確かめます
- **再試行が尽きる（`RetriesExhaustedError`）。** 同じ行に書き込みが集まりすぎています。13章の上限は 4 回です。手元では尽きませんでしたが、12 件の同時の作成で、やり直しが 29 回に達した回がありました
- **過半数が戻った直後に、文が 1 回だけ失敗する。** 手元では、2 台を起こし直した直後の `CREATE DATABASE` が `current transaction is expired or aborted` で失敗しました。少し待ってやり直すと通りました
- **`distsql:health` が「NOT fully replicated」と答える。** 写しの足りない tablet があります。この状態で別のノードを止めてはいけません。止まっているノードを戻すのが先です

## 本番にするなら

<!-- section: 66.production -->

最初に決めるのは、自分で動かすかどうかです。[最初のページ](/ja/chapters/66-distributed-sql.md)に挙げた事情のどれにも当てはまらないなら、借りてください。動かすと決めた場合に、この章の構成に足りないものを挙げます。

- **マシン。** 文書が勧める M ファミリーにし、データボリュームは 250 GB 以上の gp3 にします。データ用のドライブは `noatime` でマウントするよう勧められていますが、この章が再利用している 23章のスクリプトは `defaults` でマウントします
- **台数。** 3 台は、1 台を失っている間、余裕がありません。写しを作り直す先になる 4 台目以降を持ちます。文書の例は 6 台で、ゾーンごとに 2 台です
- **ノードの置き換えの訓練。** [デプロイのページ](/ja/chapters/66-distributed-sql/deploy.md)の「止まったノードを戻す」の手順を、スクリプトにして、実際に通しておきます
- **バックアップ。** 戻すところまでを定期的に試します。`ysql_dump` で足りなくなったら、スナップショットをクラスターの外へ出す仕組みを作るか、YugabyteDB Anywhere の商用ライセンスを検討することになります。バケットにはバージョニングを付けます
- **証明書と認証局。** 認証局の秘密鍵を、運用者のマシンではない場所に置きます。証明書の入れ替えを、期限が来る前に訓練します
- **パスワード。** 既定の管理者のパスワードを変え、アプリケーションには専用のロールを使わせ、Secrets Manager に置いて入れ替えます
- **接続。** この章のクライアントは、作業のたびに接続を開いて閉じます。本番では接続をプールし、ノードの一覧を固定で持つ代わりに、専用のドライバーか、手前のロードバランサーを検討します
- **監視。** [デプロイのページ](/ja/chapters/66-distributed-sql/deploy.md)の「見ておくもの」を、アラームにします
- **版の追従。** リリースノートを読み、長期サポートの系列の中でパッチを上げ続けます。次の系列へ移る時期も、自分で決めます
- **OS のパッチ。** 23章と同じです。ノードを再起動するときは、1 台ずつ、`distsql:health` を挟みます
- **複数のリージョン。** この章は 1 つのリージョンの 3 つのゾーンです。リージョンを失っても動かし続ける構成は、[28章](/ja/chapters/28-multi-region.md)の考え方に加えて、リージョンをまたぐ複製の遅延と転送料を見積もる必要があります。この章では扱っていません

## 片付け

<!-- section: 66.cleanup -->

手元のクラスターは、次のタスクで止めて消します。

```bash
vp run distsql:local:destroy
```

取得したアーカイブ、バイナリ、手元の認証局は `examples/66-distributed-sql/.yugabyte/` に残ります。要らなければ、ディレクトリごと消してください。

AWS に作ったものは、次の順番で消します。

```bash
vp run distsql:infra:destroy
vp run net:infra:destroy
```

既定の `stateOnDestroy=retain` では、インスタンスは消えますが、バケットと 3 つのデータボリュームは残ります。データベースの中身をうっかり消さないための設定です。練習が終わったら、自分で消してください。

```bash
aws ec2 describe-volumes --region ap-northeast-1 --filters Name=tag:Name,Values='AihDistSql/*'
aws ec2 delete-volume --region ap-northeast-1 --volume-id <volume-id>
aws s3 rm s3://<bucket>/ --recursive --dryrun
```

残ったボリュームは、Name のタグで探せます。バケットは、`--dryrun` を外して中身を消してから、`aws s3 rb` で消します。最初から `-c stateOnDestroy=delete` で作った場合は、destroy の前にバケットを空にしてください。24章の検証メモによれば、固定した版の cdkd は空でないバケットを消しません。

`net:infra:destroy` を忘れると、エンドポイントの料金（月に USD 91.98）がかかり続けます。VPC を残したいなら、`vp run net:infra:deploy` を `-c` なしで実行すると、エンドポイントを外して、ゾーンを既定の 2 つに戻す変更になります。3 つ目のゾーンのサブネットを使っているものが残っていると、この変更は失敗するはずです。先にこの章のスタックを消してください。

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト（7 ファイル 73 件。フラグファイルの生成と検査、接続先の切り替え、過半数のモデルに対する 1 ノードの喪失の総当たりと 2 ノードの喪失、非同期の複製で失われる書き込み、PGlite の上で 13章の再試行ループに YugabyteDB のエラーを差し込むテスト、ノードに置くファイルが `deploy/` と一致すること、導入のスクリプトが不正な引数を拒むことを bash で実行して確かめるテスト、証明書の引数、料金、スタックのアサーション）。型検査。`distsql:infra:synth`（既定の設定と `-c nodes=3`）、`distsql:render`。

YugabyteDB 2025.2.7.0-b107 を、macOS 26.6（Apple シリコン）で実際に動かしました。`distsql:fetch` でアーカイブ（130,180,590 バイト）を `software.yugabyte.com` から取得し、SHA-256 が、配布元がアーカイブの隣に公開している `.sha` ファイルの値と一致しました。`distsql:local:start` で `yb-master` と `yb-tserver` を 3 組、`127.0.0.1` の上で起動し、`distsql:local:verify` を TLS なしで 2 回、TLS ありで 5 回実行しました。途中でスクリプトを直しているので、7 回は同じ内容ではありません（バックアップの段は 2 回目から、その再試行は 6 回目から入っています）。見たことは次のとおりです。13章のマイグレーション 4 つと repository が、変更なしで動きました。上限 3 件に 12 件の同時の作成で、作成は毎回 3 件、`40001` による再試行は 4 回から 29 回、4 回の試行で諦めたトランザクションは 0 件でした。ノード b を SIGKILL した後、a と c は確認済みの 40 件をすべて返し、続く 20 件の作成は 0.9 秒から 4.3 秒で終わり、呼び出し元に届いたエラーは 0 件でした。b と c を落とすと、残る 1 台は書き込みを確認しませんでした（接続のタイムアウトか、20 秒の無応答）。戻すと確認済みの 40 件は毎回すべて残り、確認されなかった 1 件は 7 回のうち 3 回で入っていました。`ysql_dump` の出力を別のデータベースに流し込み、確認済みのノートが揃いました（5 回）。TLS ありの 1 回では、2 台を戻した直後の `CREATE DATABASE` が `current transaction is expired or aborted` で失敗し、その回の検証は失敗で終わりました。再試行を入れた後の 2 回は通っています。TLS ありのクラスターでは、TLS を使わないクライアントが断られ、`yb-admin` は `--certs_dir_name` を付けると `list_all_masters` と `modify_placement_info` に応え、付けないと 60 秒でリーダーを見つけられずに終わりました。管理用の Web インターフェースは、TLS ありでも平文の HTTP に応答しました。検証の後、`distsql:local:destroy` でプロセスをすべて止め、残っていないことを確かめました。

`yb-tserver` と `yb-master` のフラグの名前と既定値（`enable_wait_queues`、`yb_enable_read_committed_isolation`、`max_clock_skew_usec`、`follower_unavailable_considered_failed_sec`、`raft_heartbeat_interval_ms`、`replication_factor` など）は、固定した版のバイナリの `--helpfull` で読みました。

**まだ確かめていないこと。** AWS に対しては、何も実行していません。`distsql:infra:diff`、`distsql:infra:deploy`、`distsql:infra:destroy` と、`distsql:status` から `distsql:session` までの、ノードに触るタスクすべてです。ノード用のアーカイブ（el8-aarch64）は取得しておらず、Linux のバイナリは一度も動かしていません。そのため、次のことは読んだだけか、推測です。Amazon Linux 2023（arm64）の `t4g.medium` で YugabyteDB が動くこと。`post_install.sh` が通ること。ユーザーデータと 5 つのスクリプト、2 つのユニットが実機で通ること（シェルの構文は `bash -n` で見ました）。Amazon Linux 2023 の chrony の既定の参照先。ロールの権限で足りること。インターフェースエンドポイントと S3 のゲートウェイエンドポイントだけで、導入に必要なものすべてに届くこと。インスタンスを停止して開始した後に、ノードが同じアドレスで戻ること。

手元でも実行していないこと。ローリングアップグレード、死んだノードの置き換え（`change_master_config`、`change_blacklist`）、分散スナップショット、`yugabyted`。デッドロック（`40P01`）は起こしていません。時計のずれ、ネットワークの分断、ディスクの故障は、同じマシンの上では再現できません。ゾーンをまたぐ転送量と、`t4g.medium` がさばける負荷は測っていません。

一次情報で確かめられなかったこと。文書の「Start YB-TServers」のページは、取得したツールが別のページの内容を返し、読めませんでした。`yb-tserver` のフラグと `modify_placement_info` は、バイナリの表示と、手元で動いた事実によっています。手動でデプロイしたクラスターの証明書の入れ替えの手順は、見つけられませんでした。動いているノードの EBS スナップショットがバックアップとして使えるかどうかも、書かれていませんでした。`yb-master` の `/api/v1/health-check` の応答の形は、手元で見たもので、文書では確かめていません。CockroachDB と TiDB は、ライセンスと文書を読んだだけで、動かしていません。Aurora DSQL について書いたことは 13章の記録によるもので、この章では読み直していません。

依頼された構成から変えた点。バイナリを取得するタスクは、依頼のとおり `fresh` で定義しました（24章の `celld:fetch` は `live` です）。証明書を作るタスクは PATH の `openssl` を使います。TLS を有効にした検証を実行したときは devShell に `openssl` がなく、Homebrew の OpenSSL 3.6.1 が使われました。そのあと devShell に OpenSSL 3.5.8 を足し、同じ引数で認証局と 127.0.0.1 の証明書を作れることを確かめました。その証明書でクラスターを起動してはいません。バックアップは、スタックにバケットの接頭辞と権限を用意し、手順を書いたところまでで、タスクにはしていません。

cdkd が扱うリソースの種類。このスタックは、24章のスタックと同じ 10 種類のリソースと、同じ範囲の property だけを使っています。固定した版（0.296.28）がそれぞれをどう扱うか（`AWS::EC2::Volume` と `AWS::EC2::VolumeAttachment` は Cloud Control API 経由）は 24章の検証メモにあり、この章では読み直していません。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| どのデータベースを載せるか | `examples/66-distributed-sql/src/yugabyte.ts` | `distsql:fetch` |
| 全体像 | `examples/66-distributed-sql/infra/lib/distsql-stack.ts` | `distsql:infra:synth` |
| 書き込みが 3 か所に届くまで | `examples/66-distributed-sql/src/yugabyte.ts`、`test/repository.test.ts` | `vp test run examples/66-distributed-sql` |
| クラスターを 1 つの定義から作る | `examples/66-distributed-sql/src/topology.ts`、`test/topology.test.ts` | `distsql:render` |
| 13章のコードを、そのままつなぐ | `examples/66-distributed-sql/src/yugabyte-db.ts`、`src/failover.ts`、`test/failover.test.ts` | `distsql:local:verify` |
| 過半数のモデル | `examples/66-distributed-sql/src/model/quorum.ts`、`test/quorum.test.ts` | `vp test run examples/66-distributed-sql` |
| 証明書は、鍵を動かさずに配る | `examples/66-distributed-sql/src/certs.ts`、`scripts/certs.ts`、`scripts/nodes.ts` | `distsql:local:certs`、`distsql:certs` |
| スタック | `examples/66-distributed-sql/infra/lib/distsql-stack.ts`、`infra/bin/app.ts`、`src/config.ts`、`infra/test/distsql-stack.test.ts` | `distsql:infra:synth` |
| ノードの中身 | `examples/66-distributed-sql/src/machine.ts`、`deploy/`、`scripts/render.ts`、`test/machine.test.ts` | `distsql:render` |
| バイナリを取得する | `examples/66-distributed-sql/scripts/fetch.ts` | `distsql:fetch` |
| 3 ノードを起動する | `examples/66-distributed-sql/scripts/cluster.ts`、`scripts/local-nodes.ts` | `distsql:local:start`、`distsql:local:status`、`distsql:local:kill`、`distsql:local:stop`、`distsql:local:destroy` |
| 落として確かめる | `examples/66-distributed-sql/scripts/verify.ts` | `distsql:local:verify` |
| 3 台を立ち上げる | `examples/66-distributed-sql/scripts/nodes.ts`、`src/remote.ts` | `distsql:infra:deploy`、`distsql:artifact`、`distsql:install`、`distsql:certs`、`distsql:configure`、`distsql:start`、`distsql:status`、`distsql:health`、`distsql:session` |
| 動かし続ける | `examples/66-distributed-sql/scripts/nodes.ts`、`src/remote.ts` | `distsql:stop`、`distsql:health`、`distsql:logs` |
| 料金 | `examples/66-distributed-sql/src/cost.ts`、`test/pricing.test.ts`、`data/pricing/` | `vp test run examples/66-distributed-sql` |
| 片付け | `examples/66-distributed-sql/infra/lib/distsql-stack.ts` | `distsql:infra:destroy`、`distsql:local:destroy` |

**一次情報**（確認日はすべて 2026-10-13）

- ライセンス: [yugabyte-db の LICENSE.md](https://raw.githubusercontent.com/yugabyte/yugabyte-db/master/LICENSE.md)、[cockroach の LICENSE](https://raw.githubusercontent.com/cockroachdb/cockroach/master/LICENSE)、[CockroachDB Licensing FAQs](https://docs.cockroachlabs.com/docs/stable/licensing-faqs)、[tidb の LICENSE](https://raw.githubusercontent.com/pingcap/tidb/master/LICENSE)
- CockroachDB と TiDB: [Production Checklist](https://docs.cockroachlabs.com/docs/stable/recommended-production-settings)、[PostgreSQL Compatibility](https://docs.cockroachlabs.com/docs/stable/postgresql-compatibility)、[TiDB Overview](https://docs.pingcap.com/tidb/stable/overview/)、[TiDB のハードウェアの推奨](https://docs.pingcap.com/tidb/stable/hardware-and-software-requirements/)
- YugabyteDB の配布: [Releases](https://docs.yugabyte.com/stable/releases/)、[v2025.2 のリリースノート](https://docs.yugabyte.com/stable/releases/ybdb-releases/v2025.2/)、[Quick start (macOS)](https://docs.yugabyte.com/stable/quick-start/macos/)、`software.yugabyte.com/releases/2025.2.7.0/` の各アーカイブの `.sha`、取得したアーカイブの `--version` と `--helpfull`
- YugabyteDB のしくみ: [Replication](https://docs.yugabyte.com/stable/architecture/docdb-replication/replication/)、[Sharding](https://docs.yugabyte.com/stable/architecture/docdb-sharding/sharding/)、[YB-Master](https://docs.yugabyte.com/stable/architecture/yb-master/)、[Transactions overview](https://docs.yugabyte.com/stable/architecture/transactions/transactions-overview/)、[Isolation levels](https://docs.yugabyte.com/stable/architecture/transactions/isolation-levels/)、[Concurrency control](https://docs.yugabyte.com/stable/architecture/transactions/concurrency-control/)、[Transaction retries](https://docs.yugabyte.com/stable/develop/learn/transactions/transactions-retries-ysql/)、[node-postgres smart driver](https://docs.yugabyte.com/stable/drivers-orms/nodejs/yugabyte-node-driver/)
- YugabyteDB のデプロイと運用: [Start YB-Masters](https://docs.yugabyte.com/stable/deploy/manual-deployment/start-masters/)、[System configuration](https://docs.yugabyte.com/stable/deploy/manual-deployment/system-config/)、[Deployment checklist](https://docs.yugabyte.com/stable/deploy/checklist/)、[Operating system support](https://docs.yugabyte.com/stable/reference/configuration/operating-systems/)、[Create server certificates](https://docs.yugabyte.com/stable/secure/tls-encryption/server-certificates/)、[Server-to-server encryption](https://docs.yugabyte.com/stable/secure/tls-encryption/server-to-server/)、[yugabyted](https://docs.yugabyte.com/stable/reference/configuration/yugabyted/)、[yb-admin](https://docs.yugabyte.com/stable/admin/yb-admin/)、[Upgrade](https://docs.yugabyte.com/stable/manage/upgrade-deployment/)、[Change cluster configuration](https://docs.yugabyte.com/stable/manage/change-cluster-config/)、[Replace a failed YB-Master](https://docs.yugabyte.com/stable/troubleshoot/cluster/replace_master/)、[Replace a failed YB-TServer](https://docs.yugabyte.com/stable/troubleshoot/cluster/replace_tserver/)、[Backup and restore](https://docs.yugabyte.com/stable/manage/backup-restore/)、[Distributed snapshots](https://docs.yugabyte.com/stable/manage/backup-restore/snapshot-ysql/)、[Metrics](https://docs.yugabyte.com/stable/launch-and-manage/monitor-and-alert/metrics/)
- AWS: [AWS Price List（AWSDataTransfer、ap-northeast-1）](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/ap-northeast-1/index.json)、[Understanding data transfer charges](https://docs.aws.amazon.com/cur/latest/userguide/cur-data-transfers-charges.html)、[Precision clock and time synchronization](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/set-time.html)、[T4g instances](https://aws.amazon.com/ec2/instance-types/t4/)。EC2、EBS、エンドポイント、S3、Aurora DSQL、Aurora の単価は、前の章が AWS Price List から記録したもの（確認日 2026-10-11 から 2026-10-13）を使っていて、この章では読み直していません
- Cloudflare と Vercel: [Cloudflare D1](https://developers.cloudflare.com/d1/)、[Vercel Storage overview](https://vercel.com/docs/storage)

:::
