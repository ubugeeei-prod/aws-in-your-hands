---
title: "38 Data Movement: DataSync、Data Pipeline のいま、データを運ぶ手段の選び方"
revision: 1
---

# 38 Data Movement: DataSync、Data Pipeline のいま、データを運ぶ手段の選び方

[07章](/ja/chapters/07-uploads.md)は、ノートの添付を S3 のバケットに置きました。[22章](/ja/chapters/22-recovery.md)は、そのバケットの中身を消してしまったときの戻し方を扱いました。この章では、バケットの中身を丸ごと、別のリージョンに置いた 2 つ目のバケットへ運びます。運ぶのは AWS DataSync で、1 日 1 回、変わったものだけをコピーします。

著者は、この章を AWS Data Pipeline と DataSync の章として頼まれました。先に書いておくと、AWS Data Pipeline は新しい利用者には提供されていません。ドキュメントのどのページにも「AWS Data Pipeline is no longer available to new customers」と書かれていて、移行を案内する AWS のブログは、新規の受付を 2024 年 7 月 25 日に閉じたと書いています（2026-10-13 に確認）。これから AWS を始める人は、Data Pipeline を使えません。そこでこの章は、Data Pipeline の使い方を説明しません。既存のアカウントで見かけたときに読めるように、何をするサービスだったかを短く説明し、同じ仕事をいま何で組むかを書きます。

章の後半は、もう少し広い問いを扱います。A にあるデータを B に運びたいとき、AWS には手段がいくつもあり、名前だけでは違いがわかりません。一度だけ運ぶのか、定期的に運ぶのか、途切れなく運ぶのかで分けて、どれを選ぶかを書きます。

著者は、この章のタスクを AWS で 1 回も実行していません。手元で確かめたのは、スタックのテンプレートと、DataSync のドキュメントから著者が作った計画のモデルです。モデルは DataSync そのものではないので、どこがモデルなのかは、そのつど書きます。

前提は 07章です。[16章](/ja/chapters/16-long-jobs.md)と 22章は、読んであると話がつながります。コードは `examples/38-data-movement/` にあります。

## 全体像

<!-- section: 38.overview -->

```figure
caption: 東京のバケットを、大阪に置いた DataSync のタスクが 1 日 1 回読み、大阪のアーカイブに書く
node uploads: S3 バケット Uploads | 東京, 07章の添付
node task: DataSync タスク | Basic モード, 毎日 03:00 JST
node archive: S3 バケット Archive | バージョニング
node logs: ロググループ CopyLogs
node rule: EventBridge ルール | SUCCESS と ERROR
node alert: Lambda 関数 Alert
node topic: SNS トピック Alerts
edge uploads -> task: ソースのロケーション
edge task -> archive: デスティネーションのロケーション
edge task --> logs: 転送のエラー
edge task --> rule: 実行の状態の変化
edge rule -> alert
edge alert -> topic: ERROR のときだけ
group tokyo: AihDataMovement (ap-northeast-1) = uploads
group osaka: AihDataMovementArchive (ap-northeast-3) = task, archive, logs, rule, alert, topic
mark task
```

```figure
caption: 1 回の実行は、両側を一覧し、足りないものと違うものをコピーし、コピーしたものを確かめて終わる
type: sequence
actor task: DataSync のタスク実行
actor uploads: Uploads | 東京
actor archive: Archive | 大阪
actor bus: EventBridge
step task -> uploads: PREPARING: 一覧
step task -> archive: PREPARING: 一覧
note task: 違いを決める
step task -> uploads: TRANSFERRING: 読む
step task -> archive: TRANSFERRING: 書く
step task -> archive: VERIFYING: コピーしたもの
step task --> bus: SUCCESS または ERROR
```

1 つ目の図はスタックの中身を、2 つ目の図は 1 回の実行が進む順序を表しています。

スタックは 2 つあります。東京の `AihDataMovement` は、07章と同じ形のバケットと、DataSync がそのバケットを読むためのロール、そして DataSync のロケーション（location）を作ります。ロケーションは「このバケットに、このロールで届く」という登録で、作っただけでは何も動きません。大阪の `AihDataMovementArchive` は、アーカイブのバケットと、そのロケーションを作ります。

コピーを実行するタスク（task）は、大阪のスタックに置きました。DataSync のチュートリアルが、リージョンをまたぐコピーではタスクをデスティネーションのロケーションと同じリージョンに作るように書いているからです。タスクは東京のロケーションの ARN を必要とするので、デプロイは 2 段階になります。東京のスタックを先にデプロイし、出力された ARN を `-c sourceLocation=<ARN>` で大阪のスタックに渡します。渡さなければ、大阪にできるのはバケットとロケーションだけです。

API も画面もありません。この章でアプリにあたるのは、タスクの設定と、実行が終わったことを受け取る小さな関数です。

エージェント（agent）は使いません。エージェントは、自分のネットワークに置く仮想マシンで、NFS や SMB のファイルサーバーを DataSync の代わりに読み書きします。S3 から S3 へのコピーは、同じアカウントでも、別のアカウントでも、別のリージョンでも、エージェントなしで動くとドキュメントの表にあります。

料金は、実行が動いていないあいだは DataSync からは発生しません。料金ページには、前払いも最低料金もないと書いてあります。ただし、スケジュールを有効にしたタスクは毎日動き、コピーするものが 1 つもない日にも、両方のバケットを一覧するリクエストの料金がかかります。金額は[最後のページ](/ja/chapters/38-data-movement/wrap.md)で計算します。

## AWS Data Pipeline のいま

<!-- section: 38.data-pipeline -->

AWS Data Pipeline について、AWS のページから確かめられたことは次のとおりです。

- 新しい利用者には提供されていません。既存の利用者は、これまでどおり使えます
- サービスはメンテナンスモードで、新機能も、対応リージョンの追加も予定されていません
- サポートを終える日付は、ユーザーガイドにも、移行を案内するブログにも見つかりませんでした。日付が決まっていないのか、著者が見つけられなかっただけなのかは、わかりません
- 移行先として AWS が挙げているのは、AWS Glue、AWS Step Functions、Amazon MWAA（Managed Workflows for Apache Airflow）の 3 つです

### 何をするサービスだったか

Data Pipeline は 2012 年に始まったサービスで、決まった時刻に、決まった順序でデータの処理を動かすためのものでした。ドキュメントの例は、Web サーバーのログを毎日 S3 に集め、週に 1 回、そのログの上で Amazon EMR のクラスターを動かして集計する、というものです。週次の集計は、最後の日のログが届くまで待ちます。ある処理が前の処理の成功を待つ、という依存関係を宣言できるところが中心でした。

既存のアカウントで Data Pipeline のパイプラインを開くと、JSON の定義が出てきます。定義に並んでいるのは、次の部品です。

- **データノード（data node）。** 処理の入力や出力になるデータの場所です。`S3DataNode`、`DynamoDBDataNode`、`SqlDataNode`、`RedshiftDataNode` があります
- **アクティビティ（activity）。** 実行する仕事です。`CopyActivity` はデータをコピーし、`ShellCommandActivity` はシェルのコマンドを、`EmrActivity` は EMR のクラスターを、`SqlActivity` は SQL を実行します
- **スケジュール。** アクティビティをいつ動かすかです
- **リソース。** アクティビティを実際に動かす計算機で、`Ec2Resource` か `EmrCluster` です。パイプラインが EC2 のインスタンスを自分で起動し、その上で Task Runner というプログラムが仕事を受け取って実行します
- **前提条件（precondition）。** アクティビティを始める前に成り立っていなければならない条件です。`S3KeyExists` は、S3 にそのキーがあるかどうかを調べます

読むときは、スケジュールから始めて、どのアクティビティがどのデータノードを入力にしているかをたどると、処理の順序が見えてきます。リソースに書かれた EC2 のインスタンスや EMR のクラスターは、あなたのアカウントの中に起動されます。

### 同じ仕事を、いま組むなら

AWS の移行ガイドには、Data Pipeline のことばを移行先のことばに置き換える表があります。Step Functions の列は、この本がすでに使った道具と重なります。

- パイプラインは、[16章](/ja/chapters/16-long-jobs.md)のステートマシンにあたります
- JSON の定義は、Amazon States Language の定義にあたります。16章では CDK で書きました
- アクティビティは、ステートマシンのステップにあたります
- 失敗したときのやり直しは、ステップの `Retry` と `Catch` にあたります
- スケジュールは、[08章](/ja/chapters/08-async.md)の EventBridge Scheduler にあたります

違いは、計算機の持ち方です。Data Pipeline は EC2 のインスタンスを起動して、その上でコマンドを実行しました。16章のステートマシンは、ステップごとに Lambda 関数を呼びます。処理を動かす場所を、パイプラインの定義ではなく、ステップの呼び出し先として選ぶことになります。

移行ガイドが Step Functions を勧めるのは、サーバーを持たずに、複数の AWS のサービスを順に呼ぶ処理です。Glue を勧めるのは、Apache Spark の上で動いている処理と、コンソールのテンプレートから作ったパイプライン（DynamoDB のテーブルを S3 に書き出すものなど）です。MWAA を勧めるのは、Python で書く Apache Airflow に移りたい場合です。Glue と MWAA は、この本では組み立てていません。分析のためのデータの流れは[26章](/ja/chapters/26-analytics.md)が扱います。

この章の仕事を Data Pipeline のことばで書くと、「毎日 1 回、`S3DataNode` から `S3DataNode` へ `CopyActivity` を実行し、失敗したら知らせる」になります。いまは、ステートマシンも要りません。スケジュールは DataSync のタスクが自分で持ち、終わったことは EventBridge のイベントで届くので、順序を管理する部品が 1 つも残らないからです。コピーのあとに別の処理を続けたくなったら、そのときに 16章のステートマシンを足し、ステップの 1 つとしてコピーを呼びます。移行ガイドは、Step Functions が AWS SDK の統合を通じて 250 を超えるサービスの操作を呼べると書いています。DataSync の実行を始めるステップを実際に組むことは、この章ではしていません。

## 運ぶ手段の選び方

<!-- section: 38.choosing -->

「A にあるデータを B に運びたい」と言うとき、決めることは 2 つあります。運ぶものが何か（オブジェクトやファイルか、データベースの行か、次々に生まれるイベントか）と、いつ運ぶか（一度だけか、定期的にか、途切れなくか）です。

| いつ運ぶか | オブジェクト、ファイル | データベース | イベント、ログ |
| --- | --- | --- | --- |
| 一度だけ | DataSync、S3 Batch Operations、`aws s3 sync` | DMS | |
| 定期的に | DataSync のスケジュール | | |
| 途切れなく | S3 Replication | DMS の継続的な複製 | Firehose |

表に入れたのは、著者が今日ドキュメントを開いて確かめたものだけです。それぞれを選ぶ条件を書きます。

**DataSync** は、ストレージのあいだでファイルやオブジェクトをコピーし、転送のあいだにチェックサムで中身を確かめるサービスです。相手は S3 に限りません。NFS や SMB のファイルサーバー、EFS、FSx、ほかのクラウドのオブジェクトストレージも、ソースやデスティネーションにできます。バケットにすでにあるものを運ぶとき、定期的に差分を運ぶとき、S3 ではない場所から運ぶときは、DataSync が合います。スケジュールの間隔は 1 時間より短くできないので、途切れなく運ぶ用途には向きません。

**S3 Replication** は、バケットに書かれた新しいオブジェクトと更新されたオブジェクトを、自動で、非同期に、別のバケットへコピーする機能です。設定するより前からあったオブジェクトは、複製されません。前からあったものは、S3 Batch Replication で、頼んだときに複製します。S3 から S3 へ、書かれたそばから運びたいなら、Replication のほうが DataSync より単純で、遅れも小さくなります。Replication は[28章](/ja/chapters/28-multi-region.md)が扱うので、ここでは立ち入りません。

この章が Replication ではなく DataSync を使うのには、理由があります。S3 のドキュメントによると、Replication は両方のバケットでバージョニングを有効にする必要があります。07章のバケットは、バージョニングを有効にしていません。DataSync は、ソースのバケットの設定を何も変えずに読めます。運びたいものが「いまあるもの全部」で、遅れが 1 日あってもよいアーカイブなら、DataSync で足ります。

**S3 Batch Operations** は、オブジェクトの一覧（マニフェスト）を渡して、その全部に 1 つの操作を実行するジョブです。操作にはコピーのほかに、タグの付け替えや、Lambda 関数の呼び出しがあります。運ぶというより、数の多いオブジェクトに同じ処理を 1 回かけるための道具です。一覧は S3 Inventory のレポートから作れます。

**`aws s3 sync`** は、手元のディレクトリと S3、または S3 と S3 のあいだで、新しいファイルと更新されたファイルをコピーする AWS CLI のコマンドです。コマンドを動かしている端末がコピーを進めるので、定期的に動かしたければ、その仕組みは自分で用意します。数が少なく、1 回で済むなら、これがいちばん手早い手段です。`--delete` を付けると、ソースにないファイルをデスティネーションから消します。

**AWS Transfer Family** は、SFTP、FTPS、FTP、AS2 の受け口を AWS が用意し、届いたファイルを S3 か EFS に置くサービスです。選ぶ条件は、相手が決めます。取引先が「SFTP でしか送れない」と言うときの答えで、自分のデータを自分で運ぶ手段ではありません。

**AWS Database Migration Service（DMS）** は、データベースを運びます。リレーショナルデータベース、データウェアハウス、NoSQL のデータベースを、一度だけ移すことも、変更を追いかけ続けて複製することもできます。データベースのファイルを DataSync でコピーしても、動いているデータベースの一貫した写しにはなりません。データベースには DMS か、そのデータベース自身のバックアップと復元を使います。

**Amazon Data Firehose** は、次々に届くレコードを受け取って、S3 などの宛先にまとめて書くサービスです。運ぶものが、すでに置いてあるオブジェクトではなく、これから生まれるイベントやログなら、Firehose が合います。[26章](/ja/chapters/26-analytics.md)が扱います。

物理的な装置で運ぶ Snow ファミリーについては、Snowball Edge のドキュメントの冒頭に、新しい利用者には提供していないと書かれていました。そのページは、オンラインで運ぶなら DataSync を、装置で運ぶなら AWS Data Transfer Terminal を案内しています。確かめたのはこの 1 ページの冒頭だけで、ほかの Snow の装置と Data Transfer Terminal については調べていません。

Cloudflare R2 とのあいだで運ぶ話は、[最後のページ](/ja/chapters/38-data-movement/wrap.md)に書きます。

[次のページ](/ja/chapters/38-data-movement/build.md)では、DataSync の部品と設定を順に見て、タスクが何をコピーし、何を消すのかを、手元のモデルで確かめます。
