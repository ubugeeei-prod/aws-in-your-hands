---
title: "40 Disaster Recovery: 費用、注意点、片付け"
---

# 40 Disaster Recovery: 費用、注意点、片付け

章の最後のページです。RPO と RTO の読み方、2 つの拠点を分散システムとして見たときの落とし穴、サーバーを持たない基盤との違い、つまずきやすい点、片付けの順に進みます。

## RPO と RTO は、自分で測る

<!-- section: 40.objectives -->

RPO は失ってよいデータの長さ、RTO は戻るまでにかけてよい時間でした（22章）。

DRS のドキュメントには、数字が書いてあります。RPO は通常 1 秒未満の範囲、RTO は通常 5 分から 20 分、という記述です。どちらも「通常」と付いた、サービスの側の説明です。条件も一緒に書いてあります。RPO が秒の単位に収まるのは、ソースがディスクに書く速さより、ネットワークとステージングエリアが運べる速さのほうが大きい間だけです。書き込みが追いつかなくなれば、遅れは伸びます。RTO は OS の起動にかかる時間に大きく左右される、ともあります。

この数字を、自分のシステムの目標や実績としてそのまま使うことはできません。理由は 3 つあります。

1 つ目は、数字の測り方です。ドキュメントの RPO は、ディスクに書かれて、ステージングエリアに届いた時点までを数えます。メモリにあってディスクに届いていなかったデータは、最初から勘定に入っていません。

2 つ目は、RTO の範囲です。インスタンスが起動するまでが 20 分でも、そこから確認をし、元のサーバーを止め、利用者の通信を切り替え、DNS の変更が行き渡るまでの時間は、DRS の数字の外にあります。災害に気づくまでの時間と、復旧を始めると決めるまでの時間も同じです。多くの場合、長いのは人が判断している時間です。

3 つ目は、環境です。レプリケーションサーバーはおよそ 14 日ごとに入れ替えられ、その間は遅れが出ることがある、と FAQ にあります。ソースのカーネルを上げたとき、ディスクを足したとき、再走査が起きたときにも、遅れは変わります。

だから、目標は自分で決め、実績は訓練で測ります。訓練の記録が出す 2 つの値が、その実績です。

**この本は、何も測っていません。** DRS を一度も動かしていないので、この構成の RPO も RTO も、示せる数字がありません。`vp run dr:demo` が表示する時刻は、説明のために決めた値です。

## 分散システムとして見ると

<!-- section: 40.distributed -->

DRS を入れると、システムは 2 つの拠点と、その間の 1 本の複製の流れになります。考えるべきことは、どの時点で、どちらが正しいデータを持っているか、です。

災害の前は、元のサーバーが正です。ステージングエリアは、遅れのぶんだけ過去の写しです。

failover をすると、リカバリーインスタンスが正になります。その中身は、ステージングエリアに届いていたところまでです。元のサーバーが 201 を返したのに、まだ届いていなかった書き込みは、新しい正には入っていません。この損失は failover の瞬間に確定します。RPO とは、この損失の長さのことです。

困るのは、その後です。

```figure
caption: 元のサーバーが戻ってきて書き込みを受けると、どちらにも相手の知らない書き込みができ、failback は元の側のぶんを黙って消す
type: sequence
actor client: Clients
actor src: Source | zone 1
actor stg: Staging area
actor ri: Recovery instance | zone 2
step client -> src: write A (201)
step src -> stg: replicate A
step client -> src: write B (201)
note src: B が届く前に落ちる
step stg --> ri: launch (A だけを持つ)
step client -> ri: write C (201)
note src: 戻ってくる, 止められていない
step client -> src: write D (201)
note src: split brain
step ri -> src: failback (上書き)
note src: B と D が消える
```

AZ の障害は、たいてい一時的です。元のサーバーは、そのうち戻ってきます。そのとき、古いアドレスを覚えているクライアントが 1 つでも残っていれば、元のサーバーは書き込みを受け、201 を返します。リカバリーインスタンスも書き込みを受けています。2 つの拠点が、どちらも自分が本番だと思っている状態で、これを split brain と呼びます。

ブロック単位の複製には、2 つのディスクを混ぜ合わせる手段がありません。failback は、復旧先のディスクで元のディスクを置き換えます。元の側だけにあった B と D は、そこで消えます。しかも、DRS は何も報告しません。DRS から見れば、指示どおりに複製しただけだからです。

守りたい不変条件は、次の 1 文です。**failback の後、どちらかの拠点が受け付けた書き込みが、黙って失われていない。** 失われないとは言っていません。B は、災害の時点で失われています。求めているのは、失われた書き込みが、戻っているか、記録に残っているかのどちらかであることです。

この条件を、メモリの中の 2 つの拠点で確かめられるようにしました。

<<< @/examples/40-disaster-recovery/src/sites.ts{failback}

1 つ目のメソッドは、DRS がすることをそのまま写したものです。2 つ目は、同じ上書きの前に、DRS が答えてくれない 2 つの問いを挟みます。元のサーバーは止めてあるか。元のサーバーにしか無い書き込みは何か。

元のサーバーが書き込みを受けている間は、failback を始めません。止めてから、元のサーバーのデータを読み、復旧先に無いものを数えて記録します。ディスクごと失われていて読めないときは、書き込みの名前を挙げられないので、「戻った時点より後に元のサーバーが受けたものすべて」という範囲を記録します。

不変条件の判定は、次のとおりです。

<<< @/examples/40-disaster-recovery/src/sites.ts{invariant}

テストは、この条件を壊そうとします。複製の遅れ、元のサーバーの復帰、止め忘れ、古いクライアントの書き込みを、種を固定した乱数で混ぜた 5 通りの順序で試し、記録を取る failback ではどの順序でも条件が保たれることを確かめます。上書きするだけの failback では、条件が破れる順序があることも、テストで示しています。

実際のノートのアプリでは、「元のサーバーのデータを読む」のは、止めたインスタンスのデータボリュームから `notes.json` を取り出して、復旧先のものと ID で比べる作業になります。その作業のコードは、この章にはありません。モデルが示しているのは、順序と、記録を残すという約束だけです。

split brain を防ぐ手立ては、切り替える前に元のサーバーを止めることです。[復旧の順序](/ja/chapters/40-disaster-recovery/build.md)に `fence-source` の段を入れたのは、そのためです。ただ、AZ ごと落ちているときは、止める操作そのものが届きません。そのときは、戻ってきたサーバーが勝手に仕事を始めないようにしておきます。23章のインスタンスなら、利用者のアドレスを切り替えた後は、古いインスタンスへのポート転送を誰もしない、という運用で足ります。公開されているサービスでは、古い側をロードバランサーから外す、セキュリティグループで閉じる、起動時に「自分が本番か」を外に尋ねる、といった仕組みが要ります。

## サーバーを持たない基盤では

<!-- section: 40.platforms -->

Cloudflare Workers から来た人には、この章に対応する体験がありません。Workers のコードは、仮想マシンの上ではなく、Cloudflare のネットワークの各地にある isolate で動き、リクエストは受け取ったデータセンターで処理される、とドキュメントにあります（2026-10-13 時点）。複製するディスクを持つサーバーも、開発者が選んで切り替えるリージョンも、そこにはありません。

Vercel には、リージョンがあります。関数はプロジェクトに設定したリージョンで動き、既定で複数の AZ にまたがる冗長性を持つ、とドキュメントに書いてあります。Enterprise のプランでは、リージョンが使えないときに切り替える先を設定できます。それでも、エージェントを入れてディスクを複製するサーバーは無いので、DRS に当たるものは要りません。

どちらの基盤でも、データの置き場所については 22章と 28章の問いが残ります。サーバーを持たないなら、この章の仕事は最初から発生しません。それは、そちらを選ぶ十分な理由になります。

## つまずきやすいところ

**カーネルが新しすぎる。** この章の最初に書いたとおり、23章の既定の AMI は対象外です。エージェントを入れた後でカーネルを上げた場合に何が起きるかは、確かめていません。23章のパッチの手順でカーネルが上がる前に、対応の一覧を読んでください。

**複製が始まらない。** 経路が足りないと、エージェントは入っても、最初の同期が進みません。`vp run dr:plan` で 443 番の経路を、23章のセキュリティグループで 1500 番のアウトバウンドを確かめます。DRS のコンソールのソースサーバーのページには、複製の開始の手順のどこで止まったかが表示されます。

**訓練のインスタンスが起動しない。** 起動テンプレートにサブネットが無い、インスタンスタイプが Graviton でない、のどちらかを先に疑います。

**インスタンスを止めても課金が続く。** 元のインスタンスを停止しても、ソースサーバーは登録されたままで、DRS の料金もステージングエリアの料金も続きます。止まるのは、複製を止めるか、切り離したときです。

**複製を止めると、時点が消える。** 「複製を止める」操作は課金を止めますが、それまでのスナップショットをすべて消します。もう一度始めると、最初の同期からやり直しです。

**`-c` を忘れてデプロイし直す。** ポリシーがロールから外れ、1500 番の規則が消えます。エラーは出ず、しばらくしてから複製が止まります。

**クォータ。** 1 つのアカウントとリージョンで複製できるソースサーバーは 300 台までで、この値は引き上げられません（2026-10-13 に読んだ一覧）。同時に進められる job は 20、1 台のソースサーバーに対する job は同時に 1 つです。

## 本番にするなら

- **複製が止まったことを、人に知らせる。** この章のスタックはログに書くだけです。19章のメトリクスフィルターとアラームで、エラーの行を通知につなぎます。DRS は、遅れや未同期の量を CloudWatch のメトリクスとしても出しています
- **リージョンをまたぐ。** この章は AZ をまたぐだけです。ドキュメントは、リージョン単位の障害に備えるなら、リージョンをまたぐ複製を勧めています。その場合、復旧先のリージョンに VPC、エンドポイント、初期化が要り、データ転送の料金が加わります
- **スナップショットを守る。** アカウントに入り込まれると、時点のスナップショットも消されます。ベストプラクティスのページは、追加の対策が要ると書いています。DRS とは別に、長く残すバックアップを別のアカウントに持ちます（22章）
- **ステージングエリアを専用のサブネットにする。** ドキュメントが勧めている構成です
- **設定を 23章のスタックに移す。** ポリシーと 1500 番の規則は、インスタンスを持つスタックに書くのが筋です
- **訓練を予定に入れる。** 少なくとも四半期に一度、そして設定や OS を変えるたびに行います。記録は、次の訓練と比べられるように残します
- **切り替えの手順を書いておく。** 誰が復旧を決めるのか、どの時点を選ぶのか、元のサーバーをどう止めるのか、アドレスをどう切り替えるのか。災害の最中に考えることではありません

## 片付け

<!-- section: 40.cleanup -->

片付けには順番があります。先に DRS の側を片付け、その後でスタックを消します。

```bash
vp run dr:terminate --apply
aws drs disconnect-source-server --region ap-northeast-1 --source-server-id s-xxxxxxxxxxxxxxxxx
aws drs delete-source-server --region ap-northeast-1 --source-server-id s-xxxxxxxxxxxxxxxxx
vp run dr:billed
vp run dr:infra:destroy
```

1 行目で、訓練のインスタンスを終了します。リカバリーインスタンスが残っているソースサーバーは、切り離せないからです。

2 行目が、課金を止める操作です。API リファレンスによれば、切り離すと複製はすぐに止まり、複製のために作られたリソース（レプリケーションサーバー、ステージング用のディスク、スナップショット）は 90 分以内に削除されます。エージェントは、DRS と通信できれば、およそ 10 分以内に自分を消す指示を受け取ります。切り離すまでは、インスタンスを止めていても、DRS の料金とステージングエリアの料金が続きます。

3 行目で、ソースサーバーの記録を消します。削除できるのは、切り離したサーバーだけです。

4 行目は、DRS の API から見て、まだ課金されているものを一覧にします。

<<< @/examples/40-disaster-recovery/src/billing.ts{billed}

この一覧は、DRS の 2 つの API が返すものしか見ていません。何も残っていないと表示されても、見えていないものがあることを、タスクが一緒に表示します。切り離した直後は、リソースの削除がまだ終わっていないことがあるので、「片付け中」と出ます。

5 行目で、この章のスタックが消えます。インターフェースエンドポイントの課金が止まり、ポリシーが 23章のロールから外れ、1500 番の規則が消えます。この章のスタックは、23章のスタックより先に消してください。別のスタックのポリシーが付いたままのロールは、IAM が削除を断るはずです（確かめていません）。

その後で、23章と 11章を、それぞれの章の順序で片付けます。

消えたことは、自分で確かめてください。

```bash
aws drs describe-source-servers --region ap-northeast-1
aws drs describe-recovery-instances --region ap-northeast-1
aws ec2 describe-instances --region ap-northeast-1 --filters Name=instance-state-name,Values=pending,running,stopping,stopped
aws ec2 describe-volumes --region ap-northeast-1
aws ec2 describe-snapshots --region ap-northeast-1 --owner-ids self
aws ec2 describe-vpc-endpoints --region ap-northeast-1
```

切り離してから 90 分たっても、3 つ目にレプリケーションサーバーが、4 つ目と 5 つ目にステージング用のボリュームやスナップショットが残っていたら、手で消します。ステージングエリアのリソースには、テンプレートで指定したタグ（`aih:chapter=40`）が付いているはずです。

残るものが 3 つあります。初期化のときに作られた IAM のロール、レプリケーションの設定と起動の設定のテンプレート、そして cdkd の bootstrap で作った保存場所（02章）です。ロールとテンプレートに料金がかかるという記述は、料金ページにも Price List にも見当たりませんでした。DRS の初期化を取り消す操作は、ドキュメントに見つけられませんでした。

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト（訓練の計画と合否、訓練の記録の集計、復旧の順序の途中失敗と再実行、2 つの拠点のモデルと split brain、DRS のイベントの検証、API の応答の形と「まだ課金されているもの」の一覧、ソースの条件と経路のモデル、2 つのテンプレートの内容と CLI のコマンド、料金の入力、スタックのアサーション）。型検査。`dr:infra:synth`（既定、`-c placement=public`、`-c templates=declare`、`-c sourceRoleName=... -c sourceSecurityGroupId=sg-0123456789abcdef0`）。`dr:demo`。`dr:plan`（既定ではカーネル 6.18 を対象外として終了コード 2 で終わること、`kernel=6.1` と `placement=public`）。`aws drs` の各コマンドの引数は、devShell の AWS CLI 2.35.11 の help で読みました。本文の金額は、Price List の単価から `tools/src/pricing/calc.ts` が計算した値で、`examples/40-disaster-recovery/test/pricing.test.ts` が本文の数字と突き合わせています。

**まだ確かめていないこと。** AWS に対しては、何も実行していません。`dr:infra:diff`、`dr:infra:deploy`、`dr:infra:drift`、`dr:infra:destroy`、`dr:status`、`dr:drill`、`dr:job`、`dr:terminate`、`dr:billed` のどれもです。DRS の初期化、テンプレートの作成、エージェントの導入、訓練、復旧、failback、切り離しも、一度もしていません。したがって、RPO と RTO の実測値はありません。次も、すべて実物での確認待ちです。cdkd 0.296.28 がこのスタックを作って消せること（インターフェースエンドポイントと `AWS::EC2::SecurityGroupEgress` は Cloud Control API 経由）。別のスタックのロールにポリシーを付けられること、そのとき 23章のドリフトの検査に何が出るか。AWS のポリシーから権限を除いたこの章のポリシーで、エージェントが動くこと。Graviton の Amazon Linux 2023 でインストーラーが通ること、インスタンスプロファイルを使うときのインストーラーの引数。IMDSv2 必須、hop limit 1 の設定でエージェントが認証情報を取れること。プライベート DNS のエンドポイントを `--endpoint` なしで使えること。S3 のゲートウェイエンドポイントだけで、インストーラーとレプリケーションサーバーのソフトウェアが取れること。DRS のセキュリティグループが 1500 番を受けること。`lagDuration` の実際の書式。EventBridge に届くイベントの実際の形。起動テンプレートの設定と、訓練のインスタンスでデータボリュームがマウントされること。`al2023-ami-kernel-6.1-arm64` というパラメーターが引けること。切り離してから課金が止まるまでの時間。

一次情報で確かめられなかったこと。`AWS::DRS` のリソースの種類は、2026-10-13 に取得したリージョンごとの定義（us-east-1、us-west-2、ap-northeast-1、ap-northeast-3、us-east-2、eu-west-1、ap-southeast-1 の 7 つ）で有無を見ただけで、ほかのリージョンは見ていません。CloudFormation のレジストリに問い合わせてもいません（認証情報が要ります）。`lagDuration` の書式は、API リファレンスにありません。DRS のイベントのスキーマは、ユーザーガイドのサンプルしか読んでいません。レプリケーションサーバーのルートボリュームの大きさと種類、訓練のインスタンスのボリュームの種類の既定値は、ドキュメントに見つけられず、料金に入れていないか、仮定と書いています。ステージング用のディスクが magnetic になる、という記述は 125 GiB 以下のディスクについてのもので、スナップショットの実際の大きさと合わせて、請求書で確かめる必要があります。DRS に無料利用枠があるかは、料金ページにも Price List にも記述がありませんでした。エージェントが IMDSv2 に対応しているかを明記したページは、見つけていません。Cloudflare と Vercel については、それぞれ 1 ページを読んだだけです。

cdkd が扱うリソースの種類。インストールした cdkd 0.296.28 の中身を読むと、`AWS::EC2::SecurityGroup`、`AWS::Events::Rule`、`AWS::IAM::ManagedPolicy`、`AWS::IAM::Policy`、`AWS::IAM::Role`、`AWS::Lambda::Function`、`AWS::Lambda::Permission`、`AWS::Logs::LogGroup` には専用の実装が登録されています。`AWS::EC2::VPCEndpoint`、`AWS::EC2::SecurityGroupEgress`、`AWS::DRS::ReplicationConfigurationTemplate`、`AWS::DRS::LaunchConfigurationTemplate` には登録が無く、Cloud Control API 経由です。スタックのテストが、既定の構成で使う種類の一覧を固定しています。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 置いてあるだけでかかる料金 | `examples/40-disaster-recovery/src/cost.ts`、`scripts/plan.ts`、`test/pricing.test.ts`、`data/pricing/` | `dr:plan`、`test:unit` |
| 全体像 | `examples/40-disaster-recovery/infra/lib/dr-stack.ts`、`infra/bin/app.ts`、`src/config.ts` | `dr:infra:synth` |
| ソースサーバーになれる条件 | `examples/40-disaster-recovery/src/source.ts`、`test/plan.test.ts` | `dr:plan`、`test:unit` |
| エージェントに必要な経路 | `examples/40-disaster-recovery/src/network.ts`、`infra/lib/dr-stack.ts`、`test/plan.test.ts`、`examples/11-network/src/reach.ts` | `dr:plan`、`test:unit` |
| エージェントの権限 | `examples/40-disaster-recovery/infra/lib/dr-stack.ts`、`infra/test/dr-stack.test.ts` | `test:unit`、`dr:infra:synth` |
| 宣言できるもの、できないもの | `examples/40-disaster-recovery/src/templates.ts`、`infra/lib/dr-stack.ts`、`infra/test/dr-stack.test.ts` | `dr:plan`、`dr:infra:synth`、`test:unit` |
| 訓練の判断 | `examples/40-disaster-recovery/src/drill.ts`、`src/drs.ts`、`src/adapter.ts`、`test/drill.test.ts`、`test/billing.test.ts`、`test/fixtures.ts` | `test:unit` |
| 復旧の順序 | `examples/40-disaster-recovery/src/order.ts`、`test/order.test.ts` | `test:unit`、`dr:demo` |
| DRS のイベントを受ける | `examples/40-disaster-recovery/src/events.ts`、`src/events-lambda.ts`、`test/events.test.ts` | `test:unit` |
| 手元で動かす | `examples/40-disaster-recovery/scripts/demo.ts`、`scripts/plan.ts` | `dr:demo`、`dr:plan`、`test:unit`、`dr:infra:synth` |
| 複製を始めるまで | `examples/40-disaster-recovery/infra/bin/app.ts`、`src/templates.ts`、`tools/src/infra/` | `dr:infra:diff`、`dr:infra:deploy`、`dr:plan`、`dr:status` |
| 訓練 | `examples/40-disaster-recovery/scripts/dr.ts`、`src/drill.ts`、`drill/record.template.json` | `dr:status`、`dr:drill`、`dr:job`、`dr:terminate` |
| 本当の failover と、戻り方 | `examples/40-disaster-recovery/src/order.ts`、`src/sites.ts` | `dr:status` |
| 分散システムとして見ると | `examples/40-disaster-recovery/src/sites.ts`、`test/sites.test.ts`、`scripts/demo.ts` | `test:unit`、`dr:demo` |
| 片付け | `examples/40-disaster-recovery/src/billing.ts`、`scripts/dr.ts`、`test/billing.test.ts` | `dr:terminate`、`dr:billed`、`dr:infra:destroy` |

**一次情報**（確認日はすべて 2026-10-13）

- Elastic Disaster Recovery のユーザーガイド: [What is Elastic Disaster Recovery?](https://docs.aws.amazon.com/drs/latest/userguide/what-is-drs.html)、[Initialization and permissions](https://docs.aws.amazon.com/drs/latest/userguide/getting-started-initializing.html)、[Supported AWS Regions](https://docs.aws.amazon.com/drs/latest/userguide/supported-regions.html)、[Network diagrams](https://docs.aws.amazon.com/drs/latest/userguide/Network-diagrams.html)、[Network setting preparations](https://docs.aws.amazon.com/drs/latest/userguide/Network-Settings-Preparations.html)、[Network requirements](https://docs.aws.amazon.com/drs/latest/userguide/Network-Requirements.html)、[Installing the agent on a secured network](https://docs.aws.amazon.com/drs/latest/userguide/installing-agent-blocked.html)、[Amazon EBS volumes](https://docs.aws.amazon.com/drs/latest/userguide/volumes-drs.html)、[Security groups](https://docs.aws.amazon.com/drs/latest/userguide/drs-security-group.html)、[Data routing and throttling](https://docs.aws.amazon.com/drs/latest/userguide/data-routing.html)、[Point in time (PIT) policy](https://docs.aws.amazon.com/drs/latest/userguide/point-in-time.html)、[Supported Linux operating systems](https://docs.aws.amazon.com/drs/latest/userguide/Supported-Operating-Systems-Linux.html)、[Generating the required AWS credentials](https://docs.aws.amazon.com/drs/latest/userguide/credentials.html)、[Using an instance profile for agent installation in AWS](https://docs.aws.amazon.com/drs/latest/userguide/agent-installations-in-aws.html)、[Installing the AWS Replication Agent on Linux](https://docs.aws.amazon.com/drs/latest/userguide/linux-agent.html)、[Adding instances from the Amazon EC2 Console](https://docs.aws.amazon.com/drs/latest/userguide/adding-servers-from-aws-instances.html)、[Key considerations for EC2 launch templates](https://docs.aws.amazon.com/drs/latest/userguide/ec2-key-considerations.html)、[Launch into source instance](https://docs.aws.amazon.com/drs/latest/userguide/default-drs-launch-into-source-instance.html)、[Post-launch actions](https://docs.aws.amazon.com/drs/latest/userguide/post-launch-action-settings-overview.html)、[Source networks](https://docs.aws.amazon.com/drs/latest/userguide/source-networks.html)、[Recovery plans](https://docs.aws.amazon.com/drs/latest/userguide/recovery-plans.html)、[Recovery and failback](https://docs.aws.amazon.com/drs/latest/userguide/failback.html)、[Preparing for recovery](https://docs.aws.amazon.com/drs/latest/userguide/preparing-failover.html)、[Performing a failover](https://docs.aws.amazon.com/drs/latest/userguide/failback-preparing-failover.html)、[Performing a failback](https://docs.aws.amazon.com/drs/latest/userguide/failback-performing-main.html)、[Cross-Region failback](https://docs.aws.amazon.com/drs/latest/userguide/failback-failover-region-region.html)、[Cross Availability Zone recovery](https://docs.aws.amazon.com/drs/latest/userguide/failback-failover-cross-availability-zone-failback.html)、[Command menus](https://docs.aws.amazon.com/drs/latest/userguide/command-menus.html)、[Best practices](https://docs.aws.amazon.com/drs/latest/userguide/best_practices_drs.html)、[Alarm events and EventBridge](https://docs.aws.amazon.com/drs/latest/userguide/monitoring-event-bridge.html)、FAQ の [Concepts](https://docs.aws.amazon.com/drs/latest/userguide/CloudEndure-Concepts.html) と [Replication](https://docs.aws.amazon.com/drs/latest/userguide/Replication-Related-FAQ.html)
- API と権限: [StartRecovery](https://docs.aws.amazon.com/drs/latest/APIReference/API_StartRecovery.html)、[DisconnectSourceServer](https://docs.aws.amazon.com/drs/latest/APIReference/API_DisconnectSourceServer.html)、[DataReplicationInfo](https://docs.aws.amazon.com/drs/latest/APIReference/API_DataReplicationInfo.html)、[AWSElasticDisasterRecoveryEc2InstancePolicy](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AWSElasticDisasterRecoveryEc2InstancePolicy.html)、[エンドポイントとクォータ](https://docs.aws.amazon.com/general/latest/gr/drs.html)、[PrivateLink に対応するサービス](https://docs.aws.amazon.com/vpc/latest/privatelink/aws-services-privatelink-support.html)、`@aws-sdk/client-drs` 3.1149.0 の型定義
- CloudFormation と道具: [Resource provider schemas](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/resource-type-schemas.html)（リージョンごとの zip を取得して中を見ました）、`aws-cdk-lib` 2.273.0 の `aws-drs` の型定義、`@go-to-k/cdkd` 0.296.28 の中身
- 料金: [AWS Elastic Disaster Recovery pricing](https://aws.amazon.com/disaster-recovery/pricing/)、AWS Price List bulk API の [Elastic Disaster Recovery](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSElasticDisasterRecovery/current/ap-northeast-1/index.json) と [EC2](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/ap-northeast-1/index.csv)（CSV を usage type で絞って読みました）
- 比べた相手: [AWS Elastic Disaster Recovery FAQs](https://aws.amazon.com/disaster-recovery/faqs/)、[AWS Backup: backup plan options](https://docs.aws.amazon.com/aws-backup/latest/devguide/plan-options-and-configuration.html)、[How Workers works](https://developers.cloudflare.com/workers/reference/how-workers-works/)、[Configuring regions for Vercel Functions](https://vercel.com/docs/functions/configuring-functions/region)

:::
