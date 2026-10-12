---
title: "39 Database Migration: DMS、full load、CDC、切り替え"
revision: 1
---

# 39 Database Migration: DMS、full load、CDC、切り替え

[13章](/ja/chapters/13-sql.md)では、新しいデータベースに新しいアプリをつなぎました。この章では、すでに動いているデータベースの中身を、アプリを長く止めずに別のデータベースへ移します。

道具は AWS Database Migration Service（DMS）です。DMS は、いまある行を写し、写している間に起きた変更を追いかけて適用するところまでを引き受けます。その先の、いつ書き込みを止め、何を確かめ、いつアプリの接続先を替えるかは DMS の外にあり、この章の中心はそちらです。

先に、13章の読者に関わることを 3 つ書いておきます。

1 つ目は、13章が中心に据えた Aurora DSQL には、DMS で移せないことです。DMS のソースとターゲットの一覧のどちらにも、Aurora DSQL は載っていません（2026-10-13 に確認）。Aurora DSQL のドキュメントが PostgreSQL からの移行に案内しているのは、テーブルごとに CSV か Parquet へ書き出して Aurora DSQL Loader で読み込む方法で、変更を追いかけ続ける経路は書かれていません。そこでこの章の例は、13章が選択肢として挙げた残りの 2 つ、RDS for PostgreSQL から Aurora PostgreSQL への移行にします。

2 つ目は料金です。この章のスタックは、置いてあるだけなら 1 か月 USD 0.80 で、シークレット 2 つの料金です。**レプリケーションを開始すると、1 DCU で 1 時間 USD 0.1144126570 がかかり始め、止め忘れると 1 か月で USD 83.52 になります**（東京、Single-AZ。エンドポイントを足した内訳は[料金](/ja/chapters/39-database-migration/wrap.md)にあります）。移行元と移行先のデータベースは、この章のスタックには含めていません。どちらも時間単位で課金されるものです。切り替えが済んだら、その日のうちに[片付け](/ja/chapters/39-database-migration/wrap.md)まで進めてください。

3 つ目は、この章のスタックを cdkd 0.296.28 ではデプロイしきれないことです。理由と扱いは[デプロイ](/ja/chapters/39-database-migration/deploy.md)のページに書きました。AWS に対しては何も実行しておらず、DMS も動かしていません。

前提は [13章](/ja/chapters/13-sql.md)の SQL とマイグレーション、[11章](/ja/chapters/11-network.md)の VPC、[22章](/ja/chapters/22-recovery.md)の復旧の考え方です。コードは `examples/39-database-migration/` にあります。ファイルやオブジェクトを移す話は [38章](/ja/chapters/38-data-movement.md)にあり、この章では扱いません。

## 全体像

<!-- section: 39.overview -->

```figure
caption: レプリケーションは VPC の中で動き、古いデータベースから読んで、新しいデータベースへ書く。接続に使う認証情報は Secrets Manager から取る
node app: アプリ | ノートの API
node src: RDS for PostgreSQL | ソース, schema public
node rep: DMS Serverless replication | full-load-and-cdc
node tgt: Aurora PostgreSQL | ターゲット, schema app
node sm: Secrets Manager | シークレット 2 つ
edge app -> src: 書き込み
edge src -> rep: 行と WAL の変更
edge rep -> tgt: INSERT, UPDATE, DELETE
edge rep -> sm: GetSecretValue
group vpc: 11章の VPC, プライベートサブネット = src, rep, tgt
mark rep
```

```figure
caption: 切り替えは replicating、frozen、verified、switched の 4 段階を順に進む。書き込みを受けてよいデータベースは、どの段階でも多くて 1 つ
type: sequence
actor app: アプリ
actor src: ソース
actor dms: DMS
actor tgt: ターゲット
step app -> src: 書き込み
step src -> dms: full load, CDC
step dms -> tgt: 適用
note src: replicating
step app -x src: 書き込み停止
note src: frozen
step dms -> tgt: 残りの変更
note tgt: verified
step app -> tgt: 接続先を替える
note tgt: switched
```

1 枚目の図で、この章のスタックが作るのは、中央のレプリケーションの設定、2 つのシークレット、レプリケーションと 2 つのデータベースの間のセキュリティグループのルールです。2 つのデータベースは、すでにあるものとして受け取ります。

2 枚目の図が、この章でいちばん時間をかけるところです。replicating の間はソースが正で、frozen と verified の間はどちらにも書けず、switched からはターゲットが正になります。DMS が働くのは最初の 2 段階で、残りは人とアプリの側の手順です。

## DMS が運ぶものと運ばないもの

<!-- section: 39.what-dms-is -->

DMS が運ぶのはテーブルの行と、その後の行の変更です。公式ドキュメントは、DMS がターゲットに作るものを「テーブルと主キー、場合によっては一意インデックス」と書いていて、データを移すのに要らないオブジェクトは作らないとしています。

PostgreSQL から PostgreSQL へ移すときに運ばれないと、DMS と PostgreSQL のドキュメントに書かれているものは次のとおりです。

- 主キー以外のインデックスと外部キー。DMS のトラブルシューティングは、ターゲットに手で作るよう案内しています
- シーケンスの現在値。行に入っている番号は行と一緒に運ばれますが、次に何番を出すかは運ばれません
- マテリアライズドビュー。ビューは full load だけのタスクでならテーブルとして写せますが、DMS Serverless はビューに対応していません
- テーブルのパーティションや継承の定義。ターゲットには普通のテーブルとして作られます
- large object（OID で参照する種類の LOB）

トリガー、関数、`CHECK` 制約、列の既定値は、DMS が作るものの一覧に入っていません。ユーザー、ロール、権限を運ぶという記述も見つかりませんでした。どれも、DMS が実際にどう扱うかは確かめていません。

そこでこの章では、ターゲットのスキーマを先に自分ですべて作り、DMS にはテーブルを作らせも消させもしません。DMS が何を作るかに頼らないので、上の「確かめていない」は結果に影響しません。スキーマは 13章と同じように SQL ファイルで持ちます。

<<< @/examples/39-database-migration/sql/target/0001_schema.sql

DMS Schema Conversion は、名前が似ていますが別の用途の機能です。Oracle から PostgreSQL へ、のようにエンジンを替えるときに、スキーマとコードを変換します。同じ PostgreSQL どうしなら変換するものがないので、`pg_dump --schema-only` か、アプリのマイグレーションをターゲットで流すほうが素直です。DMS には、同じエンジンどうしをデータベースの標準のツールで移す homogeneous data migrations という機能もあり、こちらは副次的なオブジェクトも運ぶと書かれています。この章では使っていません。

## 登場する部品

<!-- section: 39.pieces -->

DMS の移行は、4 つの部品でできています。

エンドポイントは、データベースへの接続の設定です。ソース用とターゲット用を 1 つずつ作ります。この章では、ホスト名、ユーザー名、パスワードをエンドポイントに書かず、[21章](/ja/chapters/21-security.md)と同じように Secrets Manager のシークレットから読ませます。

タスクは、どのテーブルを、どう移すかの定義です。移行の種類は 3 つあります。full load は、いまある行を写すだけです。CDC は、変更だけを追いかけます。full load と CDC を続けて行う種類では、写している間に起きた変更を溜めておき、写し終えたテーブルから順に適用して、そのまま変更を追い続けます。止められる時間が短い移行で使うのは、この 3 つ目です。

テーブルマッピングは、タスクの中の JSON で、どのテーブルを選び、名前をどう変えるかを書きます。

残る 1 つが、タスクを実際に動かす計算資源で、ここに 2 つの選び方があります。

| | レプリケーションインスタンス | DMS Serverless |
| --- | --- | --- |
| 作るもの | インスタンスと、その上のタスク | レプリケーションの設定（タスクにあたる内容を含む） |
| 何も動かしていないとき | インスタンスがある間はずっと課金。dms.t3.micro で 1 時間 USD 0.028、1 か月 USD 20.44 | 開始していなければ DCU の課金はない |
| 動かしているとき | インスタンスの料金は同じ | 使っている DCU ぶん。1 DCU で 1 時間 USD 0.1144126570 |
| 容量 | 自分で選ぶ。変えるときは自分で変える | 最小と最大の DCU を決めると、その範囲で増減する |
| CloudFormation のリソース | `AWS::DMS::ReplicationInstance`、`AWS::DMS::ReplicationTask` | `AWS::DMS::ReplicationConfig` |

金額は AWS Price List の東京リージョン、Single-AZ の単価です（2026-10-13 確認）。動かしている時間あたりでは Serverless の 1 DCU は dms.t3.micro の約 4 倍、dms.t3.medium（USD 0.112）とほぼ同じです。それでもこの章が Serverless を選んだのは、移行は終わるものだからです。準備に何日もかかる間、インスタンスは置いてあるだけで料金がかかり、Serverless の設定はかかりません。もう 1 つの理由は cdkd で、固定している版は `AWS::DMS::ReplicationInstance` を作れない種類として最初から断ります。

「開始していない設定に課金がない」は、料金ページの「使った容量に対して時間単位で支払う」と、ユーザーガイドの「レプリケーションが現在使っている DCU に課金する」から読んだものです。請求で確かめてはいません。

## 対応している組み合わせと、DMS が合わない場面

<!-- section: 39.pairs -->

この本が扱うデータベースについて、DMS のソースとターゲットの一覧を読むと次のとおりです（2026-10-13 確認）。

| | ソース | ターゲット |
| --- | --- | --- |
| RDS for PostgreSQL | 10.x から 18.x | 10.x から 18.x |
| Aurora PostgreSQL | できる | できる |
| Aurora Serverless v2 | full load も CDC もできる | できる |
| Aurora DSQL | 一覧にない | 一覧にない |

PostgreSQL 17 と 18 には DMS 3.5.4 以上が要ります。DMS Serverless のエンジンの版は 3.5.4 で、自分では選べません。

RDS for PostgreSQL から Aurora PostgreSQL へ、という組み合わせは DMS で移せます。ただし、この組み合わせに DMS が最良とは限りません。DMS のドキュメント自身が、PostgreSQL から PostgreSQL へデータベースを丸ごと移すなら `pg_dump` などの標準のツールのほうが効果的なことがある、と書いています。次のどれかに当てはまるなら、DMS より先にそちらを検討してください。

- データベースが小さく、メンテナンスの時間を取れる場合。`pg_dump` は、使用中のデータベースからでも一貫した書き出しを作り、ほかの読み書きを妨げません。インデックスも制約もシーケンスの値も一緒に運ばれます。書き込みを止め、書き出し、読み込み、接続先を替えるだけで済みます
- RDS for PostgreSQL から Aurora PostgreSQL へ丸ごと移す場合。Aurora のドキュメントが挙げているのは、スナップショットからの移行と、RDS のインスタンスに Aurora のリードレプリカを付けて、遅れが 0 になったところで独立させる方法です。同じページで DMS の名前が出るのは、PostgreSQL 互換でないデータベースから移す場合だけです
- 同じエンジンのまま版を上げたい、パラメーターを変えたい、という場合。RDS for PostgreSQL と Aurora PostgreSQL には blue/green deployment があり、本番の写しを同期させておいて、多くは 1 分未満で切り替えます。RDS のドキュメントには、切り替えのときにシーケンスの値を合わせるとあります。エンジンを替える用途は、ドキュメントに書かれていません
- PostgreSQL どうしで、移す範囲を自分で細かく決めたい場合。PostgreSQL のロジカルレプリケーションをそのまま使えます。スキーマとシーケンスが運ばれない点は DMS と同じです

DMS が要るのは、これらが使えないときです。テーブルの一部だけを移す、スキーマの名前を変えながら移す、AWS の外や別のアカウントにある PostgreSQL から移す、エンジンが違う、といった場合です。この章の例は、`public` にあったテーブルを 13章の `app` スキーマへ移し、移行用の管理テーブルは置いていく、という形にしてあります。丸ごとの移行ではないので、スナップショットやリードレプリカでは済みません。

## Cloudflare D1 や Vercel から来る場合

<!-- section: 39.other-side -->

D1 のデータを AWS へ持ってくるときに、DMS は使えません。D1 に届く経路は Workers の binding、REST API、Wrangler の 3 つで、データベースの接続プロトコルで外からつなぐ方法はドキュメントにありません。DMS のソースの一覧にも SQLite はありません（どちらも 2026-10-13 確認）。

D1 が用意しているのは `wrangler d1 export` で、データベースを `.sql` ファイルに書き出します。スキーマだけ、データだけ、テーブルを選んで、という指定ができます。書き出している間はほかのリクエストが待たされることと、仮想テーブルを含むデータベースは書き出せないことが、注意として書かれています。書き出されるのは SQLite の SQL なので、PostgreSQL へそのまま流せるとは限りません。型と構文を直す作業が要ります。その変換は、この章では試していません。

Vercel には、いま自前の Postgres はありません。Vercel Postgres は提供を終えていて、既存のデータベースは 2024 年 12 月に Neon へ移されました。新しいプロジェクトは、Marketplace から Neon や Supabase などの Postgres を入れる形です（2026-10-13 確認）。

Neon は PostgreSQL なので、`pg_dump` で書き出せます。プールを通さない接続文字列を使うように、と Neon のドキュメントにあります。小さなデータベースなら、書き込みを止めて `pg_dump` し、AWS 側で読み込むのが確実です。

Neon を DMS のソースにできるかは、確認できませんでした。DMS の一覧にある AWS の外のマネージド PostgreSQL は Azure と Google Cloud だけで、Neon のドキュメントが DMS を扱っているのは Neon をターゲットにする場合だけです。Neon はロジカルレプリケーションの送り側になれますが、SQL で作ったロールには `REPLICATION` 権限を付けられず、使われないスロットは 40 時間ほどで消される、と書かれています。DMS が自己管理の PostgreSQL に求めるのはスーパーユーザーの権限なので、組み合わせて動く保証はどちらのドキュメントからも読み取れません。

D1 や Neon で足りているなら、移す理由はありません。移行は、止める時間と確かめる手間を払う作業です。次のページから、その手間の中身を見ていきます。

続きは[しくみと実装](/ja/chapters/39-database-migration/build.md)です。
