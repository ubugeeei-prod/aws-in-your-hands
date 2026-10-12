---
title: "40 Disaster Recovery: デプロイ"
---

# 40 Disaster Recovery: デプロイ

このページの手順は、どれも実行していません。コマンドの引数は devShell の AWS CLI の help と、ドキュメントで確かめただけです。試すときは、時間単位の料金がかかることを思い出して、その日のうちに[片付け](/ja/chapters/40-disaster-recovery/wrap.md)まで進めてください。

## 複製を始めるまで

<!-- section: 40.setup -->

まず、11章の VPC と 23章のインスタンスを用意します。23章のインスタンスは、カーネルが 6.12 以下の AMI に固定します。23章が参照している Amazon Linux のドキュメントは、`kernel-6.1` のように版を名前に持つ AMI が引き続き配られている、と書いています。

```bash
vp run net:infra:deploy -c interfaceEndpoints=ssm,ssmmessages,ec2messages
aws ssm get-parameter --region ap-northeast-1 --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.1-arm64 --query Parameter.Value --output text
vp run ec2:infra:deploy -c amiId=ami-xxxxxxxxxxxxxxxxx
vp run ec2:app:release
```

2 行目のパラメーターの名前は、23章が使っている名前の `default` を `6.1` に置き換えたものです。固定した版の CDK がカーネル 6.1 の AMI を引くときに使う名前と同じですが、値を引いて確かめてはいません。

次に、この章のスタックをデプロイします。ロールの名前とセキュリティグループの ID の調べ方は、[エージェントの権限](/ja/chapters/40-disaster-recovery/build.md)に書きました。

<<< @/examples/40-disaster-recovery/infra/bin/app.ts{context}

```bash
vp run dr:infra:diff -c sourceRoleName=<ロールの名前> -c sourceSecurityGroupId=sg-xxxxxxxxxxxxxxxxx
vp run dr:infra:deploy -c sourceRoleName=<ロールの名前> -c sourceSecurityGroupId=sg-xxxxxxxxxxxxxxxxx
```

11章や 23章と同じく、`-c` はその 1 回のコマンドにしか効きません。あとで `-c` を付けずにデプロイし直すと、ポリシーはロールから外れ、1500 番の規則は消えて、複製が止まります。

このスタックのリソースの種類のうち、セキュリティグループ、ロール、ポリシー、関数、ルール、ロググループには、cdkd が専用の実装を持っています。インターフェースエンドポイントと、アウトバウンドの規則（`AWS::EC2::SecurityGroupEgress`）には専用の実装がなく、Cloud Control API 経由になります。

### API でしかできない手順

サービスの初期化と、2 つのテンプレートの作成は、`vp run dr:plan` が表示するコマンドで行います。`<StagingSubnetId output>` のところを、スタックの出力 `StagingSubnetId` の値に置き換えてください。

```bash
vp run dr:plan kernel=6.1
aws drs initialize-service --region ap-northeast-1
```

初期化には、準備が要ります。ドキュメントによれば、コンソールから初期化する場合は、既定のレプリケーションの設定を保存した時点で、必要なロールが作られます。API で初期化する場合は、先に 6 つのロールを自分で作り、AWS が管理しているポリシーを付けてから、`initialize-service` を呼びます。ロールの名前、パス、信頼するサービスの一覧は、ドキュメントの初期化のページにあります。初めて試すなら、コンソールで初期化するほうが手数が少なく済みます。その場合は、コンソールが作る既定のテンプレートのサブネットを、`StagingSubnetId` の値にします。初期化できるのはアカウントの管理者だけ、とも書いてあります。

### エージェントを入れる

23章のインスタンスに入って、arm64 用のインストーラーを取り、実行します。

```bash
vp run ec2:session
curl -o aws-replication-installer-init https://aws-elastic-disaster-recovery-ap-northeast-1.s3.ap-northeast-1.amazonaws.com/latest/linux_arm64/aws-replication-installer-init
chmod +x aws-replication-installer-init
sudo ./aws-replication-installer-init --region ap-northeast-1
```

2 行目以降は、インスタンスの中で実行します。インストーラーは、複製するディスクを尋ねます。Enter だけを押すと、すべてのディスクが対象になります。ルートのディスクは、選ばなくても必ず複製されます。インストーラーは `aws-replication` というユーザーを作り、sudoers に加えます。

ドキュメントの実行例は、アクセスキーを尋ねられる場合のものです。インスタンスプロファイルを使うときに何も尋ねられないのか、追加の引数が要るのかは、確かめていません。インストーラーのハッシュを確かめるためのファイルが、`aws-elastic-disaster-recovery-hashes-ap-northeast-1` のバケットの同じパスに `.sha512` の拡張子で置かれている、ともドキュメントにあります。

手で入れない方法もあります。EC2 のコンソールでインスタンスを選び、DRS のソースサーバーとして追加する操作をすると、Systems Manager 経由でエージェントが入ります。条件は、インスタンスが Systems Manager に管理されていて、ロールに必要な権限があることです。

導入が済むと、インストーラーがソースサーバーの ID（`s-` で始まります）を表示し、最初の同期が始まります。

### 起動テンプレートを設定する

ソースサーバーが登録されると、DRS が EC2 の起動テンプレートを 1 つ作ります。11章の VPC は既定の VPC ではないので、サブネットを指定しないと、起動は失敗します。DRS のコンソールのソースサーバーのページから、次の 4 つを設定します。

- サブネット: スタックの出力 `StagingSubnetId` の値
- インスタンスタイプ: `t4g.micro`。Graviton でなければ、起動の前の検査で失敗します
- セキュリティグループ: 23章のインスタンスと同じもの
- インスタンスプロファイル: 23章のインスタンスと同じもの。起動したインスタンスに Session Manager で入るために要ります

テンプレートの名前とデバイス名は、変えません。

同期の進み具合は、次のタスクで見られます。

```bash
vp run dr:status --rpo 600
```

`--rpo` は、自分で決めた RPO を秒で渡します。最初の同期が終わるまで、サーバーは `BLOCKED` と表示されます。

## 訓練

<!-- section: 40.drill -->

一度も通していない復旧の手順は、動くことを願っているだけの手順です。DRS のドキュメントも、少なくとも四半期に一度の訓練を勧めています。訓練は、元のサーバーにも、進行中の複製にも影響しません。

```figure
caption: 訓練は、起動を頼むところから終了を確かめるところまでが 1 回で、合否を決めるのは起動の後の確認
type: sequence
actor you: You
actor drs: DRS
actor ri: Drill instance
actor src: Source
step you -> src: 目印のノートを書く
note you: declaredAt を記録
step you -> drs: dr:status
step you -> drs: dr:drill --apply
step drs -> ri: スナップショットから起動
step you -> drs: dr:job
step you -> ri: SSM で確認
note you: verifiedAt を記録
step you -> drs: dr:terminate --apply
step drs -x ri: 終了
step you -> drs: dr:billed
```

手順を順に追います。

まず、元のインスタンスに、目印になるノートを 1 件書きます。23章の `vp run ec2:smoke` が、`smoke` という題のノートを作ります。書いた時刻を控えておきます。この時刻を「災害が起きたことにする時刻」として、記録の `declaredAt` に入れます。

次に、計画を見ます。

```bash
vp run dr:status --rpo 600
vp run dr:drill --rpo 600
```

2 行目は、`StartRecovery` に渡すリクエストを表示するだけで、何も起動しません。内容を読んでから、`--apply` を付けます。

```bash
vp run dr:drill --rpo 600 --apply
vp run dr:job --job drsjob-xxxxxxxxxxxxxxxxx
```

フラグは次のとおりです。

<<< @/examples/40-disaster-recovery/scripts/dr.ts{flags}

`dr:job` は、job の状態と、サーバーごとの起動の状態を表示します。job が `COMPLETED` になっても、起動が成功したとは限りません。タスクは、すべてのサーバーが `LAUNCHED` のときだけ成功で終わります。起動にどれくらいかかるかは、測っていません。

<<< @/examples/40-disaster-recovery/scripts/dr.ts{commands}

### 起動したインスタンスで確かめること

`dr:job` が表示したインスタンスの ID に、Session Manager で入ります。23章のタスクは 23章のスタックのインスタンスを相手にするので、ここでは CLI を直接使います。

```bash
aws ssm start-session --region ap-northeast-1 --target i-xxxxxxxxxxxxxxxxx
systemctl is-active notes.service
mountpoint /var/lib/notes
curl -fsS http://127.0.0.1:8787/health
curl -fsS http://127.0.0.1:8787/notes
readlink /opt/notes/current
```

2 行目以降は、インスタンスの中で実行します。見るのは次の点です。

- サービスが `active` であること
- `/var/lib/notes` がマウントポイントであること。そうでなければ、ノートはルートボリュームの空のディレクトリから読まれています
- `/health` が 200 を返すこと
- `/notes` の応答に、訓練の前に書いた目印のノートが入っていること。入っていなければ、起動した時点が目印より前だったことになります
- `/opt/notes/current` が、期待しているリリースを指していること

EC2 のコンソールで、インスタンスの 2 つのステータスチェックが通っていることも見ます。この 6 つが、[訓練の判断](/ja/chapters/40-disaster-recovery/build.md)で見た確認の一覧に対応します。

データボリュームが訓練のインスタンスで正しくマウントされるかどうかは、この章でいちばん確かめたい点です。23章は `/etc/fstab` に UUID で書いているので、ディスクが丸ごと複製されればマウントされるはずですが、試していません。

訓練のインスタンスは、本番と同じアプリが、本番と同じ設定で動いているもう 1 台です。ノートのアプリは `127.0.0.1` でしか待ち受けず、外のサービスも呼ばないので害はありません。キューを読むワーカーや、外部の API を呼ぶバッチが入っているサーバーなら、訓練のインスタンスが本番の仕事を取ってしまいます。ドキュメントも、必要なら訓練のインスタンスを隔離するように起動の設定を変えること、と書いています。

### 終わらせて、記録を残す

確認が済んだら、訓練のインスタンスを終了します。

```bash
vp run dr:terminate
vp run dr:terminate --apply
vp run dr:billed
```

`dr:terminate` が対象にするのは、訓練として起動されたインスタンスだけです。本当の復旧で起動したインスタンスは、一覧にも出しません。同じソースサーバーでもう一度訓練をすると、前の訓練のインスタンスは DRS が片付ける、とドキュメントにあります。それを当てにせず、毎回終了させてください。

訓練が残すのは、記録です。`examples/40-disaster-recovery/drill/record.template.json` を写して、時刻と確認の結果を埋めます。

<<< @/examples/40-disaster-recovery/src/drill.ts{record}

集計は、実際の RTO を「災害が起きたことにした時刻」から「確認が済んだ時刻」までで測ります。起動が終わった時刻までではありません。実際の RPO は、災害の時刻から、起動に使われた時点までです。空のままの時刻があれば、その指標は「測っていない」になります。インスタンスを終了した時刻が空なら、片付けが済んでいない、と出ます。

訓練の頻度は、設定を変えたとき、OS やアプリを大きく変えたとき、そして何も変えていなくても定期的に、です。前回の訓練が成功していても、その後にカーネルを上げれば、次の起動が成功する保証はなくなります。

## 本当の failover と、戻り方

<!-- section: 40.failover -->

本当の復旧で DRS に対してすることは、訓練と同じです。違いは、`StartRecovery` の `isDrill` が偽であること、そして起動したインスタンスを終了しないことです。この章のスクリプトには、本当の復旧を始めるコマンドを入れていません。訓練のつもりで本番の復旧を始めることがないように、入口を分けたかったからです。本当の復旧は、DRS のコンソールか、`aws drs start-recovery` で始めます。

そこから先は、DRS の仕事ではありません。[復旧の順序](/ja/chapters/40-disaster-recovery/build.md)で見た 4 つの段のうち、DRS がするのは 1 つ目だけです。

**確かめる。** 訓練と同じ 6 つの確認をします。災害のときは、「いちばん新しいデータ」を選ぶとソースへの接続を待つことになるので、すでにあるスナップショットを選ぶ判断も要ります。

**元のサーバーを止める。** 元のサーバーが生きている可能性があるなら、切り替える前に、書き込みを受けない状態にします。インスタンスを停止するか、セキュリティグループで通信を断ちます。AZ ごと落ちていて手が届かないときは、戻ってきたときに勝手に動き出さないようにしておきます。

**利用者の通信を切り替える。** 23章のノート API にはパブリックなアドレスがなく、利用者は `vp run ec2:forward` でポートを転送してつないでいました。そのため、切り替えるのは転送の宛先のインスタンス ID です。実際のサービスでは、DNS のレコードやロードバランサーのターゲットを切り替えます。Route 53 のヘルスチェックと failover のしくみは、[28章](/ja/chapters/28-multi-region.md)で扱います。DRS のドキュメントも、切り替えは DRS では行わない、Route 53 を検討するとよい、と書いています。

リカバリーインスタンスが動いている間は、そのソースサーバーを切り離してはいけません。切り離すと、元のサーバーの時点がすべて捨てられる、とベストプラクティスのページにあります。

### 守られていない状態を早く終わらせる

切り替えた直後のリカバリーインスタンスは、どこにも複製されていません。次の障害が来れば、今度は戻る先がありません。

AZ をまたぐ構成の場合、ドキュメントの手順は次のとおりです。レプリケーションの設定と起動テンプレートのサブネットを元の AZ のものに変え、リカバリーインスタンスに対して「復旧したインスタンスを保護する」操作をします。すると、リカバリーインスタンスから元の AZ への複製が始まり、元のインスタンスからの複製は止まります。この複製は、最初からの同期ではなく、最後のスナップショットとの差分の再走査で済む、と書いてあります。

リージョンをまたぐ構成の場合は、リカバリーインスタンスから逆向きの複製（reversed replication）を始めます。元のリージョンに、新しいソースサーバーが作られます。データは最初から全部送り直されるので、時間と、リージョン間のデータ転送の料金がかかります。

### failback

元の場所に戻ることを failback と呼びます。手順は failover の鏡像です。逆向きの複製が追いついたら、元の場所でインスタンスを起動し、確かめ、利用者の通信を戻します。

戻すインスタンスの起動先には、2 通りあります。新しいインスタンスを起動する方法と、元のインスタンスそのものに起動する方法です。後者は「launch into source instance」という設定で、元のインスタンスに `AWSDRS=AllowLaunchingIntoThisInstance` というタグが付いていること、アーキテクチャが同じであることなどが条件です。arm64 のサーバーが failback できるのは、AWS の中だけです。

failback で忘れてはいけないのは、向きです。逆向きの複製は、復旧先のディスクの内容で、元のディスクを置き換えます。元のサーバーにしか無かった書き込みは、そのとき消えます。何が消えるのかを先に数える手順は、[分散システムとして見ると](/ja/chapters/40-disaster-recovery/wrap.md)に書きました。

failback が済むと、要らなくなったものが両側に残ります。リカバリーインスタンス、逆向きの複製のために作られたソースサーバー、元のインスタンスです。ドキュメントは、片付ける順序まで書いています。複製を止めるのが先、インスタンスの終了が後です。
