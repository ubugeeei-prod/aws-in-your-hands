---
title: "53 EFS: 費用、注意点、片付け"
---

# 53 EFS: 費用、注意点、片付け

[前のページ](/ja/chapters/53-efs/local.md)までで、リポジトリとスタックができ、手元では 2 つのプロセスが同じディレクトリを使えました。このページでは、デプロイの手順、バックアップとレプリケーション、Cloudflare や Vercel との違い、注意点、片付けを扱います。料金は[最初のページ](/ja/chapters/53-efs.md)にあります。

## デプロイして確かめる

<!-- section: 53.deploy -->

この節の手順は、実際の AWS では実行していません。

先に 11章のスタックが要ります。既定の構成で足り、NAT ゲートウェイもインターフェースエンドポイントも要りません。

```bash
vp run net:infra:deploy
vp run efs:infra:diff
vp run efs:infra:deploy
```

デプロイには数分かかるはずです。マウントターゲットができるのを待ち、そのあと Lambda が VPC の中にネットワークインターフェースを用意します。ドキュメントによると、そのあいだ関数は Pending の状態で、呼び出せません。

出力の `ApiUrl` を使って確かめます。

```bash
curl -s -X POST "$API_URL/notes" -H 'content-type: application/json' -d '{"title":"first note on EFS"}'
curl -s "$API_URL/notes"
```

04章の関数では、2 行目が空の一覧を返すことがありました。POST と GET が別の実行環境に届くと、メモリが別だからです。この章では、どの実行環境に届いても同じ一覧が返るはずです。確かめるには、同時に何本もリクエストを送って実行環境を増やしてから、一覧を繰り返し読みます。別の実行環境が書いたノートが一覧に出るまでに遅れがあるかどうかは、ここで初めて分かります。

設定は、次のコマンドで読めます。

```bash
aws efs describe-file-system-policy --file-system-id "$FILE_SYSTEM_ID"
aws efs describe-mount-targets --file-system-id "$FILE_SYSTEM_ID"
```

ドリフトの検査は、ほかの章と同じです。

```bash
vp run efs:infra:drift
```

固定している版の cdkd は、アクセスポイントのプロパティを変える更新を受け付けません。EFS にアクセスポイントを書き換える API がないためだと cdkd のソースにあり、`--replace` を付けるか、作り直すよう求められます。`src/config.ts` のパスやユーザー ID を変えるときは、スタックを消して作り直すつもりでいてください。ファイルシステムの暗号化とパフォーマンスモードも、作ったあとでは変えられません。

## バックアップとレプリケーション

<!-- section: 53.protect -->

Regional のファイルシステムは、データを複数の AZ に持ちます。これが守るのは、ディスクや AZ の故障です。間違って消したファイルや、バグで書き換えたファイルは、すべての AZ で同じように消え、書き換わります。[22章](/ja/chapters/22-recovery.md)で見たとおり、冗長化はバックアップではありません。

EFS のバックアップは AWS Backup が取ります。ファイルシステムの `BackupPolicy` を有効にすると、EFS が用意する既定のバックアッププランに入り、毎日 1 回、35 日間保持するバックアップが取られます。バックアップは増分で、リストアは新しいファイルシステムにも、既存のファイルシステムにもできます。コンソールで作ったファイルシステムでは既定で有効、API や CloudFormation で作った Regional のファイルシステムでは既定で無効です。

この章のスタックは、既定ではバックアップを無効にしています。有効にするには、こうします。

```bash
vp run efs:infra:deploy -c backup=true
```

無効にしている理由は、片付けです。復旧ポイントは既定のバックアップボールトに入り、スタックを消しても残って、保存の料金がかかり続けます。しかも、このボールトのアクセスポリシーは復旧ポイントの削除を拒否する設定になっていて、消すにはポリシーを先に変える必要があります。AWS Backup の料金は、この章では調べていません。

バックアップを取っているあいだにファイルが変わると、バックアップの中身が食い違うことがある、ともドキュメントにあります。この章の書き方なら、1 つのノートは 1 つのファイルで、rename でしか現れないので、バックアップに半端なノートが入ることは考えにくいですが、確かめてはいません。

レプリケーションは、別のリージョン（または同じリージョン）のファイルシステムに、変更を続けて写す機能です。ドキュメントは、RPO と RTO を分単位にする設計だとしています。この章では使っていません。固定している版の cdkd は、ファイルシステムの `ReplicationConfiguration` を扱わない、と自分のソースに書いています。リージョンをまたぐ構成そのものは [28章](/ja/chapters/28-multi-region.md)の話題です。

## Cloudflare や Vercel から来た人へ

<!-- section: 53.platforms -->

以下は 2026-10-13 時点の公式ドキュメントの内容です。

Cloudflare Workers には、`node:fs` の実装があります。ドキュメントによると、これはメモリ上の仮想ファイルシステムで、`/bundle` は読み取り専用、`/tmp` には書けますが、その内容は永続せず、リクエストごとに別です。同じリクエストの中で一時ファイルを使うライブラリを動かすためのもので、Worker どうしが共有するディスクではありません。

Vercel の Functions は、ドキュメントによると、読み取り専用のファイルシステムに、500 MB までの書き込める `/tmp` が付きます。これも、関数のインスタンスどうしで共有する場所とは書かれていません。

Vercel の同じページは、関数からデータストアに接続する形を案内しています。Cloudflare で実行をまたいでデータを残す手段は、R2、KV、D1 など、この本のほかの章で触れてきたものです。複数の関数が同時にマウントする NFS のようなものは、読んだページには見当たりませんでした。ここで読んだのは上の 2 ページだけで、両社の製品をすべて調べたわけではありません。

AWS でも、ほとんどの場合はそれが正しい置き方です。この本のアプリケーションは、04章から 24章まで、共有のファイルシステムなしで作れました。EFS が要るのは、パスを要求するソフトウェアを複数の実行環境で動かすときで、それは Workers や Vercel の Functions にそもそも載せにくい種類のソフトウェアです。そういうものが無いなら、R2 や S3 のままでいるほうが、料金も、考えることも少なく済みます。

## つまずきやすいところ

| 症状 | 見るところ |
| --- | --- |
| デプロイで、関数の作成が失敗する | マウントターゲットが関数のサブネットと同じ AZ にあるか、関数とマウントターゲットのセキュリティグループが 2049 番ポートを通すかを確かめます |
| 関数がマウントに失敗する | アクセスポイントのルートディレクトリが作られているかを確かめます。`creationInfo` が無いと作られません。次に、ロールに `ClientMount` があるか、条件のアクセスポイントの ARN が合っているかを見ます。このスタックのポリシーは TLS を使わない接続を拒否するので、切り分けるときは、その Deny を一時的に外して試します |
| 書けない（permission denied） | アクセスポイントのユーザー ID と、ディレクトリの所有者とモードを比べます。ルートディレクトリがすでにあった場合、`creationInfo` の値では上書きされません |
| 別の実行環境が書いたファイルが、すぐに見えない | NFS のクライアントのキャッシュの可能性があります。この章では測っていません |
| 請求の読み取りが、保存量に比べて大きい | 小さなファイルを何度も読んでいないかを確かめます。Elastic スループットは、小さな読み取りにも最低の単位で課金します。`MeteredIOBytes` を見ます |
| 小さなファイルを IA に移したら、請求が増えた | IA は 1 ファイルを最低 128 KiB として課金します |
| ログファイルの行が欠けたり、混ざったりする | 複数の書き手が 1 つのファイルに追記しています。書き手ごとにファイルを分けます |
| スタックを消したのに、EFS の料金が続く | `dataOnDestroy=retain` で残したファイルシステムか、AWS Backup の復旧ポイントが残っています |
| 関数が長く呼ばれなかったあと、最初の呼び出しが失敗する | ドキュメントによると、VPC につないだ関数が 14 日間使われないと、Lambda はネットワークインターフェースを回収し、関数は Inactive になります。次の呼び出しは失敗し、用意ができるまで Pending になります |

## 本番にするなら

- ファイルシステムを残す設定にする。`-c dataOnDestroy=retain` で、スタックを消してもファイルシステムとノートが残ります。あわせてバックアップを有効にし、リストアを一度やってみます（22章）
- 読み書きの量にアラームを付ける。Elastic スループットには上限がありません。`MeteredIOBytes` にアラームを付け、予算（[32章](/ja/chapters/32-limits.md)）にも入れます
- 関数のコードから、ネットワークインターフェースの操作を取り上げる。VPC のための 6 つの許可は、関数のコードからも使えてしまいます。Lambda のドキュメントは、`lambda:SourceFunctionArn` を条件にした Deny を足す方法を載せています。この章のスタックには入れていません
- 残された一時ファイルを消す。`incoming/` の古いファイルを、定期的に消す処理を足します
- アプリケーションごとにアクセスポイントを分ける。ディレクトリとユーザー ID を別にして、ロールの条件でアクセスポイントを固定します
- 一覧をファイルの全件読みにしない。件数が増えるなら、一覧に要る項目だけを別の場所（DynamoDB など）に持つか、そもそもノートをファイルに置くのをやめます
- 同じノートを更新する操作を足すなら、ファイルの上でロックを組み立てる前に、条件付き書き込みのあるデータベースを検討する

## 片付け

<!-- section: 53.cleanup -->

```bash
vp run efs:infra:destroy
```

ファイルシステム、マウントターゲット、アクセスポイント、関数、API、ロール、セキュリティグループ、ロググループが消えます。ファイルシステムの中のノートも一緒に消え、戻せません。練習用なので、どのリソースもスタックと一緒に消える設定にしてあります。

Lambda が VPC に作ったネットワークインターフェースは、すぐには片付きません。ドキュメントには、関数から VPC の設定を外したとき、削除に最大で 20 分かかるとあります。関数を消したときも同じなら、そのあいだはセキュリティグループが消せず、destroy が待たされるか失敗する可能性があります。確かめていないので、失敗したら時間を置いてもう一度実行してください。ネットワークインターフェースの削除には関数のロールが使われるので、ロールだけを先に手で消さないでください。

残るものは次のとおりです。

- `-c dataOnDestroy=retain` でデプロイした場合の、ファイルシステム。保存の料金が続きます。消すには、コンソールか `aws efs delete-file-system` を使います
- `-c backup=true` でデプロイした場合の、AWS Backup の復旧ポイント。保持期間が過ぎるまで残り、料金がかかります
- 11章のスタック。この章のスタックは 11章の出力を読んでいるので、消す順序はこの章が先です。そのあと、要らなければ 11章の手順で消します
- cdkd の bootstrap で作った保存場所（02章）

## 分散システムとして見ると

- 状態の持ち主: ノートの状態を持っているのは、ファイルシステムだけです。関数のメモリには何もありません。23章では、プロセスのメモリとファイルの両方に状態があり、プロセスが 1 つだから一致していました
- 不変条件: 読む側が、書きかけのノートのファイルを見ることはない
- 不変条件を壊そうとするテスト: 書き込みの各段階での中断、その場での上書き、同じノートへの 2 つの書き手、共有された一時ファイル名、8 つの書き手と 1 つの読み手の並行実行
- 守っている仕組み: 書き手ごとに別の一時ファイル、`fsync` のあとの `rename`、1 件 1 ファイル。ロックは使っていません
- 保証していないこと: 同じノートへの同時の更新で、両方の変更が残ること。別の実行環境の書き込みが、すぐに見えること。件数の上限が正確であること。失敗を返した書き込みが、保存されていないこと
- 整合性の範囲: 1 つのファイルの中身は、全部か無かです。複数のファイルにまたがる変更を、まとめて全部か無かにする方法はありません。一覧は、読んでいるあいだに増えたり減ったりするファイルの集まりを、1 件ずつ読んだ結果です
- 部分的な失敗: rename が済んだあとで応答が失われると、呼び出した側は失敗を受け取り、ノートは保存されています。API は 500 を返し、やり直すと別の ID で 2 件目ができます。重複を避けたいなら、[08章](/ja/chapters/08-async.md)の冪等性キーが要ります

::: details この章の検証メモ

**手元で確かめたこと。** テスト 53 件（メモリ上の共有ファイルシステムでの中断、手元の本物のファイルシステムでの上書き・rename・23章のリポジトリの消失・追記、04章の API を 2 つ載せたときの動き、パスを抜け出す ID の拒否、スタックの assertion）。型検査。`efs:infra:synth` で、既定の構成と `-c dataOnDestroy=retain -c backup=true` のテンプレートが、AWS に問い合わせずに生成されること。`dev:efs` を 2 つのポートで起動し、片方に POST したノートがもう片方の一覧に出ること。`vp check --fix` を自分のファイルにかけ、awscdk-lint を含めて警告が出ないこと。本物のファイルシステムのテストを動かしたのは、macOS の APFS の上だけです。

**まだ確かめていないこと。** AWS では何も実行していません。とくに次の点は、ドキュメントから読み取っただけです。

- スタックのデプロイ。cdkd の EFS のプロバイダーでの作成、関数の作成時にマウントターゲットが見つかること、アクセスポイントのルートディレクトリが初回のマウントで作られること
- Deny だけのファイルシステムポリシーが受け付けられること、その下で Lambda がマウントできること。Lambda が TLS でマウントするという記述は、2020 年の公式ブログにしか見つけていません
- NFS の上での挙動。別の実行環境の書き込みが見えるまでの遅れ、Lambda が使うマウントオプション、追記が実際にどう壊れるか。追記の 2 つ目のテストはモデルで、NFS のクライアントの実装を写したものではありません
- Elastic スループットの計量。「最初の 32 KiB のあと 1 KiB 刻み」を、32 KiB 以下の操作は 32 KiB として数える、と読んで計算しました。メタデータの操作の回数は数えていません
- CloudFormation で `LifecyclePolicies` を書かずに作ったファイルシステムに、ライフサイクルのポリシーが付かないこと
- ドキュメントの「同期的で、追記ではない書き込みには read-after-write の整合性がある」が、どの条件を指すのか
- destroy のときに、ネットワークインターフェースの片付けを待ってセキュリティグループが消せること
- Amazon S3 Files の料金、東京リージョンで使えるか、同期の遅れ。概要のページを読んだだけです
- AWS Backup の料金
- 関数の実行時間とログの量。料金の仮定で、計測していません

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 全体像 | `examples/53-efs/infra/lib/efs-stack.ts`、`src/config.ts` | `efs:infra:synth` |
| マウントターゲットとアクセスポイント | `examples/53-efs/infra/lib/efs-stack.ts`、`src/config.ts`、`infra/test/efs-stack.test.ts` | `test:unit` |
| 性能、スループット、ストレージクラス | `examples/53-efs/infra/lib/efs-stack.ts`、`infra/test/efs-stack.test.ts` | `test:unit` |
| NFS の約束 | `examples/53-efs/test/two-writers.test.ts` | `test:unit` |
| 書き手が何人いても壊れない書き方 | `examples/53-efs/src/note-files.ts`、`src/node-dir.ts`、`test/note-files.test.ts`、`test/two-writers.test.ts` | `test:unit` |
| 関数にマウントする | `examples/53-efs/src/compose.ts`、`src/lambda.ts`、`infra/lib/efs-stack.ts`、`infra/bin/app.ts` | `test:unit`、`efs:infra:synth` |
| 2 つのプロセスと 1 つのディレクトリ | `examples/53-efs/src/dev.ts` | `dev:efs`、`test:unit` |
| デプロイして確かめる | `examples/53-efs/infra/bin/app.ts` | `efs:infra:diff`、`efs:infra:deploy`、`efs:infra:drift` |
| バックアップとレプリケーション | `examples/53-efs/src/config.ts` | `efs:infra:deploy` |
| 料金 | `data/pricing/` | |
| 片付け | `tools/src/infra/` | `efs:infra:destroy` |

**cdkd（0.296.28）での扱い。** インストールした npm パッケージの `dist/` で確かめました。`AWS::EFS::FileSystem`、`AWS::EFS::MountTarget`、`AWS::EFS::AccessPoint` は、cdkd 自身の EFS のプロバイダーに登録されています。このスタックが使うファイルシステムのプロパティ（`Encrypted`、`PerformanceMode`、`ThroughputMode`、`BackupPolicy`、`FileSystemPolicy`、`FileSystemTags`）は、どれもプロバイダーが扱う一覧に入っています。`AWS::Lambda::Function` の `FileSystemConfigs` と `VpcConfig` も、Lambda のプロバイダーがそのまま渡します。残りの種類（`AWS::EC2::SecurityGroup` と、その Ingress と Egress、`AWS::IAM::Role`、`AWS::IAM::Policy`、`AWS::Lambda::Permission`、`AWS::Logs::LogGroup`、`AWS::ApiGatewayV2::*`）は、04章、11章、12章のスタックがすでに使っているものです。

**一次情報**（確認日はすべて 2026-10-13）

- EFS ユーザーガイド: [How Amazon EFS works](https://docs.aws.amazon.com/efs/latest/ug/how-it-works.html)、[Features of Amazon EFS](https://docs.aws.amazon.com/efs/latest/ug/features.html)、[Performance specifications](https://docs.aws.amazon.com/efs/latest/ug/performance.html)、[Quotas](https://docs.aws.amazon.com/efs/latest/ug/limits.html)、[Managing storage lifecycle](https://docs.aws.amazon.com/efs/latest/ug/lifecycle-management-efs.html)、[How Amazon EFS reports file system and object sizes](https://docs.aws.amazon.com/efs/latest/ug/metered-sizes.html)
- アクセスと暗号化: [Working with access points](https://docs.aws.amazon.com/efs/latest/ug/efs-access-points.html)、[Enforcing a user identity](https://docs.aws.amazon.com/efs/latest/ug/enforce-identity-access-points.html)、[Enforcing a root directory](https://docs.aws.amazon.com/efs/latest/ug/enforce-root-directory-access-point.html)、[Using IAM to control access to file systems](https://docs.aws.amazon.com/efs/latest/ug/iam-access-control-nfs-efs.html)、[Encrypting data in transit](https://docs.aws.amazon.com/efs/latest/ug/encryption-in-transit.html)、[Encrypting data at rest](https://docs.aws.amazon.com/efs/latest/ug/encryption-at-rest.html)、[Backing up EFS file systems](https://docs.aws.amazon.com/efs/latest/ug/awsbackup.html)
- 料金: [Amazon EFS Pricing](https://aws.amazon.com/efs/pricing/)、[AWS Price List bulk API: AmazonEFS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEFS/current/ap-northeast-1/index.json)（offer の発行日は 2026-09-11。Lambda、API Gateway、S3、EBS の単価は、04章、07章、23章で確認したものを使っています）
- Lambda: [Configuring file system access for Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/configuration-filesystem.html)、[Configuring Amazon EFS file system access](https://docs.aws.amazon.com/lambda/latest/dg/configuration-filesystem-efs.html)、[Giving Lambda functions access to resources in an Amazon VPC](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html)、[AWSLambdaVPCAccessExecutionRole](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AWSLambdaVPCAccessExecutionRole.html)、[New – A Shared File System for Your Lambda Functions](https://aws.amazon.com/blogs/aws/new-a-shared-file-system-for-your-lambda-functions/)（2020-06-16 の公式ブログ）
- ECS と Fargate: [Use Amazon EFS volumes with Amazon ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/efs-volumes.html)、[Specify an Amazon EFS file system in a task definition](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/specify-efs-config.html)
- S3 と EBS: [Working with Amazon S3 Files](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-files.html)、[What is Amazon S3?（data consistency model）](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html)、[EBS Multi-Attach](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-volumes-multi.html)
- Linux の man ページ: [open(2)](https://man7.org/linux/man-pages/man2/open.2.html)、[rename(2)](https://man7.org/linux/man-pages/man2/rename.2.html)、[nfs(5)](https://man7.org/linux/man-pages/man5/nfs.5.html)
- [@go-to-k/cdkd 0.296.28（npm パッケージ）](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)
- Cloudflare: [node:fs（Workers）](https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/)
- Vercel: [Runtimes](https://vercel.com/docs/functions/runtimes)

:::
