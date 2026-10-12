---
title: "24 Self-hosting: しくみと実装"
---

# 24 Self-hosting: しくみと実装

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
