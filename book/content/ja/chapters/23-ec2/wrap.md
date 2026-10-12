---
title: "23 VM: 費用、注意点、片付け"
---

# 23 VM: 費用、注意点、片付け

章の最後のページです。1 台で運用することの限界、Lambda や Fargate との比べ方、つまずきやすい点、本番に向けて変えること、片付けの順に進みます。

## 1 台は単一障害点

<!-- section: 23.spof -->

この章の構成で状態を持っているのは、1 つの AZ にある 1 つのボリュームの、1 つのファイルだけです。そのファイルを 1 つのプロセスが読み書きしています。

何が起きると API がどれだけ止まり、自動で戻るのか、ノートはどうなるのかを、表にしました。

```text
event                              API stops for        comes back by itself?                      the notes
process crashes                    about 2 s            yes: systemd, Restart=on-failure           kept
release, or a restart              a few seconds        yes: part of the same command              kept
OS hangs, kernel panics            until you act        no: the instance status check fails        kept
host hardware fails                minutes (unmeasured) usually: automatic recovery, same instance kept; memory is lost
instance terminated or replaced    until you redeploy   no: deploy again, then release again       kept: the volume is its own resource
data volume lost or damaged        until you restore    no: restore from a snapshot                back to the last snapshot
zone ap-northeast-1a impaired      as long as it lasts  no: this stack has nothing in another zone unreachable until the zone is back
```

以下、行は見出しを除いて上から数えます。1 行目と 2 行目は、この章で作ったものが面倒を見ます。

4 行目は EC2 が面倒を見ます。EC2 は 1 分ごとにステータスチェック（status check）を実行していて、電源、ネットワーク、物理的なホストといった AWS の側の基盤に問題があると、自動復旧（automatic recovery）がインスタンスを別のハードウェアに移します。この機能は、対応しているインスタンスでは最初から有効です。インスタンスの ID も、IP アドレスも、付いているボリュームも、AZ も変わらず、失われるのはメモリの中身だけです。ノート API から見れば、再起動と同じです。

ただ、自動復旧に頼りすぎてはいけません。自動復旧が動くのは、基盤の検査が失敗したときだけです。3 行目のように OS の中で固まった場合は、もう一方の検査（instance status check）が失敗しますが、こちらでは何も起きないので、自分で直すことになります。また、移る先のハードウェアに空きがないときや、AWS Health Dashboard に障害のイベントが出ている間は、自動復旧は動きません。大きな障害のとき、つまりいちばん必要なときに、当てにできないということです。

5 行目から下は、人が動かなければ戻りません。夜中に起きれば、朝まで止まったままです。

### 1 台を受け入れる条件

1 台がいけないわけではなく、多くの用途には 1 台で足ります。ただし、1 台で運用するなら、受け入れる条件を言葉にしておきます。

1. **止まっていてよい時間が、人が気づいて直すまでの時間より長い。** 夜中と休日を含めて、数分から数時間は止まります
2. **最後のスナップショットの時点まで戻ってよい。** あるいは、データをほかから作り直せる
3. **止まったことに、誰かが気づく。** 気づく仕組みが無ければ、1 の時間に上限がなくなります
4. **作り直す手順を、一度は通してある。** 障害の当日に初めてリストアする、という事態を避けるためです

4 つとも満たせるなら、1 台は正しい選択です。安く、単純で、何が起きているかを全部見渡せます。

満たせないなら、別の AZ に 2 台目が要ります。ところが、この章の構成はそのままでは 2 台にできません。ノートが片方のマシンのファイルにあるからです。2 台にするには、状態をマシンの外（05章の DynamoDB や、13章のデータベース）に出して、前にロードバランサーを置くことになります。そこまですると、マシンを自分で持つ理由はかなり減ります。同じことは、12章の Fargate を使えばもっと少ない手間でできます。

EC2 を 1 台で使うのは、マシンの中に状態を置きたくて、かつ 1 台ぶんの信頼性で足りるときです。24章の celld は、マシンの中に状態を置いたまま複数台にする場合を扱います。

### テストが固定していること

この節の不変条件は、[データは別のボリュームに置く](/ja/chapters/23-ec2/more.md)の節と同じ 1 文です。201 を返したノートは、プロセスが再起動しても、インスタンスが作り直されても、読める。表の 1 行目、2 行目、5 行目が、この条件に当たります。`test/file-notes.test.ts` は書き込みの途中の停止で、`test/data-volume.test.ts` はインスタンスの作り直しで、この条件を壊そうとします。

守れないことも、テストにしてあります。`test/access.test.ts` は、11章の経路のモデルでインスタンスのいる AZ を落とし、インスタンスがどこにも届かなくなることを確かめています。「AZ が 1 つ止まっても API は応答する」は、この構成では成り立ちません。成り立たないことを、成り立たないものとして書いたテストです。

どのテストも、壊しているのはモデルと偽物のディスクです。本物のインスタンスを落としたわけではありません。

## Lambda、Fargate、EC2

<!-- section: 23.compare -->

これで、同じ API を 3 つの場所に置けるようになりました（Fargate は [12章](/ja/chapters/12-containers.md)です）。並べて比べます。

| | Lambda（04章） | Fargate（12章） | EC2（この章） |
| --- | --- | --- | --- |
| 動いているもの | 呼ばれたときだけの実行環境 | 動かし続けるコンテナ | 動かし続けるマシン |
| 1 回の処理の長さ | 最長 15 分 | 決まりなし | 決まりなし |
| 誰も呼ばないときの料金 | 0 | かかる | かかる。止めてもボリュームはかかる |
| カーネル | 触れない | 触れない | 自分のもの |
| 手元のディスク | `/tmp`。実行環境ごとの一時的なもの | タスクごとの一時的なもの（既定 20 GiB） | EBS ボリューム。インスタンスより長く残せる |
| OS のパッチ | AWS | ホストは AWS。イメージの中身は自分 | 全部自分 |
| 落ちたら | 次の呼び出しで新しい環境 | サービスがタスクを作り直す | systemd がプロセスを起こす。その先は自分 |

選ぶときは、表の左から順に考えます。Lambda で済むなら Lambda を使います。処理が 15 分に収まらないときや、接続を張り続けたいときは Fargate です。それでも足りないもの、つまりカーネル、ハードウェア、マシンの中のディスクが要るときに、EC2 を選びます。

右に行くほど、できることが増え、自分でやることも増えます。EC2 がいちばん自由なのは確かですが、それはいちばん高機能という意味ではなく、自分でやる範囲がいちばん広いという意味です。

Fargate の「かかる」に金額を入れていないのは、この章では単価を確かめていないからです。金額は [12章](/ja/chapters/12-containers.md)にあります。

## ハマりどころ

| こうなったら | ここを見る |
| --- | --- |
| `ec2:infra:deploy` が import の解決で失敗する | 11章のスタック（`AihNetwork`）がデプロイされているかを確かめます |
| `ec2:status` が「Systems Manager に登録されていない」と表示する | 経路がありません。`vp run ec2:plan` に、11章をデプロイしたときの設定を渡して `UNREACHABLE` を探します。起動から数分は、登録がまだ終わっていないだけのこともあります |
| `Online` なのに、サービスも `/opt/notes` も無い | ユーザーデータが途中で失敗しています。`ec2:status` の cloud-init の行を見て、`ec2:session` で入って `/var/log/cloud-init-output.log` を読みます。`dnf` で止まっていたら、パッケージのリポジトリに届いていません |
| `ec2:app:release` が `AccessDenied` で終わる | インスタンスのロールが読めるのは、リリース用のバケットの `releases/` の下だけです |
| リリースの後、`/health` が応答しないと表示される | `vp run ec2:logs` を見ます。`Invalid environment` なら設定ファイル、`refusing to start over it` ならノートのファイルが壊れています |
| サービスが `failed` のまま起きない | 1 分のうちに 5 回落ちて、systemd が起こすのをやめました。原因を直してから、もう一度リリースします |
| サービスが起動を拒否して、ログにマウントの話が出る | データボリュームがマウントされていません。`vp run ec2:data:mount` を実行します |
| `ec2:session` がプラグインが無いと表示する | Session Manager プラグインは、AWS CLI とは別に入れます |
| デプロイしたらインスタンスが作り直された | 「最新」の AMI が変わったか、前回と違う `-c` を渡しています。先に `diff` を見ます。AMI は `-c amiId=` で固定できます |
| `ec2:infra:destroy` がボリュームを外すところで止まる | 先に `vp run ec2:data:unmount` を実行します。マウントしたままのボリュームは、きれいに外れません |
| インスタンスを止めたのに請求がある | ボリュームと、11章のインターフェイスエンドポイントは、止めても課金されます |

この表の症状は、ドキュメントとソースから組み立てたもので、実際に起こして確かめたわけではありません。

## 本番にするなら

- **1 台でよいかを決める。** 「1 台を受け入れる条件」の 4 つに答えます。1 つでも満たせないなら、この章の構成は合いません
- **データをスタックと一緒に消さない。** `-c dataOnDestroy=snapshot` か `retain` にします。そのうえでスナップショットを定期的に取り、リストアを一度通しておきます
- **AMI を固定して、パッチの予定を持つ。** 「最新」のままだと、置き換えの日を AWS のリリースが決めることになります
- **ログとメトリクスをマシンの外に出して、アラームを付ける。** マシンが消えたときに、理由も一緒に消えないようにします（アラームの組み立て方は [19章](/ja/chapters/19-observability.md)）
- **誰が入れるかを絞る。** `ssm:StartSession` と `ssm:SendCommand` を誰が持っているかを確かめます。セッションの記録も残せます
- **API を公開するなら、ロードバランサーを前に置く。** インスタンスのポートを直接は開けません（[12章](/ja/chapters/12-containers.md)）
- **インスタンスのロールを見直す。** `AmazonSSMManagedInstanceCore` は Parameter Store を広く読めるので、そこに何を置いているかを確かめます
- **終了保護を付ける。** インスタンスには、API からの終了（terminate）を拒否する設定があります
- **反映の経路を AWS CDK CLI と CloudFormation にする。** cdkd の公式ドキュメントは、cdkd を開発・テスト用途向けとし、本番には AWS CDK CLI を勧めています（02章）
- **支出の通知を付ける。** 01章の予算の通知は、インスタンスを消し忘れたときに気づくための最後の手段です。支出の上限ではなく、通知です

## 片付け

<!-- section: 23.cleanup -->

片付けにも順番があります。

```bash
vp run ec2:data:unmount
vp run ec2:releases:empty --yes
vp run ec2:infra:destroy
vp run net:infra:destroy
```

1 行目は、データボリュームを外せる状態にします。2 行目は、リリース用のバケットを空にします。固定した版の cdkd は空でないバケットを消さないからです（`--yes` を付けなければ、一覧を出すだけです）。3 行目で、インスタンス、ボリューム、バケット、ロールが消え、ノートも消えます。4 行目で、VPC とインターフェイスエンドポイントが消えます。VPC を残したいなら、`vp run net:infra:deploy` を `-c` なしで実行すれば、エンドポイントだけを外せます。

3 行目で終わりにすると、エンドポイントの料金（月に USD 61.32）が続きます。この章でいちばん高い部品は、この章のスタックの外にあります。

消えたことは、自分で確かめてください。

```bash
aws ec2 describe-instances --region ap-northeast-1 --filters Name=instance-state-name,Values=pending,running,stopping,stopped
aws ec2 describe-volumes --region ap-northeast-1
aws ec2 describe-snapshots --region ap-northeast-1 --owner-ids self
aws ec2 describe-vpc-endpoints --region ap-northeast-1
```

1 つ目と 2 つ目が空で、4 つ目に Interface 型のエンドポイントが無ければ、時間単位の課金は止まっています。3 つ目にスナップショットが残っていたら、自分で取ったものか、`dataOnDestroy=snapshot` が残したものです。要らなければ `aws ec2 delete-snapshot` で消します。`dataOnDestroy=retain` にしていた場合は、2 つ目にボリュームが残ります。

残るのは、cdkd の bootstrap で作った保存場所（02章）だけです。

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト（ファイルに書くリポジトリを書き込みの各段階で止めるテスト、本物のソケットでの SIGTERM、ユニットとユーザーデータの生成とインジェクションの拒否、データボリュームのスクリプトを bash で実行するテスト、Run Command の引数、経路のモデル、料金の入力、スタックのアサーション）。型検査。`ec2:infra:synth`（既定、`-c placement=public`、`-c dataOnDestroy=snapshot`、`-c dataSnapshotId=snap-0123456789abcdef0`、`-c amiId=ami-0123456789abcdef0`）。`ec2:plan`（既定、`placement=public`、エンドポイントの足りない設定、不正な設定）。`ec2:render`。`ec2:app:build`。ビルドした `dist/server.mjs` と `src/server.ts` を Node.js 24 で起動して、作成、一覧、再起動の後も残ること、SIGTERM で終了コード 0 で終わること、壊したファイルでは起動しないこと。本文の金額は、Price List の単価から `tools/src/pricing/calc.ts` が計算した値で、`examples/23-ec2/test/pricing.test.ts` が照合しています。本文に出てくる AWS CLI のフラグは、devShell の AWS CLI 2.35.11 の help で確かめました。

**まだ確かめていないこと。** AWS に対しては、何も実行していません。`ec2:infra:diff`、`ec2:infra:deploy`、`ec2:infra:drift`、`ec2:infra:destroy`、`ec2:status`、`ec2:session`、`ec2:forward`、`ec2:app:release`、`ec2:app:rollback`、`ec2:smoke`、`ec2:logs`、`ec2:data:unmount`、`ec2:data:mount`、`ec2:patch:check`、`ec2:patch:apply`、`ec2:releases:empty` のどれもです。したがって、次はすべて実機での確認待ちです。cdkd 0.296.28 がこのスタックを作って消せること。SSM 型のパラメーターから AMI の ID が解決されること。ユーザーデータが Amazon Linux 2023 の上で最後まで実行されること（プライベートサブネットから S3 のゲートウェイエンドポイントだけでパッケージのリポジトリに届くこと、`nodejs24` と `xfsprogs` が入ること、`/dev/sdf` のリンクができること、ユニットのディレクティブが通ること）。ルートボリュームの大きさ（料金は 8 GiB と仮定）。インターフェイスエンドポイントが 3 つとも要るのか。Session Manager とポートフォワーディング（プラグインが devShell に無い）。リリースとロールバック、再起動のときに処理中のリクエストが完了すること。スナップショットとリストアの手順。インスタンスを置き換えたときにデータボリュームが付け直されること。パッチの 2 つの当て方。自動復旧の挙動と、「1 台は単一障害点」の表にある時間。「ハマりどころ」の症状。

一次情報で確かめられなかったこと。Amazon Linux 2023 のリポジトリに S3 のゲートウェイエンドポイントだけで届く、と書いたページは見つかりませんでした。`ec2messages` のインターフェイスエンドポイントを省いてよいかも、権限の話としてしか書かれていません。Amazon Linux 2023 の AMI のルートボリュームの大きさとデバイス名は確認しておらず、そのためルートボリュームの設定には手を入れていません（暗号化も、アカウントの既定に従います）。EC2 と EBS の無料利用枠が、どのアカウントにいつまで当てはまるかも確認できませんでした。systemd のディレクティブは v252 の man page で読みましたが、Amazon Linux 2023 に入っている版は見ていません。Cloudflare に仮想マシンに当たる体験があるかは調べておらず、比較は書いていません。Fargate の単価も調べていません。

cdkd が扱うリソースの種類。`v0.296.28` タグの `src/provisioning/register-providers.ts` では、`AWS::EC2::Instance` と `AWS::EC2::SecurityGroup` が EC2 のプロバイダーに、`AWS::IAM::InstanceProfile`、`AWS::IAM::Role`、`AWS::IAM::Policy`、`AWS::S3::Bucket`、`AWS::S3::BucketPolicy` がそれぞれ専用の実装に登録されています。`AWS::EC2::Volume`、`AWS::EC2::VolumeAttachment`、`AWS::EC2::LaunchTemplate` は登録が無く、Cloud Control API 経由です（ボリュームの削除だけは、cdkd が EC2 の `DeleteVolume` を直接呼びます）。この章は起動テンプレートを使っていません。CDK の `Instance` に `requireImdsv2` を渡すと起動テンプレートが作られますが、`CfnInstance` の `metadataOptions` ならインスタンスのプロパティだけで済み、cdkd の専用の実装がそれを書き込みます。専用の実装が書き込まないプロパティをテンプレートが使うと、そのリソースは Cloud Control API に回される仕組みなので、テストでプロパティの一覧を固定しています。ソースからは、`UserData` の変更がインスタンスに反映されないこと、`ImageId`、`SubnetId`、`NetworkInterfaces` の変更が置き換えになること、SSM 型のパラメーターは参照されているものだけデプロイ時に `GetParameter` で解決されることも読み取りました。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 置いてあるだけでかかる料金 | `examples/23-ec2/src/cost.ts`、`src/report.ts`、`scripts/plan.ts`、`test/pricing.test.ts`、`data/pricing/` | `ec2:plan`、`test:unit` |
| 全体像 | `examples/23-ec2/infra/lib/ec2-stack.ts`、`infra/bin/app.ts`、`src/config.ts` | `ec2:infra:synth` |
| SSH のポートは開けない | `examples/23-ec2/infra/lib/ec2-stack.ts`、`src/access.ts`、`test/access.test.ts`、`examples/11-network/infra/lib/import-network.ts` | `ec2:plan`、`test:unit` |
| インスタンスの権限は、中から取りに行く | `examples/23-ec2/infra/lib/ec2-stack.ts`、`infra/test/ec2-stack.test.ts` | `test:unit`、`ec2:infra:synth` |
| AMI を選ぶ | `examples/23-ec2/infra/lib/ec2-stack.ts`、`infra/test/ec2-stack.test.ts` | `test:unit`、`ec2:infra:synth` |
| 最初の起動でやること | `examples/23-ec2/src/machine.ts`、`src/user-data.ts`、`src/rendered.ts`、`scripts/render.ts`、`deploy/user-data.sh`、`test/machine.test.ts` | `ec2:render`、`test:unit` |
| プロセスを systemd のサービスにする | `examples/23-ec2/src/unit.ts`、`deploy/notes.service`、`deploy/notes.env`、`test/machine.test.ts` | `ec2:render`、`test:unit`、`ec2:logs` |
| 止まるときの手順 | `examples/23-ec2/src/shutdown.ts`、`src/server.ts`、`test/shutdown.test.ts` | `test:unit`、`dev:ec2` |
| データは別のボリュームに置く | `examples/23-ec2/src/file-notes.ts`、`src/node-files.ts`、`deploy/notes-data-volume.sh`、`test/file-notes.test.ts`、`test/data-volume.test.ts` | `test:unit` |
| 手元で確かめる | `examples/23-ec2/src/server.ts`、`src/env.ts`、`.env.example`、`scripts/build.ts` | `dev:ec2`、`test:unit`、`ec2:plan`、`ec2:render`、`ec2:app:build`、`ec2:infra:synth` |
| デプロイして、インスタンスに入る | `examples/23-ec2/scripts/remote.ts`、`src/remote.ts`、`src/release.ts`、`deploy/notes-release.sh`、`test/remote.test.ts`、`tools/src/infra/` | `ec2:infra:diff`、`ec2:infra:deploy`、`ec2:status`、`ec2:app:release`、`ec2:app:rollback`、`ec2:smoke`、`ec2:logs`、`ec2:forward`、`ec2:session`、`ec2:infra:drift` |
| スナップショットとリストア | `examples/23-ec2/scripts/remote.ts`、`src/remote.ts`、`deploy/notes-data-volume.sh` | `ec2:data:unmount`、`ec2:data:mount` |
| パッチを当てる | `examples/23-ec2/scripts/remote.ts`、`src/remote.ts`、`test/remote.test.ts` | `ec2:patch:check`、`ec2:patch:apply` |
| 1 台は単一障害点 | `examples/23-ec2/test/access.test.ts`、`test/file-notes.test.ts`、`test/data-volume.test.ts` | `test:unit` |
| 片付け | `examples/23-ec2/scripts/remote.ts`、`tools/src/infra/` | `ec2:data:unmount`、`ec2:releases:empty`、`ec2:infra:destroy`、`net:infra:destroy` |

**一次情報**（確認日はすべて 2026-10-12）

- Systems Manager: [VPC endpoints for Systems Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/setup-create-vpc.html)、[ec2messages, ssmmessages, and other API operations](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-setting-up-messageAPIs.html)、[AMIs with the SSM Agent preinstalled](https://docs.aws.amazon.com/systems-manager/latest/userguide/ami-preinstalled-agent.html)、[Session Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html)、[Session Manager prerequisites](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-prerequisites.html)、[Start a session](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-sessions-start.html)、[Install the Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)、[Instance permissions](https://docs.aws.amazon.com/systems-manager/latest/userguide/setup-instance-permissions.html)、[AmazonSSMManagedInstanceCore](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AmazonSSMManagedInstanceCore.html)、[Run Command walkthrough](https://docs.aws.amazon.com/systems-manager/latest/userguide/walkthrough-cli.html)、[GetCommandInvocation](https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_GetCommandInvocation.html)、[Patch Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/patch-manager.html)、[Patch Manager prerequisites](https://docs.aws.amazon.com/systems-manager/latest/userguide/patch-manager-prerequisites.html)、[Patch baseline rules on Linux](https://docs.aws.amazon.com/systems-manager/latest/userguide/patch-manager-linux-rules.html)、[Systems Manager pricing](https://aws.amazon.com/systems-manager/pricing/)
- EC2: [Instance metadata service](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html)、[Instance metadata options](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-options.html)、[IAM roles for Amazon EC2](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/iam-roles-for-amazon-ec2.html)、[User data](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/user-data.html)、[Instance state changes](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-lifecycle.html)、[Stop and start](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Stop_Start.html)、[Instance IP addressing](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-instance-addressing.html)、[Automatic instance recovery](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-recover.html)、[Simplified automatic recovery](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instance-configuration-recovery.html)、[Status checks](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/monitoring-system-instance-status-check.html)、[Unlimited mode for burstable instances](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-performance-instances-unlimited-mode-concepts.html)、[Preserve data when an instance is terminated](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/preserving-volumes-on-termination.html)、[Auto Scaling health checks](https://docs.aws.amazon.com/autoscaling/ec2/userguide/ec2-auto-scaling-health-checks.html)、[Security groups](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html)
- Amazon Linux 2023: [AL2023 on Amazon EC2](https://docs.aws.amazon.com/linux/al2023/ug/ec2.html)、[IMDSv2](https://docs.aws.amazon.com/linux/al2023/ug/imdsv2.html)、[Deterministic upgrades](https://docs.aws.amazon.com/linux/al2023/ug/deterministic-upgrades.html)、[Updating AL2023](https://docs.aws.amazon.com/linux/al2023/ug/updating.html)、[Updates via instance replacement](https://docs.aws.amazon.com/linux/al2023/ug/security-instance-replacement.html)、[Manage package and operating system updates](https://docs.aws.amazon.com/linux/al2023/ug/managing-repos-os-updates.html)、[Node.js](https://docs.aws.amazon.com/linux/al2023/ug/nodejs.html)、[AWS CLI v2](https://docs.aws.amazon.com/linux/al2023/ug/awscli2.html)、[systemd journal](https://docs.aws.amazon.com/linux/al2023/ug/journald.html)、[gp3 and XFS](https://docs.aws.amazon.com/linux/al2023/ug/continuing-al2-filesystem.html)
- EBS: [EBS volumes](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-volumes.html)、[NVMe device names](https://docs.aws.amazon.com/ebs/latest/userguide/identify-nvme-ebs-device.html)、[Make a volume available for use](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-using-volumes.html)、[EBS snapshots](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-snapshots.html)、[Create snapshots](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-creating-snapshot.html)、[Replace a volume using a snapshot](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-restoring-volume.html)、[Initialize volumes](https://docs.aws.amazon.com/ebs/latest/userguide/initalize-volume.html)
- CloudFormation: [AWS::EC2::Instance](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-instance.html)、[AWS::EC2::Volume](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-volume.html)、[AWS::EC2::VolumeAttachment](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-volumeattachment.html)、[AWS::IAM::InstanceProfile](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-iam-instanceprofile.html)、[CloudFormation-supplied parameter types](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/cloudformation-supplied-parameter-types.html)、[DeletionPolicy](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-attribute-deletionpolicy.html)
- AWS Price List bulk API: [EC2](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/ap-northeast-1/index.json)（インスタンス、EBS、CPU クレジット。約 446 MB）。パブリック IPv4 アドレスとインターフェイスエンドポイントの単価は、11章で読んだ [VPC](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/current/ap-northeast-1/index.json) のものを使い、この章では読み直していません
- 比較: [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)、[Lambda ephemeral storage](https://docs.aws.amazon.com/lambda/latest/dg/configuration-ephemeral-storage.html)、[AWS Fargate for Amazon ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html)、[Fargate task ephemeral storage](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-storage.html)、[Amazon ECS services](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs_services.html)、[CloudWatch agent configuration file](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Agent-Configuration-File-Details.html)
- systemd v252 の man page のソース: [systemd.service](https://github.com/systemd/systemd/blob/v252/man/systemd.service.xml)、[systemd.unit](https://github.com/systemd/systemd/blob/v252/man/systemd.unit.xml)、[systemd.exec](https://github.com/systemd/systemd/blob/v252/man/systemd.exec.xml)、[systemd.kill](https://github.com/systemd/systemd/blob/v252/man/systemd.kill.xml)。[Node.js v24: HTTP](https://nodejs.org/docs/latest-v24.x/api/http.html)
- cdkd v0.296.28: [src](https://github.com/go-to-k/cdkd/tree/v0.296.28/src)、[destroy](https://github.com/go-to-k/cdkd/blob/v0.296.28/docs/cli-destroy.md)、[Introduction](https://cdkd.dev/introduction/)。[aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0)（型定義と、package に入っている JavaScript）

:::
