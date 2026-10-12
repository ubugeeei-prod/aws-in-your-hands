---
title: "13 SQL: デプロイ"
---

# 13 SQL: デプロイ

## Lambda からつなぐ

<!-- section: 13.connect -->

### 接続

<<< @/examples/13-sql/src/dsql.ts{dsql}

`password` に関数を渡しているのが、DSQL らしいところです。node-postgres は、新しい接続を張るたびにこの関数を呼びます。関数は、その場で token を署名して返します。

token の署名は、手元の計算だけで終わります。AWS に問い合わせません。だから速いのですが、認証情報が間違っていても、token は作れてしまいます。失敗がわかるのは、つなぎに行ったときです。

token の期限は既定で 15 分。ただし、期限を見られるのは接続するときだけで、つながった接続は token が切れたあとも使えます。接続のほうには別の上限があって、DSQL は 60 分で切ります。なので `maxLifetimeSeconds` で、50 分たった接続は自分から捨てるようにしています。

`max: 1` は、Lambda の実行環境が一度に 1 つのリクエストしか処理しないからです。接続の数は、だいたい同時に動いている実行環境の数になります。cluster の上限は既定で 10,000 接続、新しい接続は毎秒 100 本までです。

TLS は `rejectUnauthorized: true`。証明書の連鎖とホスト名を、Node.js が持っている認証局の一覧で確かめます。

<<< @/examples/13-sql/src/lambda.ts{handler}

04章と同じで、ファイルのいちばん外側は実行環境ごとに 1 回だけ動きます。pool もそこで 1 つ。2 回目からの呼び出しは、開いたままの接続を使い回します。

設定は起動時に確かめます。

<<< @/examples/13-sql/src/env.ts{env}

### cluster と権限

<<< @/examples/13-sql/infra/lib/sql-stack.ts{cluster}

拍子抜けするくらい、何もありません。instance の大きさも、subnet も、パスワードも選びません。固定している版の CDK（aws-cdk-lib 2.273.0）には、DSQL 用の高水準の construct がまだ無いので、CloudFormation の `AWS::DSQL::Cluster` をそのまま表す `CfnCluster` を使っています。

練習用なので、削除保護は切って、stack と一緒に消えるようにしました。本番では逆にします。

<<< @/examples/13-sql/infra/lib/sql-stack.ts{role}

権限は 2 段になっています。

1 段目が IAM。`dsql:DbConnect` は「この cluster に、admin 以外の database role でつないでいい」という許可です。似た名前の `dsql:DbConnectAdmin` は、`admin` としてつなぐ許可。関数には渡していません。`admin` になれると、table を消せてしまうので。

2 段目が DB の中。つないだあと、どの table に何ができるかは、database role への `GRANT` で決まります。

<<< @/examples/13-sql/src/grant.ts{grant}

`AWS IAM GRANT` は DSQL 独自の文で、「この IAM role は、この database role としてログインしていい」を登録します。`GRANT` で渡しているのは行の読み書きだけ。関数は schema を変えられません。migration は、あなたが `admin` として手元から流します。

この 2 つの文は `$1` を受け付けないので、名前を文字列に埋め込むしかありません。さっき「値は埋め込まない」と言ったばかりですが、ここは例外です。だから、埋め込む前に形を厳しく確かめて、テストも付けました。

<<< @/examples/13-sql/infra/lib/sql-stack.ts{function}

bundle の形式を CommonJS にしたのは、node-postgres が CommonJS で、Node.js の標準モジュールを `require()` で読むからです。synth でできた bundle を手元の Node.js 24 で読み込んで、DB に触らない route が応答するところまでは確かめました。

## デプロイして、migration を流す

<!-- section: 13.deploy -->

ここからは AWS を変更します。正直に言うと、この節の手順は、まだ一度も実際の AWS で通せていません。

```bash
vp run sql:infra:diff
vp run sql:infra:deploy
```

cluster、関数、API ができます。でも、まだ動きません。cluster は空っぽで、関数の role も DB に入れないからです。D1 でも、database を作っただけでは table は無いですよね。

```bash
vp run sql:db:migrate
vp run sql:db:grant
```

`sql:db:migrate` は、手元と同じ migration を、今度は `ASYNC` を付けたまま流します。index の文が返す job の ID を使って、`sys.jobs` を見ながら完了を待ちます。`sql:db:grant` は、さっきの `GRANT` を流して、関数の role を `notes_api` に結びつけます。

どちらも、`admin` としてつなぎます。あなた自身の認証情報に `dsql:DbConnectAdmin` が要ります。

順番は、migration が先です。`GRANT ... ON ALL TABLES` が効くのは、その時点で存在する table だけ。あとで table を足す migration を流したら、`sql:db:grant` ももう一度流してください。

```bash
vp run sql:smoke
```

作成、読み戻し、更新、古い `version` での更新（409 を期待）、削除を順に確かめます。04章の smoke と違って、読み戻しは必ず成功するはずです。

seed を入れたければ `vp run sql:db:seed`。ログは `vp run sql:logs` で、競合でやり直した回数は `transaction retry` の行でわかります。drift の検査は `vp run sql:infra:drift` です。

1 つ、気にしておきたいことがあります。固定している版の cdkd（0.296.28）は、`AWS::DSQL::Cluster` に専用の実装を持っていません。Cloud Control API 経由で扱います。作成、endpoint の組み立てに使っている identifier の取得、drift の読み戻し、削除が実際に通るかは、未確認です。

### reset を cloud 用に作らなかった理由

`sql:db:reset:local` はありますが、`sql:db:reset` はありません。わざとです。

cloud の reset は、table を全部消す、という意味になります。それをコマンド 1 つで打てるようにしておくと、いつか本番に向けて打ちます。練習用の cluster をまっさらにしたいときは、stack ごと消して作り直してください。

### 動いている DB の schema を変えるとき

D1 でも同じですが、migration とコードのデプロイは、同時には起きません。古いコードが新しい schema で動く時間が、必ずあります。

DSQL だと、ここに制約が重なります。`ADD COLUMN` で足せるのは、制約も既定値もない列。なので、列を足す、新しいコードを出す、古い行を埋める（1 回の transaction は 3,000 行まで）、という段階に分けることになります。この章では、そこまでは実装していません。

## backup と restore

<!-- section: 13.backup -->

D1 には Time Travel があって、何も設定しなくても、過去 30 日の好きな分に戻せます。あれに慣れていると、ここは手間が増えます。

Aurora DSQL の backup は、AWS Backup という別のサービスを通します。取れるのは cluster 全体の backup で、その場で 1 回取るか、スケジュールと保持期間を決めて自動で取るか。restore は、いつも**新しい cluster** を作ります。元の cluster を巻き戻すわけではありません。

つまり restore のあとには、アプリの向き先を新しい endpoint に変える作業が残ります。この章の stack なら、cluster の identifier から endpoint を組み立てているので、そこを差し替えることになります。database role と `AWS IAM GRANT` が新しい cluster に引き継がれるかは、確かめていません。

DSQL のドキュメントの backup のページには、「何時何分の状態に戻す」という機能の説明はありませんでした。失ってもいい時間の長さは、backup を取る間隔で決まる、と考えておくのが安全です。

もう 1 つ。使われていない cluster は Idle、さらに Inactive という状態に移って、計算資源が 0 になります。backup は Active の cluster でないと取れません。夜中のスケジュールで、誰も使っていない cluster の backup が失敗する、ということが起きえます。

RDS と Aurora は、自動 backup を持っています。Aurora は連続的に取っていて、保持期間（1〜35 日）の中の好きな時点に戻せます。こちらも、戻すと新しい instance や cluster ができます。

この章では、backup を取るリソースは作っていません。練習用のデータなので。手順として試せてもいません。
