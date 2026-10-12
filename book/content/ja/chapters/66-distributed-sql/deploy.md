---
title: "66 Distributed SQL: デプロイ"
---

# 66 Distributed SQL: デプロイ

[前のページ](/ja/chapters/66-distributed-sql/local.md)では、手元でクラスターを動かしました。このページは、同じものを EC2 の 3 台に載せる手順と、載せたあとの運用の手順です。**このページの手順は、一度も実行していません。** タスクとスクリプトは用意してあり、組み立てるコマンドはテストで固定していますが、AWS の上で通ることは確かめていません。実行するなら、最後の[片付け](/ja/chapters/66-distributed-sql/wrap.md)まで同じ日に進めてください。

## 3 台を立ち上げる

<!-- section: 66.deploy -->

最初に、11章のネットワークを 3 つのゾーンで作ります。すでに 2 つのゾーンでデプロイしてある場合は、サブネットが増える変更になります。Session Manager と Run Command がプライベートサブネットに届くように、インターフェースエンドポイントも 3 つ足します。

```bash
vp run net:infra:deploy -c availabilityZones=ap-northeast-1a,ap-northeast-1c,ap-northeast-1d -c interfaceEndpoints=ssm,ssmmessages,ec2messages
vp run distsql:infra:diff -c nodes=3
vp run distsql:infra:deploy -c nodes=3
vp run distsql:status
```

`distsql:status` は、3 台それぞれについて、cloud-init が終わったか、データボリュームがマウントされているか、YugabyteDB が入っているか、2 つのサービスが動いているか、時計がどこを向いてどれだけずれているかを表示します。この時点では、データベースは入っていません。

次に、ノード用のアーカイブを手元に取得し、バケットに置いて、3 台に入れます。

```bash
vp run distsql:fetch --nodes
vp run distsql:artifact
vp run distsql:install
```

`distsql:install` は、各ノードの導入スクリプトに、バケットの名前と、リポジトリに固定してある版と SHA-256 を渡します。ノードはアーカイブを取り、ダイジェストが合ったときだけ展開します。

続けて証明書を配り、フラグファイルを書き、起動します。

```bash
vp run distsql:certs
vp run distsql:configure
vp run distsql:start
vp run distsql:health
```

`distsql:certs` は、手元の `.yugabyte/ca-aws/` に認証局を作り（すでにあれば使い）、各ノードから署名のリクエストを受け取って署名し、証明書を返します。`distsql:configure` は 3 台のプライベートアドレスを調べて、それぞれのノードに渡します。`distsql:start` は、3 台の `yb-master` を先に、続けて 3 台の `yb-tserver` を起動します。`yb-tserver` は起動するときに `yb-master` に登録するので、この順番です。

<<< @/examples/66-distributed-sql/src/remote.ts{commands}

`distsql:health` は、`yb-master` の `/api/v1/health-check` をノードの上から読み、死んでいるノードと、写しの足りない tablet が無いことを確かめます。この応答の形は、手元のクラスターで見たものです。

<<< @/examples/66-distributed-sql/src/remote.ts{health}

起動したら、最初に 2 つのことを済ませます。どちらも、ノードの上のシェルで対話的に実行します。パスワードを Run Command の引数に通さないためです。シェルは `vp run distsql:session a` で開けます（Session Manager プラグインが要ります。devShell には入っていません）。

1 つ目は、写しの置き方をゾーンで指定することです。`<a>`、`<b>`、`<c>` は 3 台のプライベートアドレスに置き換えます。

```bash
sudo -u yugabyte /var/lib/yugabyte/current/bin/yb-admin \
  --master_addresses <a>:7100,<b>:7100,<c>:7100 --certs_dir_name /etc/yugabyte/certs \
  modify_placement_info aws.ap-northeast-1.ap-northeast-1a,aws.ap-northeast-1.ap-northeast-1c,aws.ap-northeast-1.ap-northeast-1d 3
```

3 台が 3 つのゾーンにあるうちは、指定しなくても写しは 1 台に 1 つずつになります。ノードを足したときに、同じゾーンに写しが 2 つ置かれないようにするための設定です。このコマンドの書式は、固定した版の `yb-admin` の表示と、手元のクラスターで実行できたことで確かめました。

2 つ目は、管理者のパスワードを変えることです。認証を有効にした直後のクラスターには、文書に載っている既定のユーザーとパスワード（どちらも `yugabyte`）があります。

```bash
sudo -u yugabyte /var/lib/yugabyte/current/bin/ysqlsh \
  "host=<a> port=5433 dbname=yugabyte user=yugabyte sslmode=verify-ca sslrootcert=/etc/yugabyte/certs/ca.crt"
```

```sql
ALTER ROLE yugabyte WITH PASSWORD '<new password>';
CREATE ROLE notes_api LOGIN PASSWORD '<another password>';
```

アプリケーションには、管理者ではなく専用のロールを使わせます。パスワードは [21章](/ja/chapters/21-security.md)のように Secrets Manager に置きます。Aurora DSQL では、パスワードの代わりに IAM のトークンで接続できました。自分で動かすデータベースでは、パスワードの保管と入れ替えも自分の仕事です。

この章は、アプリケーションをつなぐところまでは作っていません。つなぐときは、Lambda や ECS のタスクをクライアント用のセキュリティグループ（スタックの出力 `ClientSecurityGroupId`）に入れ、`openYugabyte` に 3 台のアドレスと、認証局の証明書（`ca.crt`）と、ロールのパスワードを渡します。マイグレーションは、13章と同じランナーを `postgres` の方言で使います。手元のクラスターでは、この組み合わせが通りました。

## 動かし続ける

<!-- section: 66.operate -->

ここからは、Aurora DSQL では料金に含まれていた仕事です。どれも YugabyteDB の文書の手順を、この章の構成に合わせて書き直したもので、手元でも AWS でも実行していません。

### どの作業にも共通する決まり

一度に止めてよいのは 1 台だけです。止める前に、必ず `vp run distsql:health` が「fully replicated」と答えることを確かめます。写しの足りない tablet があるときに別のノードを止めると、その tablet は過半数を失います。

```bash
vp run distsql:health
vp run distsql:stop b
vp run distsql:start b
vp run distsql:health
```

`distsql:stop` は、ノードを 1 つ指定しないと動きません。

### 版を上げる

文書の手順は、ローリングアップグレードです。新しい版を、いまの版とは別のディレクトリに入れておき、`yb-master` を 1 台ずつ再起動し、次に `yb-tserver` を 1 台ずつ再起動します。ノードとノードのあいだは、少なくとも 60 秒あけます。全部が新しい版で動いたら、`yb-admin promote_auto_flags` と `yb-admin upgrade_ysql` で確定します。確定するまでは古い版に戻せますが、確定したあとは戻せません。文書は、確定するまでの様子見を長くても 2 日にするよう勧めています。

この章の構成では、`src/yugabyte.ts` の版とダイジェストを書き換え、`distsql:fetch --nodes`、`distsql:artifact`、`distsql:install` を実行すると、新しい版が各ノードの別のディレクトリに入り、`current` が新しいほうを指します。導入のスクリプトはサービスを再起動しないので、そのあとの 1 台ずつの再起動は、上の決まりに従って自分で進めます。版はスクリプトの引数で渡しているので、版を変えてもユーザーデータは変わらず、スタックのデプロイでインスタンスが作り直されることはありません。

PostgreSQL の版をまたぐ更新（PostgreSQL 11 を元にした v2024.2 から、15 を元にした版へ）は、追加の手順が要る別の作業です。この章は v2025.2 から始めているので、当面は関係しません。

### 止まったノードを戻す

インスタンスが止まっただけで、ボリュームが無事なら、起こし直せば済みます。systemd が 2 つのプロセスを起動し、ノードは同じアドレスで戻り、止まっていた間の書き込みをリーダーから受け取ります（インスタンスを停止して開始してもプライベートアドレスが変わらないことを前提にしています。この章では確かめていません）。手元のクラスターで SIGKILL のあとに起こし直したのは、この場合にあたります。

インスタンスかボリュームを失った場合は、新しいノードを足して古いノードを外す、という別の作業になります。YugabyteDB はノードをアドレスで見分けるので、新しいインスタンスは、同じ名前を付けても別のノードです。文書の手順は次のとおりです。

- `yb-tserver`: 同じゾーンに新しい `yb-tserver` を起動する。古いほうを `yb-admin change_blacklist ADD <old>:9100` で外す対象にし、`get_load_move_completion` が 100 になるのを待ってから、`change_blacklist REMOVE` で対象から外す
- `yb-master`: 新しい `yb-master` を、`--master_addresses` を空にして起動する。古いほうがすでに死んでいるなら、`change_master_config REMOVE_SERVER <old> 7100`、続けて `ADD_SERVER <new> 7100` の順に実行する。そのあと、すべてのノードの `--master_addresses` と `--tserver_master_addrs` を新しい 3 台に書き換える

この章のスクリプトは、この作業を自動にしていません。`yb-configure` は、3 台が最初から揃っている場合のフラグファイルしか書けません。新しいノードには、新しいアドレスの証明書も要ります。ここまでを自分のクラスターで一度通しておくことが、本番に出す前の最低限の訓練です。

3 台しかないクラスターでは、1 台を失っている間、写しは 2 つです。その間にもう 1 台を失うと、応答が止まります。本番で 3 台より多く持つ理由は、ここにあります。

### バックアップ

22章の考え方は、ここでも同じです。戻せることを確かめたものだけが、バックアップです。

いちばん単純な方法は、SQL として書き出すことです。ノードの上のシェルで、次のように実行します。

```bash
sudo -u yugabyte /var/lib/yugabyte/current/postgres/bin/ysql_dump \
  "host=<a> port=5433 dbname=yugabyte user=yugabyte sslmode=verify-ca sslrootcert=/etc/yugabyte/certs/ca.crt" \
  | gzip | aws s3 cp - "s3://<bucket>/backups/$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
```

書き出しと、別のデータベースへの流し込みは、手元のクラスターで通しました。S3 へ送るところは実行していません。この方法は、データが増えると時間がかかり、戻せるのは書き出した時点だけです。

YugabyteDB には、分散スナップショットもあります。`yb-admin create_database_snapshot` は、全ノードで同じ時点の切り口を作ります。ただし、スナップショットはクラスター自身のボリュームの上のハードリンクで、ディスクやファイルシステムが壊れたときには役に立ちません。クラスターの外へ出すには、スキーマを `ysql_dump` で、メタデータを `export_snapshot` で取り、すべての tablet のスナップショットのディレクトリを手で写す必要があります。文書は、この自動化を YugabyteDB Anywhere の仕事としています。`yugabyted` にも S3 へのバックアップがありますが、ノードを `yugabyted` で起動していることと、YB Controller を入れていることが条件で、この章の構成では使えません。

動いている 3 台の EBS スナップショットを別々に取っても、3 つは同じ時点になりません。それが戻せるバックアップになるかどうかは、読んだ文書には書かれていませんでした。この章では、あてにしていません。

### 見ておくもの

`yb-master`（7000）、`yb-tserver`（9000）、YSQL（13000）は、それぞれ `/prometheus-metrics` でメトリクスを出します。手元のノードでは、時計のずれを表す `hybrid_clock_skew` と、tablet ごとにリーダーかどうかを表す `is_raft_leader` が出ていました。最低限見ておきたいのは、次のものです。

- 写しの足りない tablet と、死んだノード（`distsql:health`）
- 時計のずれと、chrony の参照先（`distsql:status`）
- データボリュームの空き。YugabyteDB の文書は 20% ほどの余裕を勧めています
- 2 つのサービスが再起動を繰り返していないか（`distsql:logs`）
- 証明書の期限

この章は、これらを CloudWatch に送るところまでは作っていません。[19章](/ja/chapters/19-observability.md)のアラームに載せるなら、ノードの上でメトリクスを読んで送る仕組みを足すことになります。
