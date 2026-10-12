---
title: "24 Self-hosting: 費用、注意点、片付け"
---

# 24 Self-hosting: 費用、注意点、片付け

## うまくいかないとき

<!-- section: 24.failures -->

調べる順番は、だいたいこうです。

```bash
vp run celld:status
vp run celld:logs a
vp run celld:diagnose
```

- **`celld:status` が何も返さない。** Systems Manager に届いていません。23章の「SSH の port は開けない」の節と同じ確認をします。endpoint を足した net の stack を、後で `-c` なしで deploy し直していませんか
- **service が `inactive` のまま。** unit は、binary と環境変数の file が無ければ静かに起動を見送ります。`celld:install` を忘れていないか見てください
- **起動してすぐ落ちる。** log を読みます。bucket への AccessDenied なら role の権限。file に書けないという error なら、unit の `ProtectSystem=strict` が celld の書き込み先を塞いでいるかもしれません（この組み合わせは動かして確かめていません）。celld は不正な環境変数でも起動時に止まります
- **log に `SELF-FENCE:`。** node が lease を更新できず、自分から止まりました。15 秒後に systemd が起こします。繰り返すなら、bucket への経路（S3 の gateway endpoint、role）を疑います
- **`celld:diagnose` に peer が足りない。** その node の lease が切れているか、internal の port に届いていません。security group の rule と、`CELLD_ADVERTISE` の address を見ます
- **`celld:rollout` が settle で止まった。** 何も巻き戻していません。止まった node の log を見て、起動させるか、元の版を `celld:install <version> <node>` で入れ直すかを決めます。残りの node は、古い版のまま動いています
- **health がいつまでも 503。** celld は、fleet が落ち着くまで新しい node を healthy にしません。120 秒経つと `ready_gate_expired` を 1 回 log に出しますが、それでも閉じたままです

## 本番にするなら

<!-- section: 24.production -->

まず、するかどうかです。公式が beta と呼び、security fix は最新版だけ、という段階のソフトウェアです。運用を引き受ける人と時間があるかを、先に考えてください。この lab に足りないものを挙げます。

- **入口。** celld は TLS を終端せず、managed な ingress も持ちません。12章の ALB のような proxy を手前に置き、public の listener を private IP で listen させ、その port を proxy からだけ開けます。新しい node は、load balancer の振り分け先に入って初めて request を受けます
- **peer の通信の暗号化。** 上で書いたとおりです
- **容量。** celld は自分では scale しません。公式は、足す合図（`capacity_waiting` や `pressured`）と、減らしてよい条件を書いています。fleet が上限いっぱいのときに node を失うと、その cell の行き場がありません
- **監視。** `SELF-FENCE:` の回数、health、`restoring`、disk の残り。19章の道具で拾えますが、この章では配線していません
- **bucket の大きさ。** 既定では、cell が起きるたびに bucket の中身が増え続けます。掃除の設定（`CELLD_LTX_RETENTION_SECS`）は既定で無効です
- **credentials の範囲。** application を deploy する権限は fleet の管理者の権限です。CI に持たせるなら 20章の OIDC で、この bucket の prefix だけに絞ります
- **版の追従。** release のたびに、upgrade notes、limitations、security、guarantees を読み直します。読まずに上げられる道具は、ここにはありません
- **AMI と OS の patch。** 23章と同じです。node を作り直すなら、1 台ずつ、drain してから

DynamoDB や SQS を使っていれば AWS が引き受けてくれることを、ここでは全部あなたが引き受けます。それでも celld が合う場面はあるでしょう。Durable Objects の書き方をそのまま使いたい、状態を自分の bucket に置きたい、といった場合です。合うかどうかを決めるのに、この章の体験が役に立てばうれしいです。

## 片付け

<!-- section: 24.cleanup -->

順番があります。

```bash
vp run celld:stop-all
vp run celld:infra:destroy
vp run net:infra:destroy
```

既定の `stateOnDestroy=retain` では、これで instance は消えますが、bucket 2 つと data volume は残ります。意図どおりです。ただ、練習が終わったなら消しましょう。

```bash
aws ec2 describe-volumes --region ap-northeast-1 --filters Name=tag:Name,Values='AihCelld/*'
aws ec2 delete-volume --region ap-northeast-1 --volume-id <volume-id>
aws ec2 describe-snapshots --region ap-northeast-1 --owner-ids self --filters Name=tag-key,Values=aih:backup
aws s3 rm s3://<bucket>/ --recursive --dryrun
```

残った volume は、Name の tag で探せます。`celld:backup` が取った snapshot には `aih:backup` の tag が付いています。bucket は、中身を消してから `aws s3 rb` で消します。stack がまだあるうちなら、`vp run celld:bucket-empty` と `vp run celld:bucket-empty backups` が同じことをします（`--yes` を付けなければ一覧だけです）。

最初から `-c stateOnDestroy=delete` で作った場合は、destroy の前に bucket を空にします。固定した版の cdkd は、空でない bucket を消しません。

```bash
vp run celld:bucket-empty --yes
vp run celld:bucket-empty backups --yes
vp run celld:infra:destroy
```

destroy のときに効くのは、deploy したときの設定のはずです。ただ、cdkd がそこで template を作り直すのかどうかは確かめていません。destroy の後に volume や bucket が残っていたら、上の手順で消してください。

`net:infra:destroy` を忘れると、endpoint の料金（月に USD 61.32）が続きます。VPC を残したいなら、`vp run net:infra:deploy` を `-c` なしで実行すれば、endpoint だけ外せます。

手元に残るのは `examples/24-celld/.celld/` の archive と binary です。git には入りません。

## 分散システムとして見る

<!-- section: 24.distributed -->

最後に、この章で誰が何を保証していたかを整理します。

状態の持ち主は 3 か所です。bucket（長く残す状態と、誰が持ち主かの記録）。持ち主の node の disk。follower の disk（bucket にまだ無い応答済みの書き込み）。「S3 があるから安心」ではなく、「いま、どの書き込みがどこにあるか」で考えます。

invariant は celld のものです。cell の持ち主は同時に 1 台。応答済みの書き込みは失われない。これを守っているのは celld の protocol で、その protocol は bucket の条件付き書き込みと、supervisor の振る舞いに寄りかかっています。この章の CDK と script が受け持つのは、その前提を壊さないことだけです。lease の寿命より長く待って再起動する。止めるときに 40 秒より長く待つ。2 台を同時に止めない。全部の disk を同時に捨てない。混ぜてはいけない版を混ぜない。

そして、この章が主張しないこと。どんな障害でも書き込みが失われない、とは言いません。celld 自身が限界を書いています。follower が error を返し続けると recovery が進まないことがある。最後の batch が丸ごと消えると検出できない場合がある。版が混ざっていると recovery が止まることがある。上限いっぱいの fleet は、失った node の cell を引き取れない。複数の node と disk を同時に失ったときに何が残るかは、どの書き込みがどこまで届いていたか次第です。

この章のテストが確かめているのは、もっと手前のことです。手順を決める関数が、決めたとおりの順番で動き、失敗したら止まること。検査の判定が、作り物の壊れた fleet を見分けられること。celld が約束を守っているかどうかを確かめるのは、実機で `celld:loss-check` を動かす、あなたの仕事として残っています。

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト（更新の順序を決める関数に各段階で失敗を差し込むテスト、作り物の fleet に対する ledger の判定、probe の script を bash と curl で実行するテスト、install script の引数の拒否と digest の不一致の拒否を bash で実行するテスト、unit と user data の生成、`celld diagnose --json` の出力の読み取り、backup と restore の計画、料金の入力、stack の assertion）。型検査。`celld:infra:synth`（既定、`-c nodes=1`、`-c nodes=3`、`-c nodes=2 -c stateOnDestroy=delete`、`-c nodes=2 -c dataSnapshots=a:snap-0123456789abcdef0`）。`celld:plan`、`celld:render`。`celld:fetch`（v0.6.2 と v0.6.1 の Linux arm64 の archive を取得し、大きさと SHA-256 が固定した値と一致。`--host` は付けておらず、展開も実行もしていません）。別に、v0.6.2 と v0.6.1 の 3 つの platform の archive 計 6 個を取得して、GitHub の API が返す digest と一致することを確かめました。devShell の AWS CLI（2.35.11）が `aws ec2 stop-instances --skip-os-shutdown` を受け付けることは、help の表示で確かめました。

**まだ確かめていないこと。** AWS に対しては、何も実行していません。`celld:infra:diff`、`celld:infra:deploy`、`celld:infra:drift`、`celld:infra:destroy` と、`celld:status` から `celld:bucket-empty` までの、node に触るタスクすべてです。celld の binary も一度も実行していません（`celld dev`、`celld deploy`、node の起動、`celld diagnose`）。そのため、次のことは読んだだけです。celld が instance role（IMDSv2 必須、hop limit 1）から credentials を得られること。S3 の gateway endpoint だけで fleet の bucket に届くこと。この章の IAM の action の一覧で足りること。systemd の `ProtectSystem=strict` の下で celld が動くこと。`t4g.small` で足りること。`celld diagnose --json` の実際の出力（テストの sample は、v0.6.2 の `fleet.rs` の書式から組み立てたもので、実物の写しではありません）。SIGTERM での引き渡しと health の gate の実際の振る舞い。`--skip-os-shutdown` の後に残った node が cell を引き継ぐこと。backup から戻した fleet が起動すること。cdkd が volume の置き換えを伴う restore の deploy を通せること。`vp run` のタスクに `-c` や `--yes` を渡す形は、23章までと同じ書き方に揃えました。

一次情報で確かめられなかったこと。celld が必要とする S3 の action の一覧（Azure 向けの記述からの読み替えです）。bucket の versioning と celld の組み合わせ。`CELLD_NODE` を再起動をまたいで固定してよいか。動いている fleet の bucket の copy が戻せる状態かどうか。celld の最小の memory 要件。Amazon Linux 2023 の systemd の版（v252 の man page を読みましたが、instance では確かめていません）。Cloudflare 側の Durable Objects の保証や料金は調べていません。

依頼された構成から変えた点。「peer の通信は private と TLS」は、celld が TLS を持たないので「private な network だけ」になりました。node の喪失の検査は、ownership record を直接読むのではなく、client から見える counter の履歴で判定します（record の形式が公開された interface ではないため）。

S3 の料金の単価は、この章では読み直していません。07章と 11章、23章が AWS Price List から記録した単価（確認日 2026-10-11、2026-10-12）を、そのまま使っています。

cdkd が扱うリソースの種類。固定した版（0.296.28）の npm package の `dist` を読みました。`AWS::EC2::Instance`、`AWS::EC2::SecurityGroup`、`AWS::EC2::SecurityGroupIngress` が EC2 の provider に、`AWS::IAM::InstanceProfile`、`AWS::IAM::Role`、`AWS::IAM::Policy`、`AWS::S3::Bucket`、`AWS::S3::BucketPolicy` がそれぞれ専用の provider に登録されています。`AWS::EC2::Volume` と `AWS::EC2::VolumeAttachment` は登録が無く、Cloud Control API 経由です（23章の確認と同じ）。`AWS::EC2::SecurityGroupEgress` も登録が無いので、outbound の rule は security group の中に書き、別の resource にしていません。cdkd の公式ドキュメントは cdkd を開発・テスト用途向けとし、本番には AWS CDK CLI を勧めています（これは前の章が記録した出典によるもので、この章では読み直していません）。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 版を固定して、中身を確かめる | `examples/24-celld/src/celld.ts`、`scripts/fetch.ts` | `celld:fetch`、`test:unit` |
| 全体像 | `examples/24-celld/infra/lib/celld-stack.ts`、`infra/bin/app.ts`、`src/config.ts`、`src/report.ts`、`scripts/plan.ts` | `celld:plan`、`celld:infra:synth` |
| peer の通信に TLS は無い | `examples/24-celld/infra/lib/celld-stack.ts`、`infra/test/celld-stack.test.ts` | `celld:infra:synth`、`test:unit` |
| 状態は bucket に、でも disk も捨てられない | `examples/24-celld/infra/lib/celld-stack.ts`、`infra/test/celld-stack.test.ts` | `celld:infra:synth`、`test:unit` |
| node の中身 | `examples/24-celld/src/machine.ts`、`deploy/`、`scripts/render.ts`、`test/machine.test.ts` | `celld:render`、`test:unit` |
| いくらかかる？ | `examples/24-celld/src/cost.ts`、`test/pricing.test.ts`、`data/pricing/` | `celld:plan`、`test:unit` |
| 手元で確かめられること、られないこと | `examples/24-celld/test/`、`infra/test/` | `test:unit`、`celld:plan`、`celld:render`、`celld:infra:synth`、`celld:fetch` |
| まず 1 台で動かす | `examples/24-celld/scripts/fleet.ts`、`src/remote.ts`、`test/remote.test.ts` | `celld:infra:deploy`、`celld:artifacts`、`celld:install`、`celld:app-deploy`、`celld:start`、`celld:status`、`celld:smoke`、`celld:diagnose` |
| fleet にして、1 台ずつ入れ替える | `examples/24-celld/src/rollout.ts`、`src/health.ts`、`test/rollout.test.ts`、`test/health.test.ts` | `celld:drain`、`celld:rollout`、`celld:stop-all`、`test:unit` |
| node を 1 台、失ってみる | `examples/24-celld/src/probe.ts`、`src/ledger.ts`、`test/toy-fleet.ts`、`test/ledger.test.ts`、`test/probe.test.ts` | `celld:loss-check`、`celld:kill`、`celld:revive`、`test:unit` |
| backup と restore | `examples/24-celld/src/backup.ts`、`test/remote.test.ts` | `celld:backup`、`celld:restore`、`test:unit` |
| うまくいかないとき | `examples/24-celld/scripts/fleet.ts` | `celld:status`、`celld:logs`、`celld:diagnose` |
| 片付け | `examples/24-celld/scripts/fleet.ts` | `celld:infra:destroy`、`celld:bucket-empty` |
| 分散システムとして見る | `examples/24-celld/src/ledger.ts`、`test/ledger.test.ts` | `test:unit` |

**一次情報**（確認日はすべて 2026-10-12）

- celld v0.6.2（tag の commit は `90b43017241f`）: [README](https://github.com/denoland/celld/blob/v0.6.2/README.md)、[documentation](https://github.com/denoland/celld/blob/v0.6.2/docs/README.md)（Shut down and roll out a node、Upgrade notes、Environment variables）、[What celld guarantees](https://github.com/denoland/celld/blob/v0.6.2/docs/guarantees.md)、[Security](https://github.com/denoland/celld/blob/main/docs/security.md)、[Limitations](https://github.com/denoland/celld/blob/main/docs/limitations.md)、[Testing](https://github.com/denoland/celld/blob/v0.6.2/docs/testing.md)、[source](https://github.com/denoland/celld/tree/v0.6.2/crates/celld)（`main/cli.rs`、`fleet.rs`、`main.rs`、`bucket.rs`、`protocol.rs`）、[counter example](https://github.com/denoland/celld/tree/v0.6.2/examples/counter)、[releases](https://api.github.com/repos/denoland/celld/releases)、[installer](https://celld.dev/install.sh)（読んだだけで、実行していません）。[repository](https://github.com/denoland/celld) の default branch は、確認した時点で v0.6.2 の tag と同じ commit でした。[celld.dev/docs](https://celld.dev/docs/) と [celld.dev/docs/guarantees](https://celld.dev/docs/guarantees/) は要約を通して読み、本文の根拠には repository の file を使っています
- EC2: [StopInstances](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_StopInstances.html)、[Data protection](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/data-protection.html)、[Instance metadata categories](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-metadata.html)、[Access instance metadata](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instancedata-data-retrieval.html)
- S3: [Conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)、[Multipart upload](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html)。AWS CLI: [s3 sync](https://docs.aws.amazon.com/cli/latest/reference/s3/sync.html)
- systemd v252 の man page のソース: [systemd.service](https://github.com/systemd/systemd/blob/v252/man/systemd.service.xml)、[systemd.unit](https://github.com/systemd/systemd/blob/v252/man/systemd.unit.xml)、[systemd.kill](https://github.com/systemd/systemd/blob/v252/man/systemd.kill.xml)
- cdkd: [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28) の `dist`（手元に install されたものを読みました）
- 23章と 11章が記録した出典（Systems Manager、EBS の snapshot、CloudFormation の `DeletionPolicy`、AWS Price List）は、そちらの検証メモにあります。この章では読み直していません

:::
