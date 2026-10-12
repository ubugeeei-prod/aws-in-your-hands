---
title: "60 Aurora: デプロイ"
---

# 60 Aurora: デプロイ

[しくみと実装](/ja/chapters/60-aurora/build.md)のページで書いたコードは、手元の PGlite と代役のサービスの上で動いていました。このページは、スタックをデプロイして Data API から触る手順と、フェイルオーバーを自分で起こして確かめる手順です。どちらも、この本を書くあいだには実行していません。書いてあるのは、用意したタスクと、ドキュメントから読める期待結果です。

## デプロイと動作確認

<!-- section: 60.deploy -->

必要なものは 2 つです。

- 11章の VPC がデプロイされていること（`vp run net:infra:deploy`）。既定の構成のままでよく、NAT Gateway もインターフェースエンドポイントも要りません
- 学習用のアカウントと、[02章](/ja/chapters/02-toolchain.md)で用意した cdkd の環境

デプロイの前に、何が作られるかを見ます。

```bash
vp run aurora:infra:diff
vp run aurora:infra:deploy
```

固定している版の cdkd（0.296.28）は、`AWS::RDS::DBCluster` に専用の実装を持っています。ただし、その実装は `EnableHttpEndpoint` を送りません。cdkd は、専用の実装が扱わないプロパティを持つリソースを Cloud Control API 経由に切り替えるので、このスタックのクラスターは Cloud Control API で作られるはずです。パッケージの中身を読んで確かめたことで、実際のデプロイでは見ていません。

デプロイが終わると、スタックは 5 つの値を出力します。

| 出力 | 使う場面 |
| --- | --- |
| `ClusterArn` | Data API の `resourceArn` |
| `SecretArn` | Data API の `secretArn`。Aurora が管理するシークレット |
| `ClusterEndpoint` | VPC の中から接続するときのホスト名 |
| `ReaderEndpoint` | 同上。reader がいないあいだは writer を指す |
| `ClusterSecurityGroupId` | VPC の中のクライアントが、自分用のルールを足す先 |

次に、スキーマを入れます。

```bash
vp run aurora:db:schema
```

13章の 4 つのマイグレーションと、この章の 1 つを、Data API で順に実行します。13章のランナーは、適用済みのマイグレーションをテーブルに記録していました。このタスクは記録を取らず、毎回すべての文を実行します。どの文も `IF NOT EXISTS` を付けた 1 文なので、何回実行しても結果は同じです。その代わり、適用したあとで書き換えられたファイルを見つける検査は、ここにはありません。

接続がなければ、インスタンスは 5 分ほどで止まるはずです。止まっているクラスターにこのタスクを実行すると、最初の呼び出しは再開を待つことになります。スクリプトは、答えの出なかった呼び出しを間隔をあけて 8 回まで試します。DDL は 2 回実行しても害がないので、ここではそのまま送り直しています。

```bash
vp run aurora:smoke
```

スモークテストは、ノートを 1 件作り、同じ鍵で追記を 2 回呼び、作ったものを消します。期待する出力は次の形です。実行していないので、これは実際の出力ではなく、スクリプトが出すはずの行です。

```text
first:  {"status":"appended","version":2,"length":2}
second: {"status":"appended","version":2,"length":2}
ok   the same key applied once and answered the same twice
```

2 回目の呼び出しは、追記をせず、記録してあった結果を返します。

止まることを確かめるには、10 分ほど何もせずに置いてから、CloudWatch で `ServerlessDatabaseCapacity` のメトリクスを見ます。止まっているあいだ、この値は 0 です。インスタンスの状態は、止まっていても `available` のままなので、状態では見分けられません。どこかに開いたままの接続があると、止まりません。

設定を変えたいときは、コンテキストで渡します。

```bash
vp run aurora:infra:deploy -c minCapacity=0.5 -c maxCapacity=4
vp run aurora:infra:deploy -c storage=aurora-iopt1
```

1 行目は auto-pause をやめて、常に 0.5 ACU 以上で待たせます。再開の待ちはなくなり、月に少なくとも USD 54.75 がかかります。2 行目は、ストレージの料金構成を I/O-Optimized に変えます。Standard から I/O-Optimized への切り替えは 30 日に 1 回までです。

テンプレートと実物のずれは、ほかの章と同じく次のコマンドで調べます。

```bash
vp run aurora:infra:drift
```

Aurora は、保守でエンジンのマイナーバージョンを上げることがあります。そのあとは、テンプレートの版と実物の版が違って見えるはずです。drift の検査がこれをどう報告するかは、確かめていません。

## フェイルオーバーを起こす

<!-- section: 60.failover-drill -->

フェイルオーバーの練習には、インスタンスが 2 台要ります。この章のスタックは 1 台なので、既定のままでは起こせません。手順だけ書いておきます。

1. スタックに `CfnDBInstance` をもう 1 つ足してデプロイします。2 台目は reader になります。起きているあいだは 2 台分の ACU がかかります
2. `vp run aurora:smoke` を繰り返し実行しながら、別の端末でフェイルオーバーを指示します

```bash
aws rds failover-db-cluster --db-cluster-identifier <クラスターの ID>
```

3. スモークテストの出力に `attempt 1: connection, retrying` の行が出て、最後は `ok` で終わることを確かめます

見るところは 3 つあります。どの例外が出たか。何秒で戻ったか。そして、同じ鍵の追記が 1 回だけ入っていることです。3 つ目がこの章の不変条件で、手元のテストは落とす場所を 10 通り試しましたが、本物のフェイルオーバーがそのどれに当たるかは選べません。何回か繰り返す価値があります。

VPC の中から node-postgres でつなぐ場合は、`src/pg.ts` の adapter を使って同じことをします。そのとき、エラーの `code` を記録してください。[フェイルオーバーの節](/ja/chapters/60-aurora.md)の分類は PostgreSQL のエラーコードの一覧から作ったもので、Aurora が実際に返すコードと照らし合わせるのは、この練習が最初になります。

AZ が丸ごと止まる障害は、この方法では再現できません。[22章](/ja/chapters/22-recovery.md)の訓練と同じく、起こせる範囲の障害で手順を確かめ、起こせないものは起こせないと記録しておきます。
