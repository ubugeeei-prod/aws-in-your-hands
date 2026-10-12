---
title: "23 VM: デプロイ"
---

# 23 VM: デプロイ

## デプロイして、入る

<!-- section: 23.deploy -->

順番があります。先に 11章の VPC、次にこの章の stack です。既定の構成で進めます。

```bash
vp run ec2:plan
vp run net:infra:deploy -c interfaceEndpoints=ssm,ssmmessages,ec2messages
vp run ec2:infra:diff
vp run ec2:infra:deploy
```

2 行目から時間課金が始まります。安いほうで試すなら、2 行目の `-c` を外して、4 行目に `-c placement=public` を付けます。その場合、以降の `ec2:infra:` のコマンドにも毎回同じ `-c` を付けてください。付け忘れて deploy すると、instance は private subnet に作り直されます。

deploy が終わっても、user data はまだ走っている最中です。数分待って、様子を見ます。

```bash
vp run ec2:status
```

Systems Manager から見た instance の状態（`Online` なら経路と権限は通っています）、cloud-init の結果、service の状態、data volume の mount が出ます。この時点では、service は有効になっているだけで、動いてはいません。アプリがまだ無いからです。

### アプリを入れる

```bash
vp run ec2:app:release
```

このタスクは、API をビルドして、S3 に置いて、instance に「取りに来て」と伝えます。伝える手段は Run Command です。Session Manager と同じ経路で、コマンドを送って結果を受け取ります。

release には名前を付けます。

<<< @/examples/23-ec2/src/release.ts{version}

ビルドした時刻と、中身の hash の先頭 16 桁です。instance の側では、user data が置いていった script が受け取ります。

<<< @/examples/23-ec2/deploy/notes-release.sh

引数は外から来る値なので、最初に形を確かめます。合わなければ、何もせずに終わります。次に、S3 から取ってきたファイルの hash を、名前に入っている hash と比べます。途中で切れたファイルや、別のファイルを起動しないためです。それから `current` という link を新しい版に付け替えて、service を再起動して、`/health` が応答するまで待ちます。応答しなければ失敗で終わって、タスクも失敗します。

古い版は instance に残っているので、戻すのは link の付け替えだけです。

```bash
vp run ec2:app:rollback 20261012T010203Z-0123456789abcdef
```

版の名前は、`ec2:app:release` が表示したものを使います。自動では戻しません。戻すかどうかは、あなたが決めます。

instance に送るコマンドは、すべてこの関数が組み立てています。

<<< @/examples/23-ec2/src/remote.ts{commands}

### 動いているか確かめる

```bash
vp run ec2:smoke
vp run ec2:logs
```

`ec2:smoke` は、instance の中で `curl` を実行して、ノートを 1 件作って一覧を取ります。API は instance の外からは呼べないので、中から呼ぶわけです。

手元の `curl` やブラウザから呼びたいときは、port forwarding を使います。

```bash
vp run ec2:forward
curl -s http://localhost:8787/health
```

1 行目を動かしている間、手元の 8787 番が instance の 8787 番につながります。security group には何も足していません。対話の shell が欲しいときは `vp run ec2:session` です。

この 2 つには、AWS CLI とは別に Session Manager plugin が要ります。devShell には入っていないので、AWS のドキュメントの手順で入れてください。入れなくても、マネジメントコンソールの Session Manager から shell は開けますし、`ec2:status`、`ec2:smoke`、`ec2:logs`、`ec2:app:release` は plugin なしで動きます。

入れる人は IAM で決まる、と書きました。裏を返すと、`ssm:StartSession` や `ssm:SendCommand` を許された人は、この machine の管理者です。Run Command のコマンドは管理者権限で実行されますし、session の user（`ssm-user`）も `sudo` を使えます。この 2 つの権限は、SSH の鍵と同じ重さで扱ってください。

drift の検査は、02章と同じです。

```bash
vp run ec2:infra:drift
```

前の節で書いたとおり、ここまでのコマンドは実機では通していません。通すときに気にかけておきたいのは、cdkd の扱いです。この stack のリソースの種類のうち、instance、security group、instance profile、role、bucket は、cdkd が専用の実装を持っています。volume と volume attachment には専用の実装がなく、Cloud Control API 経由になります。11章の VPC の output を `Fn::ImportValue` で読むところも、実行は初めてです。最初に確かめたいのは、このあたりです。

## snapshot と restore

<!-- section: 23.backup -->

data volume は 1 つしかありません。壊れたら、ノートは全部なくなります。備えは snapshot です。ある時点の volume の写しで、S3 に置かれ、リージョンの中のどの AZ にも volume として復元できます。差分で保存されるので、2 回目からは変わったぶんだけです。

この節の手順も、コマンドの flag を devShell の AWS CLI の help で確かめただけです。

### 取る

```bash
vp run ec2:data:unmount
aws ec2 create-snapshot --region ap-northeast-1 --volume-id vol-xxxxxxxxxxxxxxxxx --description "notes before the upgrade"
vp run ec2:data:mount
```

volume の ID は、stack の output の `DataVolumeId` です。

書いている途中の volume を写すと、中途半端な状態が写ることがあります。なので、先に service を止めて unmount します。snapshot は、取り始めた時点の中身を写すもので、完了まで待つ必要はありません。状態が `pending` になったら、3 行目で mount し直して service を起こせます。その間、API は止まっています。

`ec2:data:mount` が実行するのは、最初の起動のときと同じ script です。format しない、という判断も同じです。

### 戻す

いちばん素直なのは、snapshot から volume を作るところを、stack にやらせる方法です。

```bash
vp run ec2:infra:deploy -c dataSnapshotId=snap-xxxxxxxxxxxxxxxxx
```

stack を消した後なら、これで instance と、snapshot の中身を持った volume ができます。最初の起動の script は、ファイルシステムがあるのを見て、format せずに mount します。あとは `vp run ec2:app:release` で、ノートが戻ってきます。AZ が使えなくなったときも同じで、11章の VPC が別の AZ に subnet を持っていれば、そちらに復元できます（この章の stack は 1 つ目の AZ に固定しているので、コードの変更は要ります）。

動いている stack に対して `dataSnapshotId` を足すのは、別の話です。CloudFormation のドキュメントでは、volume の `SnapshotId` は更新できない property です。cdkd のソースでは volume の置き換えになり、`--force-stateful-recreation` を付けないと拒否されます。古い volume が消える操作だからです。この経路は読んだだけで、動かしていません。

snapshot から作った volume は、最初のうち遅いことがあります。中身は、読まれたときに初めて S3 から運ばれてくるからです。

最後に、いちばん忘れやすいこと。snapshot は stack のリソースではありません。stack を消しても残って、料金がかかり続けます。「片付け」で確かめます。

## patch を当てる

<!-- section: 23.patch -->

Lambda では、OS の patch は AWS の仕事でした。ここでは、あなたの仕事です。

Amazon Linux 2023 には、知らないと驚く性質があります。instance は、AMI が作られた時点の package の版に**固定されています**。`dnf upgrade` と打っても、新しいものは何も来ません。勝手に security update が当たることもありません。先月と今月で、同じコマンドが同じ結果になる。そのための作りです。

つまり、何もしなければ、machine は起動した日のまま古くなっていきます。当て方は 2 つあります。

**その場で上げる。** 新しい版が出ているかを調べて、版を名指しで上げます。

```bash
vp run ec2:patch:check
vp run ec2:patch:apply 2023.12.20260930
```

2 行目の引数は、1 行目が表示した版です。`latest` は受け付けません。Amazon Linux のドキュメントも、`latest` を指定するのは、試していない更新を本番でいきなり試すことになる、と書いています。カーネルが更新されたら、再起動するまで古いカーネルで動き続けます。`aws ec2 reboot-instances` で再起動してください。その間、API は止まります。

**作り直す。** 新しい AMI で instance を置き換えます。「AMI を選ぶ」の `-c amiId=` を新しい ID にして deploy するだけです。user data が最初から走り、data volume は付け直され、release をもう一度入れます。手で触った跡が何も残らないので、こちらのほうが結果を予想しやすい。Amazon Linux のドキュメントも、この方法を勧めています。

ただ、こちらにはわかっていないことがあります。置き換えのとき、volume attachment がどう動くのかを、cdkd のソースから読み切れませんでした。古い instance から外して新しい instance に付ける、という順序を cdkd がやってくれるのか、途中で失敗するのか。実機で試すまで、この経路は「できるはず」です。試すときは、先に snapshot を取ってください。

Systems Manager には Patch Manager という機能もあります。足りない patch を調べる、当てる、当たっているかを一覧にする。台数が増えたら、こちらが要ります。1 つ注意があって、ドキュメントによると、Patch Manager は Amazon Linux 2023 の版の固定を見ずに、いつも最新の repository を使います。この章では設定していません。

### 作り直せるようにしておく、という考え方

「作り直す」を突き詰めると、Auto Scaling group になります。instance の作り方（launch template）と台数を渡しておくと、instance が不健康になったときに、新しいものに置き換えてくれます。台数を 1 にしておけば、「常に 1 台いる」を AWS に任せられます。

この章では作っていません。理由は、置き換えが自動で起きるなら、置き換えのたびに必要なことも全部自動でなければならないからです。data volume の付け直し、release の入れ直し。いまの構成では、その 2 つに人の手が要ります。そこまで自動にする価値があるかは、次の節の話と一緒に決めることです。

### 長生きする machine で、あなたが持つもの

- **OS と runtime の patch。** Node.js も OS の package です。同じ道で上がります
- **disk の空き。** journald のログと、`/opt/notes/releases` の古い版は、放っておくと増えます。消すのはあなたです
- **コードと実物のずれ。** session で入って手で直したものは、どこにも記録されません。次に作り直した machine には、その修正がありません。drift の検査が見るのは AWS のリソースの設定で、OS の中までは見ません
- **backup。** 取っているだけでなく、戻せること
