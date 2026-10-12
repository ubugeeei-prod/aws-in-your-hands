---
title: "24 Self-hosting: 費用、注意点、片付け"
---

# 24 Self-hosting: 費用、注意点、片付け

このページでは、料金の内訳、fleet がうまく動かないときの調べ方、本番で使うなら足すもの、片付けの手順を順に扱い、最後に、この章の構成を分散システムとして見直します。

## 料金

<!-- section: 24.cost -->

内訳は次のとおりです。金額はすべて ap-northeast-1 の定価で、単位は USD、1 か月は 730 時間です。

- `t4g.small` のインスタンスが 1 台 USD 15.77
- gp3 のボリュームがノードごとに 16 GiB で USD 1.54（root の 8 GiB は仮定で、実際の大きさは確かめていません）
- S3 へのリクエストがノードごとに USD 3.93 ほど（見積もりです）
- 11章のスタックに足すインターフェースエンドポイントが USD 61.32

合計すると、1 台で USD 82.56、3 台で USD 125.03 です。23章と同じで、いちばん高いのはエンドポイントで、1 台構成なら 7 割以上を占めます。エンドポイントを除くと 1 台 USD 21.24、3 台 USD 63.71 です。

S3 へのリクエストが見積もりなのは、celld のノードが、何もしていなくてもバケットと通信し続けるからです。文書にある間隔は、リースの更新が寿命の 3 分の 1 ごと（約 3.3 秒に 1 回の書き込み）、fleet の負荷の読み取りが 5 秒に 1 回、デプロイの確認が 30 秒に 1 回です。1 か月では、書き込みが約 79 万回、読み取りが約 61 万回になります。この回数は文書の数字から計算した下限で、実測ではありません。cell が動けば増えますし、バケットに溜まるオブジェクトの保存料金も別にかかります。

<<< @/examples/24-celld/src/cost.ts{billable}

インスタンスを 3 台とも止めても、ボリュームとエンドポイントの分として USD 65.93 がかかり続けます。既定のままスタックを消した後も、残ったデータボリューム 3 つに月 USD 2.30 かかります。

インスタンスタイプについては、celld の文書に「8 GB のノード 1 台で、メモリに載った cell を 1,000 個持てる」という目安があるだけで、最小の要件は書かれていません。2 GiB の `t4g.small` で足りるかどうかは、確かめていません。

## つまずきやすいところ

<!-- section: 24.failures -->

調べるときは、おおよそ次の順番でタスクを実行します。

```bash
vp run celld:status
vp run celld:logs a
vp run celld:diagnose
```

- **`celld:status` が何も返さない。** ノードが Systems Manager に届いていません。[23章](/ja/chapters/23-ec2/build.md)で SSH のポートを開けずに Systems Manager を使ったときと同じ項目を確認します。エンドポイントを足した net のスタックを、後から `-c` なしでデプロイし直していないかも見てください
- **サービスが `inactive` のまま。** ユニットは、バイナリと環境変数のファイルが無いと、エラーを出さずに起動を見送ります。`celld:install` を忘れていないか確かめてください
- **起動してすぐ落ちる。** ログを読みます。バケットへの AccessDenied なら、ロールの権限が原因です。ファイルに書けないというエラーなら、ユニットの `ProtectSystem=strict` が celld の書き込み先を塞いでいるのかもしれません（この組み合わせは動かして確かめていません）。celld は、不正な環境変数があるときも起動時に止まります
- **ログに `SELF-FENCE:` が出る。** ノードがリースを更新できず、自分から止まりました。15 秒後に systemd が起こします。繰り返すなら、バケットへの経路（S3 のゲートウェイエンドポイント、ロール）を疑います
- **`celld:diagnose` に出るピアが足りない。** 出てこないノードのリースが切れているか、internal のポートに届いていません。セキュリティグループのルールと、`CELLD_ADVERTISE` のアドレスを見ます
- **`celld:rollout` が settle で止まった。** rollout は何も巻き戻していません。止まったノードのログを見て、そのまま起動させるか、元の版を `celld:install <version> <node>` で入れ直すかを決めます。残りのノードは、古い版のまま動いています
- **health がいつまでも 503 を返す。** celld は、fleet が落ち着くまで新しいノードを healthy にしません。120 秒経つと `ready_gate_expired` を 1 回ログに出しますが、その後も閉じたままです

## 本番にするなら

<!-- section: 24.production -->

最初に決めるのは、本番で使うかどうかです。celld は、公式が beta と呼び、セキュリティ修正が最新版にしか入らない段階のソフトウェアです。運用を引き受ける人と時間があるかを、先に考えてください。そのうえで、この章の構成に足りないものを挙げます。

- **入口。** celld は TLS を終端せず、マネージドな ingress も持ちません。12章の ALB のようなプロキシを手前に置き、public のリスナーを private IP で待たせて、そのポートをプロキシからだけ開けます。新しいノードは、ロードバランサーの振り分け先に入ってから、リクエストを受けるようになります
- **ピアの通信の暗号化。** [しくみと実装](/ja/chapters/24-celld/build.md)のページの「ピアの通信に TLS は無い」に書いたとおりです
- **容量。** celld は自分ではスケールしません。公式は、ノードを足す合図（`capacity_waiting` や `pressured`）と、減らしてよい条件を書いています。fleet が上限いっぱいのときにノードを失うと、そのノードの cell の行き場がありません
- **監視。** `SELF-FENCE:` の回数、health、`restoring`、ディスクの残りを見ます。19章の道具で拾えますが、この章ではつないでいません
- **バケットの大きさ。** 既定では、cell が起きるたびにバケットの中身が増え続けます。掃除の設定（`CELLD_LTX_RETENTION_SECS`）は既定で無効です
- **認証情報の範囲。** アプリケーションをデプロイする権限は、fleet の管理者の権限です。CI に持たせるなら、20章の OIDC を使い、このバケットのプレフィックスだけに絞ります
- **版の追従。** リリースのたびに、upgrade notes、limitations、security、guarantees を読み直します。読まずに版を上げられる道具は、この章にはありません
- **AMI と OS のパッチ。** 23章と同じです。ノードを作り直すなら、1 台ずつ、drain してから行います

DynamoDB や SQS なら AWS が引き受けてくれることを、celld ではすべて自分で引き受けます。それでも、Durable Objects の書き方をそのまま使いたい場合や、状態を自分のバケットに置きたい場合には、celld が合うでしょう。合うかどうかを決めるときに、この章で体験したことが役に立てばと思います。

## 片付け

<!-- section: 24.cleanup -->

片付けは、次の順番で行います。

```bash
vp run celld:stop-all
vp run celld:infra:destroy
vp run net:infra:destroy
```

既定の `stateOnDestroy=retain` では、インスタンスは消えますが、バケット 2 つとデータボリュームは残ります。残るのは意図したとおりの動作ですが、練習が終わったら消してください。

```bash
aws ec2 describe-volumes --region ap-northeast-1 --filters Name=tag:Name,Values='AihCelld/*'
aws ec2 delete-volume --region ap-northeast-1 --volume-id <volume-id>
aws ec2 describe-snapshots --region ap-northeast-1 --owner-ids self --filters Name=tag-key,Values=aih:backup
aws s3 rm s3://<bucket>/ --recursive --dryrun
```

残ったボリュームは、Name のタグで探せます。`celld:backup` が取ったスナップショットには、`aih:backup` のタグが付いています。バケットは、中身を消してから `aws s3 rb` で消します。スタックがまだあるうちなら、`vp run celld:bucket-empty` と `vp run celld:bucket-empty backups` で同じように中身を消せます（`--yes` を付けなければ一覧を出すだけです）。

最初から `-c stateOnDestroy=delete` で作った場合は、destroy の前にバケットを空にします。固定した版の cdkd は、空でないバケットを消さないからです。

```bash
vp run celld:bucket-empty --yes
vp run celld:bucket-empty backups --yes
vp run celld:infra:destroy
```

destroy のときに効くのは、デプロイしたときの設定のはずです。ただし、cdkd が destroy の時点でテンプレートを作り直すのかどうかは確かめていません。destroy の後にボリュームやバケットが残っていたら、上の手順で消してください。

`net:infra:destroy` を忘れると、エンドポイントの料金（月に USD 61.32）がかかり続けます。VPC を残したいなら、`vp run net:infra:deploy` を `-c` なしで実行すると、エンドポイントだけを外せます。

手元に残るのは、`examples/24-celld/.celld/` のアーカイブとバイナリです。git には入りません。

## 分散システムとして見ると

<!-- section: 24.distributed -->

最後に、この章で誰が何を保証していたかを整理します。

状態は 3 か所にあります。長く残す状態と持ち主の記録を持つバケット、持ち主のノードのディスク、そして、バケットにまだ無い応答済みの書き込みを持つフォロワーのディスクです。S3 があるから安心だと考えるのではなく、いま、どの書き込みがどこにあるかで考えます。

不変条件（invariant）は celld が定めたもので、cell の持ち主は同時に 1 台であることと、応答済みの書き込みは失われないことです。この 2 つを守っているのは celld のプロトコルで、そのプロトコルは、バケットの条件付き書き込みとスーパーバイザーの振る舞いを前提にしています。この章の CDK とスクリプトが受け持つのは、その前提を壊さないことだけです。具体的には、リースの寿命より長く待ってから再起動し、止めるときは 40 秒より長く待ち、2 台を同時に止めず、全部のディスクを同時に捨てず、混ぜてはいけない版を混ぜません。

この章は、どんな障害でも書き込みが失われない、とは主張しません。celld 自身が限界を書いています。フォロワーがエラーを返し続けると、復旧が進まないことがあります。最後のバッチが丸ごと消えると、検出できない場合があります。版が混ざっていると、復旧が止まることがあります。上限いっぱいの fleet は、失ったノードの cell を引き取れません。複数のノードとディスクを同時に失ったときに何が残るかは、どの書き込みがどこまで届いていたかによって決まります。

この章のテストが確かめているのは、それよりずっと手前のことです。手順を決める関数が決めたとおりの順番で動いて失敗したら止まることと、検査の判定が作り物の壊れた fleet を見分けられることを確かめています。celld が約束を守っているかどうかは、実機で `celld:loss-check` を動かして確かめるしかなく、それは読者の仕事として残っています。

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト（更新の順序を決める関数に各段階で失敗を差し込むテスト、作り物の fleet に対する ledger の判定、probe のスクリプトを bash と curl で実行するテスト、インストールのスクリプトが不正な引数とダイジェストの不一致を拒むことを bash で実行して確かめるテスト、ユニットとユーザーデータの生成、`celld diagnose --json` の出力の読み取り、バックアップとリストアの計画、料金の入力、スタックのアサーション）。型検査。`celld:infra:synth`（既定、`-c nodes=1`、`-c nodes=3`、`-c nodes=2 -c stateOnDestroy=delete`、`-c nodes=2 -c dataSnapshots=a:snap-0123456789abcdef0`）。`celld:plan`、`celld:render`。`celld:fetch`（v0.6.2 と v0.6.1 の Linux arm64 のアーカイブを取得し、大きさと SHA-256 が固定した値と一致しました。`--host` は付けておらず、展開も実行もしていません）。これとは別に、v0.6.2 と v0.6.1 の 3 つのプラットフォームのアーカイブ計 6 個を取得して、GitHub の API が返すダイジェストと一致することを確かめました。devShell の AWS CLI（2.35.11）が `aws ec2 stop-instances --skip-os-shutdown` を受け付けることは、help の表示で確かめました。

**まだ確かめていないこと。** AWS に対しては、何も実行していません。`celld:infra:diff`、`celld:infra:deploy`、`celld:infra:drift`、`celld:infra:destroy` と、`celld:status` から `celld:bucket-empty` までの、ノードに触るタスクすべてです。celld のバイナリも一度も実行していません（`celld dev`、`celld deploy`、ノードの起動、`celld diagnose`）。そのため、次のことは文書とソースを読んだだけです。celld がインスタンスのロール（IMDSv2 必須、hop limit 1）から認証情報を得られること。S3 のゲートウェイエンドポイントだけで fleet のバケットに届くこと。この章の IAM のアクションの一覧で足りること。systemd の `ProtectSystem=strict` の下で celld が動くこと。`t4g.small` で足りること。`celld diagnose --json` の実際の出力（テストの sample は、v0.6.2 の `fleet.rs` の書式から組み立てたもので、実物の写しではありません）。SIGTERM での引き渡しと health の判定の実際の振る舞い。`--skip-os-shutdown` の後に残ったノードが cell を引き継ぐこと。バックアップから戻した fleet が起動すること。cdkd がボリュームの置き換えを伴うリストアのデプロイを通せること。`vp run` のタスクに `-c` や `--yes` を渡す形は、23章までと同じ書き方に揃えました。

一次情報で確かめられなかったこと。celld が必要とする S3 のアクションの一覧（Azure 向けの記述からの読み替えです）。バケットのバージョニングと celld の組み合わせ。`CELLD_NODE` を再起動をまたいで固定してよいか。動いている fleet のバケットのコピーが戻せる状態かどうか。celld の最小のメモリ要件。Amazon Linux 2023 の systemd の版（v252 の man page を読みましたが、インスタンスでは確かめていません）。Cloudflare 側の Durable Objects の保証や料金は調べていません。

依頼された構成から変えた点。「ピアの通信は private なネットワークと TLS」は、celld が TLS を持たないので「private なネットワークだけ」になりました。ノードを失ったときの検査は、持ち主の記録（ownership record）を直接読むのではなく、クライアントから見える counter の履歴で判定します（記録の形式が公開されたインターフェースではないため）。

S3 の料金の単価は、この章では読み直していません。07章と 11章、23章が AWS Price List から記録した単価（確認日 2026-10-11、2026-10-12）を、そのまま使っています。

cdkd が扱うリソースの種類。固定した版（0.296.28）の npm パッケージの `dist` を読みました。`AWS::EC2::Instance`、`AWS::EC2::SecurityGroup`、`AWS::EC2::SecurityGroupIngress` が EC2 のプロバイダーに、`AWS::IAM::InstanceProfile`、`AWS::IAM::Role`、`AWS::IAM::Policy`、`AWS::S3::Bucket`、`AWS::S3::BucketPolicy` がそれぞれ専用のプロバイダーに登録されています。`AWS::EC2::Volume` と `AWS::EC2::VolumeAttachment` は登録が無く、Cloud Control API 経由です（23章の確認と同じ）。`AWS::EC2::SecurityGroupEgress` も登録が無いので、アウトバウンドのルールはセキュリティグループの中に書き、別のリソースにしていません。cdkd の公式ドキュメントは cdkd を開発・テスト用途向けとし、本番には AWS CDK CLI を勧めています（これは前の章が記録した出典によるもので、この章では読み直していません）。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 版を固定して、中身を確かめる | `examples/24-celld/src/celld.ts`、`scripts/fetch.ts` | `celld:fetch`、`test:unit` |
| 全体像 | `examples/24-celld/infra/lib/celld-stack.ts`、`infra/bin/app.ts`、`src/config.ts`、`src/report.ts`、`scripts/plan.ts` | `celld:plan`、`celld:infra:synth` |
| ピアの通信に TLS は無い | `examples/24-celld/infra/lib/celld-stack.ts`、`infra/test/celld-stack.test.ts` | `celld:infra:synth`、`test:unit` |
| 状態はバケットにあるが、ディスクも捨てられない | `examples/24-celld/infra/lib/celld-stack.ts`、`infra/test/celld-stack.test.ts` | `celld:infra:synth`、`test:unit` |
| ノードの中身 | `examples/24-celld/src/machine.ts`、`deploy/`、`scripts/render.ts`、`test/machine.test.ts` | `celld:render`、`test:unit` |
| 料金 | `examples/24-celld/src/cost.ts`、`test/pricing.test.ts`、`data/pricing/` | `celld:plan`、`test:unit` |
| 手元で確かめられること、確かめられないこと | `examples/24-celld/test/`、`infra/test/` | `test:unit`、`celld:plan`、`celld:render`、`celld:infra:synth`、`celld:fetch` |
| まず 1 台で動かす | `examples/24-celld/scripts/fleet.ts`、`src/remote.ts`、`test/remote.test.ts` | `celld:infra:deploy`、`celld:artifacts`、`celld:install`、`celld:app-deploy`、`celld:start`、`celld:status`、`celld:smoke`、`celld:diagnose` |
| fleet にして、1 台ずつ入れ替える | `examples/24-celld/src/rollout.ts`、`src/health.ts`、`test/rollout.test.ts`、`test/health.test.ts` | `celld:drain`、`celld:rollout`、`celld:stop-all`、`test:unit` |
| ノードを 1 台失う | `examples/24-celld/src/probe.ts`、`src/ledger.ts`、`test/toy-fleet.ts`、`test/ledger.test.ts`、`test/probe.test.ts` | `celld:loss-check`、`celld:kill`、`celld:revive`、`test:unit` |
| バックアップとリストア | `examples/24-celld/src/backup.ts`、`test/remote.test.ts` | `celld:backup`、`celld:restore`、`test:unit` |
| つまずきやすいところ | `examples/24-celld/scripts/fleet.ts` | `celld:status`、`celld:logs`、`celld:diagnose` |
| 片付け | `examples/24-celld/scripts/fleet.ts` | `celld:infra:destroy`、`celld:bucket-empty` |
| 分散システムとして見ると | `examples/24-celld/src/ledger.ts`、`test/ledger.test.ts` | `test:unit` |

**一次情報**（確認日はすべて 2026-10-12）

- celld v0.6.2（タグの commit は `90b43017241f`）: [README](https://github.com/denoland/celld/blob/v0.6.2/README.md)、[documentation](https://github.com/denoland/celld/blob/v0.6.2/docs/README.md)（Shut down and roll out a node、Upgrade notes、Environment variables）、[What celld guarantees](https://github.com/denoland/celld/blob/v0.6.2/docs/guarantees.md)、[Security](https://github.com/denoland/celld/blob/main/docs/security.md)、[Limitations](https://github.com/denoland/celld/blob/main/docs/limitations.md)、[Testing](https://github.com/denoland/celld/blob/v0.6.2/docs/testing.md)、[source](https://github.com/denoland/celld/tree/v0.6.2/crates/celld)（`main/cli.rs`、`fleet.rs`、`main.rs`、`bucket.rs`、`protocol.rs`）、[counter example](https://github.com/denoland/celld/tree/v0.6.2/examples/counter)、[releases](https://api.github.com/repos/denoland/celld/releases)、[installer](https://celld.dev/install.sh)（読んだだけで、実行していません）。[repository](https://github.com/denoland/celld) の default branch は、確認した時点で v0.6.2 のタグと同じ commit でした。[celld.dev/docs](https://celld.dev/docs/) と [celld.dev/docs/guarantees](https://celld.dev/docs/guarantees/) は要約を通して読み、本文の根拠にはリポジトリのファイルを使っています
- EC2: [StopInstances](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_StopInstances.html)、[Data protection](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/data-protection.html)、[Instance metadata categories](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-metadata.html)、[Access instance metadata](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instancedata-data-retrieval.html)
- S3: [Conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)、[Multipart upload](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html)。AWS CLI: [s3 sync](https://docs.aws.amazon.com/cli/latest/reference/s3/sync.html)
- systemd v252 の man page のソース: [systemd.service](https://github.com/systemd/systemd/blob/v252/man/systemd.service.xml)、[systemd.unit](https://github.com/systemd/systemd/blob/v252/man/systemd.unit.xml)、[systemd.kill](https://github.com/systemd/systemd/blob/v252/man/systemd.kill.xml)
- cdkd: [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28) の `dist`（手元にインストールされたものを読みました）
- 23章と 11章が記録した出典（Systems Manager、EBS のスナップショット、CloudFormation の `DeletionPolicy`、AWS Price List）は、そちらの検証メモにあります。この章では読み直していません

:::
