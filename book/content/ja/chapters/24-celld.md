---
title: "24 発展ラボ: celld を AWS でセルフホストする"
revision: 1
---

# 24 発展ラボ: celld を AWS でセルフホストする

[23章](/ja/chapters/23-ec2.md)で、machine を 1 台、OS ごと自分で持ちました。最後の章では、その machine の上で、AWS が面倒を見てくれない分散システムを動かしてみます。

題材は celld です。Deno Land が公開している OSS で、Cloudflare Workers と Durable Objects のアプリケーションを自分の machine で動かし、長く残す状態は自分の bucket に置く、という daemon です。AWS の managed service ではありません。止まったら自分で起こし、更新は自分で順番を決め、壊れたら自分で戻します。それがどういうことかを、小さな fleet で体験する章です。

先にお金の話を。この章も、**置いてあるだけで時間で課金されるもの**を作ります。node を 1 台動かして 1 日でおよそ USD 2.71、1 か月（730 時間）で USD 82.56。3 台なら 1 日 USD 4.11、1 か月 USD 125.03 です。既定の構成は node が 0 台で、時間課金はありません。台数は自分で指定したときだけ増えます。試したら、その日のうちに「片付け」まで進めてくださいね。

もうひとつ、正直に言っておきます。この章の手順は、AWS では一度も動かしていません。celld の binary も、手元で一度も実行していません。celld について書いたことは、すべて v0.6.2 の公式文書とソースを読んだ内容です。手元で確かめたのは、インフラの定義と、順序を決めるロジックと、検査の判定です。内訳は章末にまとめました。

前提は [23章](/ja/chapters/23-ec2.md)と [11章](/ja/chapters/11-network.md)の VPC、それに [22章](/ja/chapters/22-recovery.md)の復旧の考え方です。コードは `examples/24-celld/` にあります。

## celld って何者？

<!-- section: 24.what -->

公式の説明を、そのまま借ります。

- **cell** は、名前と自分専用の SQLite データベースを持つ小さなサーバーです。Cloudflare の言葉で言えば Durable Object。ユーザーごと、文書ごと、チャットルームごとに 1 つ作ります
- **node** は、machine 1 台で動く celld のプロセス 1 つです
- 同じ bucket を共有する node の集まりが **fleet** です。参加の手続きはありません。node は bucket の中の記録でお互いを見つけます

おもしろいのは、leader 選出も membership の管理も持たないところです。cell ごとに、bucket の中に小さな ownership record（持ち主の記録）があります。node は条件付きの書き込みでそれを取りに行き、勝った 1 台だけがその cell を担当します。誰が勝ったかを決めるのは bucket です。

celld が約束しているのは 2 つです。1 つの cell を担当する node は同時に 1 台だけ。そして、応答を返した書き込みは失われない。どちらにも前提が付いています。bucket が条件付きの書き込みと範囲指定の読み取りを正しく実装していること、そしてプロセスを起動し直す supervisor がいること。Amazon S3 は、celld が「使える」と挙げている store のひとつです。ただし release 前の試験は Cloudflare R2 に対して行われていて、S3 は「同じ client と header を使う」という位置づけです。

この章を書くために読んだ時点の事実も並べておきます。

- 最新の release は v0.6.2（2026-10-07 公開）。公式の limitations と security のページは、これを **beta** と呼んでいます
- security fix が入るのは最新の release だけ
- 最初の release から 2 か月ほどで 11 回の release が出ています。この章の内容は、すぐ古くなります
- fleet 1 つで動かせる application は 1 つ。互いに信頼していないコードを同じ fleet に載せる使い方は「安全ではない」と明記されています

Cloudflare で Durable Objects を使うなら、node も bucket も disk も、あなたの目には入りません。ここでは全部が見えて、全部があなたの仕事になります。Cloudflare 側の保証や料金は、この章では調べていません。比べるのは「誰が運用するか」だけです。

## 版を固定して、中身を確かめる

<!-- section: 24.pin -->

自分で運用するソフトウェアは、まず「どれを動かしているか」を固定します。公式の installer は、指定がなければ最新版を取りに行く shell script です。便利ですが、明日には別のものが入ります。

この章では、版と、配布物の SHA-256 を repository に書いてしまいます。

<<< @/examples/24-celld/src/celld.ts{releases}

digest は GitHub の release に載っている値で、実際に archive を取得して計算し直した値と一致することを確かめました。v0.6.1 も入っているのは、後で「古い版から更新する」練習をするためです。

取得するタスクは、大きさと digest が合わなければ何も残しません。

<<< @/examples/24-celld/scripts/fetch.ts{verify}

```bash
vp run celld:fetch
```

node 用の Linux arm64 の archive が `examples/24-celld/.celld/download/` に入ります。`--host` を付けると、あなたの machine 用の binary と、公式の counter の example も取ってきます（後で application を deploy するのに使います）。このタスクが話す相手は github.com だけで、取得したものは実行しません。

digest が合うことは「GitHub に置いてあるものと同じ」ことまでしか言いません。それが celld の CI で作られたものかどうかは、公式が案内している `gh attestation verify <file> --repo denoland/celld` で確かめます。GitHub CLI は devShell に入っていないので、ここは各自で。

## 全体像

<!-- section: 24.architecture -->

```text
your machine                          AWS (ap-northeast-1)
  vp run celld:*  -- Run Command -->  VPC from chapter 11, private subnets, no inbound from outside
  celld deploy    -- S3 API ------+
                                  |    node a (AZ 1)      node b (AZ 2)      node c (AZ 1)
                                  |    celld :8081  <-->  celld :8081  <-->  celld :8081   peers: plain HTTP
                                  |    Worker 127.0.0.1:8080 on each node (loopback only)
                                  |    data volume        data volume        data volume    retained
                                  |         |                  |                  |
                                  +--> fleet bucket  s3://<bucket>/fleet/      (S3 gateway endpoint)  retained
                                       backup bucket s3://<bucket>/backups/    (nodes have no access)  retained
```

CDK が作るのはここまでです。bucket、role、security group、そして指定した数の instance と volume。celld を入れる、起動する、更新する、といった作業は CDK の外に置きました。理由は 23章と同じで、template を変えるたびに instance が作り直されるのは困るからです。それに celld の場合は、「どの node をいつ止めるか」が正しさに関わります。CloudFormation や cdkd の都合で順番が決まってしまうのは避けたいんです。

なお、cdkd と celld をつなぐ仕組みは作っていません。そういうものが公式にあるという記述は見つからなかったので、想像で埋めることはしませんでした。

設定は CDK の context で渡します。

<<< @/examples/24-celld/src/config.ts{schema}

`nodes` の既定は 0 です。`vp run celld:infra:deploy` とだけ打っても、時間で課金されるものは 1 つもできません。

ここで 11章の注意をもう一度。`-c` はその回の実行にしか効きません。`-c nodes=3` で作った後に、`-c` を付け忘れて deploy すると、cdkd は node を 3 台とも消しにいきます。data volume は残りますが（次の節）、template の管理からは外れてしまい、次に `-c nodes=3` で deploy すると空の volume が新しく作られます。deploy の前には、必ず `vp run celld:infra:diff -c nodes=3` を見てください。

手元で計画を見るタスクもあります。AWS には触りません。

```bash
vp run celld:plan nodes=3
```

## peer の通信に TLS は無い

<!-- section: 24.network -->

この本の構成案には、もともと「peer の通信は private な network と TLS で守る」と書いてありました。調べてみると、後半は成り立ちません。celld は TLS を終端しません。公式の言葉では、listener は 2 つあって、どちらでも TLS を終端しない、です。

- **public の listener**（`--listen`）は、deploy した Worker に届きます。TLS とユーザーの認証は、手前の proxy か application の仕事です
- **internal の listener**（`--internal-listen`）は、peer どうしの通信と、operator 用の API に使います。peer の通信は平文の HTTP。fleet で共有する HMAC が接続の確立と制御の request に署名しますが、暗号化はしません。そして operator 用の API の多くには認証がありません。node を止める `POST /shutdown` も、状態を見る `/state` も、です

つまり internal の listener は、「届く人は全員、管理者」です。公式の指示は、信頼できる private な network か、WireGuard や Tailscale のような暗号化された overlay の上に置け、というものです。

この章では、前者を security group で作ります。

<<< @/examples/24-celld/infra/lib/celld-stack.ts{network}

inbound は 1 行だけ。internal の port に、同じ security group の member からだけ届きます。VPC の CIDR ではなく group を相手に指定しているので、同じ VPC の別の instance からは届きません。public の listener には rule がありません。そもそも loopback（`127.0.0.1`）で listen させるので、node の外からは届かない作りです。この lab に ingress は無く、Worker への request は node の上から打ちます。

「VPC の中だから暗号化されている」とは、言い切れません。EC2 のドキュメントによると、instance 間の通信を自動で暗号化するのは一部の instance type で、その一覧に M7g や C7g はあっても、この章が使う T4g はありません。AZ をまたぐ通信は物理層で暗号化される、とも書かれています。それで足りるかどうかは、流すデータ次第です。足りないなら、一覧にある instance type を使うか、celld の勧める overlay を足してください。この章では、どちらも作っていません。

## 状態は bucket に、でも disk も捨てられない

<!-- section: 24.state -->

「長く残す状態は bucket にある」と聞くと、node は使い捨てに思えますよね。instance も volume も、いつ消してもいい、と。

半分だけ正しいです。celld の `fleet` という既定の動作では、持ち主の node は書き込みを 1 台か 2 台の別の node（follower）に送り、相手が disk に書いた時点で応答を返します。bucket への upload は、その後です。公式の文書にははっきり書いてあります。follower の disk は、bucket にまだ無い「応答済みの書き込み」を持っていることがある、と。

だから、こうなります。

- node を 1 台ずつ、正しい手順で止めるなら、その node の disk は捨てられます（止まる前に引き渡しと upload を済ませるからです）
- 全部の node の disk を同時に捨てると、応答済みの書き込みを失うことがあります
- node が突然死んだとき、残りの node は、死んだ node が upload していなかった分を follower の disk から集めます。その follower まで消えていたら、集められません

そこで、bucket と、node ごとの data volume の両方を「残す」設定にしました。

<<< @/examples/24-celld/infra/lib/celld-stack.ts{buckets}

volume は 23章と同じく、instance とは別の resource です。instance を作り直しても、volume は付け替えられるだけで中身は残ります（node の定義は `celld-stack.ts` の `nodes` の region にあります）。`stateOnDestroy` の既定は `retain`。stack を destroy しても、bucket 2 つと data volume は残ります。残った volume には料金がかかり続けるので、「片付け」で消し方を書きます。練習だけなら `-c stateOnDestroy=delete` で、stack と一緒に消える設定にできます。

本番で `delete` にする理由は、たぶんありません。

bucket の versioning は有効にしていません。celld は自分で object を消しますし、古い世代を掃除する仕組み（epoch GC）も持っています。versioning を重ねたときにどうなるかは、どこにも書かれていなかったので、足していません。

node の権限も見ておきましょう。

<<< @/examples/24-celld/infra/lib/celld-stack.ts{role}

公式は「bucket の credentials を持つ者が fleet を支配する」と書いています。deployment も、cell の状態も、ownership record も、peer の認証に使う secret も、全部 bucket の中だからです。なので権限は、1 つの bucket の、1 つの prefix に絞りました。backup 用の bucket には、node は一切触れません。

ひとつ断っておくと、celld が S3 のどの action を必要とするかの一覧は、公式文書にありません。Azure 向けには「read、write、list、delete」と書かれているので、それを S3 の action に読み替え、ソースが multipart upload を使っているのを見て `s3:AbortMultipartUpload` を足しました。足りなければ、node の log に AccessDenied が出るはずです。

## node の中身

<!-- section: 24.node -->

machine の用意は 23章と同じ流れです。user data はアカウントと directory と unit を置いて、data volume を mount するところまで。celld 本体は入れません。

unit は、celld の要求をそのまま写したものです。

<<< @/examples/24-celld/deploy/celld.service

23章の unit と違うところが 3 つあります。

`Restart=always` と `StartLimitIntervalSec=0`。celld の node は、bucket の lease（生存の記録）を更新できなくなると、自分から止まります。`SELF-FENCE:` で始まる行を log に出して、終了コード 3 で終わります。一度こうなった node は、再起動でしか戻りません。そこで公式は supervisor に 2 つ求めています。回数の上限なしで再起動すること。そして、次の起動まで lease の寿命 1 つ分（既定で 10 秒）以上待つこと。23章では「5 回落ちたら諦める」設定にしましたが、ここでは逆です。

`RestartSec=15`。その「lease の寿命 1 つ分以上」です。

`TimeoutStopSec=60`。celld は SIGTERM を受けると、担当している cell をほかの node に引き渡してから終わります。その上限が既定で 40 秒。systemd がそれより先に SIGKILL を送ると、引き渡しが途中で切れます。

この 2 つの数字は、設定を間違えると生成の時点で止まるようにしてあります。

<<< @/examples/24-celld/src/machine.ts{spec}

celld を入れる script はこれです。

<<< @/examples/24-celld/deploy/celld-install.sh

private subnet の node は internet に出られないので、archive は S3 から取ります（あなたが `celld:fetch` で取得して確かめたものを、`celld:artifacts` で bucket に置きます）。digest は bucket から読むのではなく、repository に固定した値を引数で渡します。bucket の中身を書き換えられる人がいても、digest までは書き換えられません。

設定は flag ではなく環境変数で渡しています。どれも公式の文書にある名前です。大事なのは `CELLD_WATCH`。指定しないと、celld は一時 directory を作業場所にします。follower として預かった書き込みが、再起動で消える場所に置かれることになります。ここでは data volume の上を指定しています。

`CELLD_ADVERTISE` は、ほかの node から見た自分の address です。instance の private IP を、IMDSv2 で読んで書き込みます。

`CELLD_NODE`（node の session ID）は、あえて設定していません。固定してよいものかどうかが文書から読み取れなかったので、既定（起動ごとに生成）のままにしました。

そして、この script は service を起動も再起動もしません。node をいつ止めるかは、次の節の主役だからです。

## いくらかかる？

<!-- section: 24.cost -->

内訳はこうです（すべて ap-northeast-1 の定価、USD、730 時間）。

- `t4g.small` の instance が 1 台 USD 15.77
- gp3 の volume が node ごとに 16 GiB で USD 1.54（root の 8 GiB は仮定です。実際の大きさは確かめていません）
- S3 への request が node ごとに USD 3.93 ほど。これは見積もりです
- 11章の stack に足す interface endpoint が USD 61.32

合計すると、1 台で USD 82.56、3 台で USD 125.03。23章と同じで、いちばん高いのは endpoint です。1 台構成なら 7 割以上を占めます。endpoint を除くと 1 台 USD 21.24、3 台 USD 63.71 です。

S3 の request について補足します。celld の node は、何もしていなくても bucket と話し続けます。文書にある間隔は、lease の更新が寿命の 3 分の 1 ごと（約 3.3 秒に 1 回の書き込み）、fleet の負荷の読み取りが 5 秒に 1 回、deployment の確認が 30 秒に 1 回。1 か月で書き込みが約 79 万回、読み取りが約 61 万回です。これは文書の数字から計算した下限で、実測ではありません。cell が動けば増えますし、bucket に溜まる object の保存料金も別にかかります。

<<< @/examples/24-celld/src/cost.ts{billable}

instance を 3 台とも止めても、USD 65.93 かかり続けます。volume と endpoint です。既定のまま stack を消した後も、残った data volume 3 つに月 USD 2.30 かかります。

instance type について。celld の文書には「8 GB の node 1 台で、memory に載った cell を 1,000 個持てる」という目安があるだけで、最小の要件は書かれていません。2 GiB の `t4g.small` で足りるかどうかは、確かめていません。

## 手元で確かめられること、られないこと

<!-- section: 24.local -->

```bash
vp run test:unit
vp run celld:plan nodes=3
vp run celld:render
vp run celld:infra:synth -c nodes=3
vp run celld:fetch
```

テストが確かめているのは、次のことです。

- stack が作るもの。既定では時間課金の resource が 0 個であること、inbound が group 自身からの 1 行だけであること、IMDSv2 が必須であること、bucket と volume が残る設定であること、role に `*` が無いこと
- unit と install script。celld の 2 つの要求（再起動の間隔と停止の猶予）を破れないこと、digest の合わない archive を拒むこと（本物の script を bash で動かします）
- 更新の順序。次の節で話します
- node を失ったときの検査の判定。その次の節で

確かめられないのは、celld そのものです。celld には `celld dev` という、cloud の bucket なしで node を 1 つ動かすコマンドがあります。application を書くなら、まずそれで動かすのがよさそうです。ただ、この章の執筆では binary を実行していないので、その使い心地は書けません。

## まず 1 台で動かす

<!-- section: 24.one-node -->

ここから先は、実行していない手順です。順番に意味があるので、理由と一緒に書きます。

```bash
vp run net:infra:deploy -c interfaceEndpoints=ssm,ssmmessages,ec2messages
vp run celld:fetch --host
vp run celld:infra:deploy -c nodes=1
vp run celld:status
vp run celld:artifacts
vp run celld:install
vp run celld:app-deploy
vp run celld:start
vp run celld:smoke
vp run celld:diagnose
```

1 行目は 23章と同じで、private subnet の instance が Systems Manager に届くための endpoint です。4 行目の `celld:status` で、user data が終わって data volume が mount されたことを確かめます。

`celld:artifacts` が archive を bucket に置き、`celld:install` が各 node でさっきの script を動かします。この時点では、celld はまだ起動していません。

`celld:app-deploy` は、この章で唯一、あなたの machine で celld の binary を動かす手順です。公式の counter の example を、`celld deploy` で fleet の bucket に書き込みます。これには、あなたの credentials で fleet の bucket に書ける権限が要ります。さっきの言葉を思い出してください。それは fleet の管理者の権限です。

`celld:start` で node が起動します。celld は起動のたびに、bucket が条件付きの書き込みを本当に守るかを自分で試験します。これは無効にできません。

期待する結果は、`celld:smoke` が `{"ok":true}` と、`{"n":1,...}`、`{"n":2,...}` を表示することです。counter は、request のたびに 1 を足して返すだけの Durable Object です。`celld:diagnose` は、bucket の試験の結果と、生きている node の一覧を出します。

<<< @/examples/24-celld/src/remote.ts{commands}

1 台の fleet について、公式が書いていることを 2 つ。書き込みは毎回 bucket への往復を待つので、遅いです（同じ region の store で 90 ms ほど、という目安が載っています）。そして、その 1 台が止まっている間、cell を引き継ぐ相手はいません。23章の「1 台は単一障害点」が、そのまま当てはまります。

## fleet にして、1 台ずつ入れ替える

<!-- section: 24.rollout -->

node を増やすのは、数字を変えて deploy するだけです。

```bash
vp run celld:infra:diff -c nodes=3
vp run celld:infra:deploy -c nodes=3
vp run celld:install
vp run celld:start
vp run celld:diagnose
```

join のコマンドはありません。同じ bucket を指して起動した node は、bucket の lease でお互いを見つけます。2 台になった時点で、書き込みは follower の disk に載れば応答を返せるようになります。3 台なら follower は 2 台です。

さて、ここからが本題です。動いている fleet の node を、どう入れ替えるか。

公式の手順は短いです。node を SIGTERM で止める。代わりの node が healthy になるのを待つ。次へ進む。待つ間の目安も書かれていて、`celld diagnose` が全部の node について `restoring=0` と言うまで、次を止めるな、です。

止める側はこうなります。`systemctl stop` は SIGTERM を送るので、celld は health を 503 にして、受け付け済みの request を終わらせ、cell を peer に引き渡してから終了します。

```bash
vp run celld:drain a
```

これを 1 台ずつ、確認を挟みながら繰り返すのが rolling update です。手でやると、確認を 1 回飛ばしただけで「2 台が同時に落ちている」時間ができます。なので、順番は関数にしました。

<<< @/examples/24-celld/src/rollout.ts{rolling}

AWS も celld も、この関数は直接には知りません。知っているのは `FleetOps` という 6 つの操作だけです。

<<< @/examples/24-celld/src/rollout.ts{ops}

本物の `FleetOps` は Run Command を送ります。テストの `FleetOps` は、配列に記録するだけの stand-in です。`wait` も記録するだけなので、テストは時計を進めません。08章と同じやり方で、失敗を決まった場所に差し込みます。

- 2 台目の drain、install、start のそれぞれで失敗させる。そこで止まり、3 台目には触らない
- 再起動した node がいつまでも `restoring` を終えない。決めた回数で諦めて止まる。次の node は動いたまま
- 再起動した node が古い binary で上がってきた。待たずに止まる
- 最初から 1 台落ちている。何も触らない

どの場合も、「同時に落ちている node は最大 1 台」を確かめています。

次へ進んでよいかの判定は、ここです。

<<< @/examples/24-celld/src/health.ts{settled}

読めない出力は「まだ」と扱います。celld の operator 向けの interface は alpha で、release ごとに変わりうる、と公式が書いているからです。出力の形が変わったら、この関数は「進むな」と言い続けます。それでいいんです。

### 版によっては、rolling ではいけない

もうひとつ大事なことがあります。rolling update は、古い版と新しい版が同時に動く時間を作ります。それが許されるかどうかは、版の組み合わせ次第です。

<<< @/examples/24-celld/src/celld.ts{upgrade-notes}

これは公式の upgrade notes を写したものです。たとえば v0.5.1 から v0.6.0 は「全部止めてから」。v0.6.0 の node は、v0.5.1 の follower がいると起動を拒みます。v0.3.0 から v0.4.0 では、混ぜると commit 済みの値が読めなくなることがある、と書かれています。

`celld:rollout` は、いま動いている版と目標の版をこの表で引きます。表に無い組み合わせ（1 つ飛ばし、downgrade、この章より新しい版）は「不明」として止まります。推測で rolling にはしません。公式の notes を読んで、表に足してから、もう一度実行してください。

「全部止めてから」の組み合わせでは、手順が変わります。

```bash
vp run celld:stop-all
vp run celld:backup
vp run celld:rollout v0.6.2 --stopped
```

全部の node を止め、lease が切れるのを待ち、backup を取り、全部の node に新しい binary を入れてから、起動します。古い node が 1 台でも動いていたら、`--stopped` の rollout は何もしません。

練習するなら、v0.6.1 で fleet を作って（`vp run celld:fetch v0.6.1 --host`、`vp run celld:artifacts v0.6.1`、`vp run celld:install v0.6.1`）、`vp run celld:artifacts`、`vp run celld:rollout v0.6.2` で上げてみてください。application を deploy する手元の binary も、fleet と同じ版に揃えます。公式も、operator の道具と celld の release は揃えておけ、と書いています。

## node を 1 台、失ってみる

<!-- section: 24.loss -->

drain は行儀のいい止め方でした。今度は、行儀の悪いほうです。

celld の約束を、client から見える形に直してみます。counter は request のたびに 1 を足して、新しい値を返します。なら、ある cell に順番に request を送り続ける client から見て、こう言えるはずです。

> 応答をもらった値は、後から小さくならない。そして、request を送った回数より多くは進まない。

前半が破れたら、応答済みの書き込みが消えています。後半が破れたら、1 つの request が 2 回実行されたか、誰か別の書き手がいます。

ややこしいのは、応答が返ってこなかった request です。timeout、503、壊れた body。それが実行されたのかされなかったのか、client には分かりません。だから「どちらでもありうる」として数えます。

<<< @/examples/24-celld/src/ledger.ts{invariant}

検査の流れはこうです。

```text
time ->
witness node:  probe: one request per cell, round after round .......... DONE
victim node:                      stop-instances --skip-os-shutdown
every survivor:                                                          sweep: read each cell back
judge:         acked values never go back; no step without a request; an ack after the fault for every cell
```

残す側の node（witness）で、client 役の script を動かします。少し書き込ませてから、別の node（victim）を `aws ec2 stop-instances --skip-os-shutdown` で止めます。OS の shutdown を飛ばすので、celld は SIGTERM を受け取れず、引き渡しもできません。script で起こせる範囲では、machine の喪失にいちばん近い止め方です。instance も volume も消えないので、後で起こせます。

<<< @/examples/24-celld/scripts/fleet.ts{loss-check}

probe が終わったら、残った node の 1 台 1 台から、全部の cell をもう一度読みます。これが「持ち主は 1 台だけ」の検査です。もし 2 台がそれぞれ自分を持ち主だと思っていたら、入口を変えたときに値が食い違います。celld 自身の試験も、cell を別々の node 経由で読む、というやり方をしています。

client 役の script は、こういうものです。

<<< @/examples/24-celld/src/probe.ts{script}

```bash
vp run celld:loss-check b
vp run celld:revive b
```

ここは特に正直に書いておきます。**この検査を、celld の実物に当てたことはありません。** テストで判定に掛けているのは、`test/toy-fleet.ts` という、この章のために書いた作り物の fleet です。celld の protocol を再現したものではありません。わざと壊した変種を持っていて、判定がそれを見つけられることを確かめています。

- 書き込みが残る前に応答を返す fleet。node を失うと、値が戻る。見つかる
- 古い持ち主が、交代に気づかず応答を続ける fleet。入口を変えて読むと食い違う。見つかる（1 台からしか読まないと、見つからない。これもテストにしてあります）
- request を 2 回実行する fleet。見つかる
- 何も壊れていない fleet。応答が 1 つ消えても、違反にはならない

もうひとつ。celld の ownership record そのものを読む検査は、作っていません。record の形式は公開された interface ではなく、ソースの内部にしか無いからです。ここで確かめるのは、client から見える結果だけです。

そして、この検査が「守られた」と言ったとしても、それは今回送った request と、今回起こした 1 つの障害についての話です。celld が正しいことの証明にはなりません。「判定できない」という結果もあります。障害の後に一度も応答しなかった cell があれば、その cell の書き込みが残っているかは分からないからです。

## backup と restore

<!-- section: 24.backup -->

celld に、backup のコマンドはありません。公式文書に出てくる手順は 1 つだけです。v0.4.1 からの更新の説明の中にあります。全部の node を止め、lease が切れるのを待ってから、bucket と node の data を両方 backup する。戻すときは、その backup をまるごと戻す。backup より後の書き込みは失われる。

「node の data も」という点が大事です。理由はさっきの節のとおり、bucket にまだ無い応答済みの書き込みが、disk にあるかもしれないからです。

```bash
vp run celld:stop-all
vp run celld:backup
vp run celld:start
```

`celld:backup` は、動いている node が 1 台でもあれば何もしません。止まっていることを確かめたら、node ごとに data volume の snapshot を取り、fleet の prefix を backup 用の bucket に copy して、どの snapshot がどの node のものかを manifest に書きます。

動かしたままの backup は、用意していません。動いている fleet の bucket を copy したものが、戻せる状態である保証を、公式文書のどこにも見つけられなかったからです。22章の PITR や versioning は、「その時点の bucket」を戻す道具です。celld の状態は bucket と複数の disk にまたがっているので、bucket だけをある時点に戻しても、揃った状態にはなりません。

restore は、消す操作です。なので既定は dry-run にしました。

<<< @/examples/24-celld/src/backup.ts{restore}

```bash
vp run celld:stop-all
vp run celld:restore 20261012T010203Z
vp run celld:restore 20261012T010203Z --yes
```

1 回目は、何が上書きされ、何が消えるかを表示するだけです。`--yes` を付けると、fleet の prefix を backup と同じ内容に戻します。続けて、node ごとの volume を snapshot から作り直す deploy のコマンドが表示されます。bucket と disk は、必ず両方戻します。backup に含まれる node と、いまの fleet の node が一致しないときは、restore は始まりません。

volume の作り直しは、23章で見たとおり cdkd が「状態を持つ resource の置き換え」として扱い、`--force-stateful-recreation` を求めます。古い volume は `retain` の設定で残るので、後で自分で消します。

この一連の手順は、通しで動かしていません。特に、`aws s3 sync` で copy した bucket と snapshot から戻した disk で celld が問題なく起動するかは、確かめるべき最初の項目です。戻せることを確かめていない backup は、まだ backup ではありません。

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

一次情報で確かめられなかったこと。celld が必要とする S3 の action の一覧（Azure 向けの記述からの読み替えです）。bucket の versioning と celld の組み合わせ。`CELLD_NODE` を再起動をまたいで固定してよいか。動いている fleet の bucket の copy が戻せる状態かどうか。celld の最小の memory 要件。Amazon Linux 2023 の systemd の版（v252 の man page を読みましたが、instance では確かめていません）。Cloudflare 側の Durable Objects の保証や料金は調べていません。22章はこの章の執筆時点で未完成で、内容を読めていません。

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
