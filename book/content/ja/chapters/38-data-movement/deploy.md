---
title: "38 Data Movement: デプロイ"
---

# 38 Data Movement: デプロイ

このページでは、2 つのスタックを順にデプロイし、タスクを 1 回手で実行して、アーカイブにオブジェクトが届くところまでを確かめます。著者は、このページの手順を AWS で実行していません。期待する結果として書いたことは、ドキュメントから読み取ったものです。

## AWS にのせる

<!-- section: 38.deploy -->

スタックの形は、コンテキストで決まります。

<<< @/examples/38-data-movement/infra/bin/app.ts{context}

何も付けなければ、できるのはバケットが 2 つ、ロールが 2 つ、ロケーションが 2 つです。動くものは 1 つもありません。`-c sourceLocation=<ARN>` を付けると、大阪のスタックに、スケジュール付きのタスク、ロググループ、ルール、関数、トピックが加わります。

<<< @/examples/38-data-movement/infra/bin/app.ts{stacks}

### cdkd が作れるリソースか

固定した版の cdkd（0.296.28）は、リソースの種類ごとに専用の実装を持ち、実装のない種類は Cloud Control API に任せます。インストールしたパッケージの `dist` を読んで、この章のスタックが使う種類を調べました。

専用の実装があるのは、`AWS::S3::Bucket`、`AWS::S3::BucketPolicy`、`AWS::IAM::Role`、`AWS::IAM::Policy`、`AWS::Lambda::Function`、`AWS::Lambda::Permission`、`AWS::Logs::LogGroup`、`AWS::Events::Rule`、`AWS::SNS::Topic`、`AWS::SNS::TopicPolicy` です。

実装がないのは、`AWS::DataSync::LocationS3`、`AWS::DataSync::Task`、`AWS::Logs::ResourcePolicy` の 3 つです。この 3 つは、Cloud Control API の対応一覧に、作成、読み取り、更新、削除、一覧のすべてが載っています。cdkd が Cloud Control API では扱えないとしている種類の一覧にも、入っていません。ここまでが、読んで確かめられたことです。cdkd がこの 3 つを実際に作れるかは、デプロイしていないので、わかりません。作れなかった場合は、エラーの内容を控えて、同じテンプレートを AWS CDK の CLI でデプロイできるかを試すことになります。

スタックのテストは、使っている種類の一覧を固定しています。種類が 1 つ増えれば、この調べ直しが要ることに、テストが気づかせます。

### デプロイの手順

```bash
vp run move:infra:diff
vp run move:infra:deploy
AIH_AWS_REGION=ap-northeast-3 vp run infra:bootstrap
vp run move:archive:infra:deploy -c sourceLocation=arn:aws:datasync:ap-northeast-1:123456789012:location/loc-xxxxxxxxxxxxxxxxx
```

2 行目の出力に `SourceLocationArn` が出るので、その値を 4 行目に渡します。3 行目は、大阪リージョンに cdkd の保存場所を用意します。[10章](/ja/chapters/10-edge.md)が `us-east-1` に対してしたのと同じ準備です。大阪リージョンを一度も使ったことがないアカウントで、ほかに要る準備があるかは、確かめていません。

4 行目が終わった時点から、タスクは毎日 18:00 UTC に動きます。スケジュールを止めたいときは、スタックを消すか、`sourceLocation` を付けずにデプロイし直して、タスクを外します。

通知を受け取るには、トピックを購読します。スタックは購読を作りません。メールアドレスをソースに書きたくないからです。

```bash
aws sns subscribe --region ap-northeast-3 --topic-arn <AlertTopicArn> --protocol email --notification-endpoint you@example.com
```

### 実行して確かめる

スケジュールを待たずに、手で 1 回実行します。

```bash
aws s3 cp ./photo.png s3://<UploadsBucketName>/u/demo/n1/a1
aws datasync start-task-execution --region ap-northeast-3 --task-arn <TaskArn>
aws datasync describe-task-execution --region ap-northeast-3 --task-execution-arn <TaskExecutionArn>
aws s3 ls s3://<ArchiveBucketName>/u/demo/ --recursive
aws logs tail <CopyLogGroupName> --region ap-northeast-3 --since 1h
```

2 行目は、タスク実行の ARN を返します。3 行目を何度か実行すると、`Status` が `PREPARING`、`TRANSFERRING`、`VERIFYING` と進み、`SUCCESS` で止まるはずです。同じ応答に、`FilesTransferred`、`BytesTransferred`、`FilesSkipped`、`FilesVerified` の数が入っています。1 枚だけ置いたなら、`FilesTransferred` に見えるのは、その 1 枚と、プレフィックスにあたるものの数です。ドキュメントは、S3 のプレフィックスをディレクトリとして数えると書いているので、1 にはならないかもしれません。

4 行目でアーカイブに同じキーが見えれば、コピーは届いています。5 行目のロググループは、エラーがなければ、ほとんど空のはずです。

確かめたいことが、あと 3 つあります。どれも、手元のモデルでは答えが出ないものです。

- **同じ実行をもう一度。** 2 行目と 3 行目を繰り返して、`FilesTransferred` が 0 になることを見ます。何もコピーしない実行に、どれだけ時間がかかるかも、ここでわかります
- **差し替え。** 同じキーに別のファイルを置いてから実行し、アーカイブに新しいバージョンができることを `aws s3api list-object-versions` で見ます
- **失敗の通知。** 失敗する実行を安全に作る方法を、著者は用意していません。関数の動きだけなら、Lambda のコンソールのテストに、[しくみと実装のページ](/ja/chapters/38-data-movement/build.md)で説明した形のイベントを `State` を `ERROR` にして渡すと、通知が届くかどうかを確かめられます

### ドリフト

```bash
vp run move:infra:drift
```

ドリフトの検査は、東京のスタックを見ます。大阪のスタックのドリフトを見るタスクは、用意していません。タスクのスケジュールは、DataSync 自身が無効にすることがあります。その変化がドリフトとして報告されるのかは、確かめていません。スケジュールの状態は、`aws datasync describe-task --region ap-northeast-3 --task-arn <TaskArn>` の `Schedule` で直接見られます。`Status` が `DISABLED` で `DisabledBy` が `SERVICE` なら、DataSync が止めています。理由は `DisabledReason` に入ります。

[次のページ](/ja/chapters/38-data-movement/wrap.md)で、料金と、つまずきやすいところと、片付けを扱います。
