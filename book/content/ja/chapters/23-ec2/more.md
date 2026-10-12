---
title: "23 VM: 実装のつづき"
---

# 23 VM: 実装のつづき

## プロセスを service にする

<!-- section: 23.service -->

`node server.mjs` と打てば API は動きます。でも、session を閉じたら止まります。落ちても誰も起こしてくれません。再起動したら、もう一度打つ人が要ります。

それを引き受けるのが systemd です。Linux で最初に起動して、ほかのプロセスの面倒を見るプログラムで、「何を、誰として、どう動かして、落ちたらどうするか」を unit というファイルで伝えます。

<<< @/examples/23-ec2/deploy/notes.service

上から読んでいきましょう。

`RequiresMountsFor` と `AssertPathIsMountPoint` は、data volume が mount されていなければ起動しない、という指定です。これが無いと怖いことが起きます。volume の用意に失敗したまま API が立ち上がると、ノートは root volume の同じ path に書かれます。動いているように見えて、instance を作り直した日に全部消えます。

`ConditionPathExists` は、アプリの本体がまだ無ければ、黙って起動を見送る指定です。最初の release の前は、これが普通の状態です。

`User=notes` で、root ではなく専用の user として動かします。`ProtectSystem=strict` は、このプロセスからファイルシステム全体を読み取り専用に見せる指定で、`ReadWritePaths` に書いた data volume だけが例外です。API に穴があっても、書き換えられる場所がそこしかありません。

`Restart=on-failure` は、異常終了したら 2 秒後に起こし直す指定です。ただ、起動するたびに落ちるプロセスを永遠に起こし続けても意味がないので、`StartLimitBurst` で、1 分に 5 回落ちたら諦めるようにしています。諦めた service は `failed` という状態で残るので、見ればわかります。

`ExecStart` の `/usr/bin/node-24` は、Amazon Linux 2023 の `nodejs24` という package が入れる、版の名前が付いた実行ファイルです。ただの `node` は別の版を指すように切り替えられるので、使っていません。

環境変数は unit に直接書かず、`EnvironmentFile` で別のファイルから読みます。その中の `HOST=127.0.0.1` が、API を instance の中だけに閉じ込めています。security group を誰かが開けてしまっても、外からは届きません。

なお、ここに書いた directive の意味は systemd 252 の man page で確かめたものです。Amazon Linux 2023 が積んでいる版は、instance の上では見ていません。

### ログはどこへ行く？

04章のアプリは、ログを標準出力に JSON で書きます。systemd の下では、それが journald という仕組みに溜まります。Amazon Linux 2023 には、昔ながらの `/var/log/messages` はありません。

```bash
vp run ec2:logs
```

Run Command で `journalctl --unit notes.service` を実行して、最後の 50 行を持ってくるタスクです。

Lambda のときと違うのは、このログが instance の root volume にあることです。instance が消えれば、ログも消えます。落ちた理由を知りたいときに限って、ログが無い。それを避けるには、ログを外に出します。CloudWatch agent を入れると journald の内容を CloudWatch Logs に送れますが、private subnet からは `logs` の interface endpoint がもう 1 つ要って、月に USD 20.44 増えます。role にも権限が要ります。この章では入れていません。練習の machine には過剰で、本番の machine には必須、という種類のものです。

## 止めるときの作法

<!-- section: 23.shutdown -->

service は、止められることがあります。release のたびに再起動しますし、OS の再起動もあります。そのとき systemd は、プロセスに SIGTERM という signal を送ります。「止まってください」というお願いです。

何もしなければ、Node.js はその場で終了します。処理の途中だったリクエストは、応答をもらえないまま切られます。ノートを保存している最中だったら、呼んだ側には、保存されたのかどうかもわかりません。

<<< @/examples/23-ec2/src/shutdown.ts{shutdown}

お願いされたら、新しい接続を断って、処理中のリクエストを最後までやって、書き込みが disk に届くのを待って、それから終わる。これが graceful shutdown です。

```figure
caption: SIGTERM を受けた process は、新しい接続を断り、処理中の request と書き込みを終えてから終わる
type: sequence
actor systemd: systemd
actor proc: notes process
actor client: client
step systemd -> proc: t0: systemctl restart, SIGTERM
step proc -> proc: t1: listening socket を閉じる
step client -x proc: 新しい接続は拒否
step proc --> client: t2: t0 より前の request に 201
step proc -> proc: t3: 待っていた書き込みを flush
step proc -> proc: t4: exit 0
step systemd -> proc: t5: 新しい process を起動
note proc: また listen する
step client -> proc: 接続を受け付ける
```

```figure
caption: 待つ限度は 2 つあり、process が自分で終わる 20 秒が、systemd の 30 秒より先に来る
type: sequence
actor systemd: systemd
actor proc: notes process
actor client: client
step systemd -> proc: t0: SIGTERM
note proc: 20 s たっても t2 が来ない
step proc -x client: 残りの接続を閉じる
step proc -> proc: exit 1
note systemd: 30 s たっても process がいる
step systemd -> proc: SIGKILL (TimeoutStopSec)
```

待つのにも限度があります。20 秒たっても終わらないリクエストは、こちらから切ります。systemd は 30 秒（unit の `TimeoutStopSec`）で SIGKILL を送ってきて、こちらは抵抗できません。その前に、自分で決着をつけるわけです。テストは、この 2 つの数字の大小を見張っています。片方だけ変えると落ちます。

組み立てているのは、ここです。

<<< @/examples/23-ec2/src/server.ts{server}

`createApp` は 04章のものを、そのまま import しています。アプリは 1 行も変えていません。変わったのは周りです。`Map` のかわりにファイル、関数のかわりに居座るプロセス、そして signal の受け口。

テストは、本物の socket を開いて確かめています。リクエストを送り、処理の途中で止めておき、shutdown を呼ぶ。新しい接続が断られることを見てから、止めていた処理を進める。最初のリクエストに 201 が返り、そのあとで書き込みを待って、exit code 0 で終わる。この順序を固定しています。

図の t1 から t5 の間は、誰も待ち受けていません。数秒のことですが、その間に来たリクエストは失敗します。machine が 1 台なら、再起動は必ず停止です。これをなくすには、2 つ目のプロセスと、その前に立つ load balancer が要ります（[12章](/ja/chapters/12-containers.md)）。

## データは別の volume に

<!-- section: 23.data -->

04章では、ノートは `Map` の中にありました。実行環境が入れ替わると消える、という話をしましたね。今度はプロセスが 1 つで、ずっと動いています。なので、ノートをファイルに書くことにします。

<<< @/examples/23-ec2/src/file-notes.ts{repository}

04章の `NoteRepository` という interface を、そのまま実装しています。

守りたいことを 1 文で書くと、こうです。**201 を返したノートは、プロセスが再起動しても、instance が作り直されても、読める。**

これを壊しに来るのは、書いている途中の停止です。ファイルを半分だけ書いたところで電源が落ちると、JSON として読めないファイルが残ります。次に起動したとき、ノートが 1 件も読めません。

<<< @/examples/23-ec2/src/file-notes.ts{storage}

なので、ファイルを直接は上書きしません。隣に新しいファイルを書いて、disk に届いたことを確かめてから、名前を付け替えます。名前の付け替えは、「された」か「されていない」かのどちらかです。読む側が見るのは、古い中身か、新しい中身か。混ざったものは見えません。

テストは、この手順の 3 か所（書き込み、付け替え、directory の同期）で、順に電源を落とします。どこで落ちても、残ったファイルは丸ごと読めて、メモリの中身と一致します。壊れたファイルを見つけたときは、空として起動せず、起動を拒否します。空で起動すると、次の書き込みで、壊れたファイルを空のファイルで上書きしてしまうからです。

正直なところも書いておきます。逆は成り立ちません。付け替えのあと、directory の同期で失敗すると、呼んだ側には 500 が返るのに、ノートは保存されています。「失敗と言われたのに、ある」です。呼んだ側が再試行すれば、同じノートが 2 件できます。04章の API には、重複を防ぐ仕組みがありません。それと、このクラスが正しいのは、プロセスが 1 つのときだけです。同じファイルを 2 つのプロセスが開けば、後から書いたほうが、もう片方の書き込みを消します。1 つであることを保証しているのは、コードではなく systemd です。

本物の disk に対しては、こう実装しています。

<<< @/examples/23-ec2/src/node-files.ts{node-files}

### そのファイルは、どの disk にある？

instance の disk は EBS volume です。ネットワーク越しにつながった disk で、instance とは別のリソースとして存在できます。

instance には root volume が 1 つ付いてきます。OS が入っている disk で、AMI から作られ、instance を消すと一緒に消えます。ここにノートを置くと、「AMI を選ぶ」で見たとおり、deploy 1 回で消えることがあります。

なので、もう 1 つ volume を作ります。

<<< @/examples/23-ec2/infra/lib/ec2-stack.ts{data-volume}

instance の設定の中に書くのではなく、独立したリソースにしているのがポイントです。instance が置き換えられても、この volume は消えません。EC2 の既定でも、起動のあとに付けた volume は、instance を消しても残ります。

では、いつ消えるのか。stack を消したときです。それを決めるのが `dataOnDestroy` で、既定は `delete` です。練習用なので、stack と一緒に消えて、何も残りません。本番なら `snapshot`（消す前に snapshot を取る）か `retain`（volume を残す）にします。どちらも、残ったものには料金がかかり続けます。

volume は 1 つの AZ に属します。同じ AZ の instance にしか付けられません。コードでも、instance と同じ AZ を渡しています。instance を別の AZ に移したくなったら、volume は付いて来られません。snapshot を取って、移った先の AZ に復元することになります。

### 空の volume を、一度だけ format する

新しい volume は、まっさらです。ファイルシステムを作って、mount する必要があります。

<<< @/examples/23-ec2/deploy/notes-data-volume.sh

この script で、いちばん大事なのは `case` のところです。`mkfs` は volume の中身を消します。中身のある volume に対して走らせたら、ノートは全部なくなります。そして、この script が動くのは、新しい instance の最初の起動のときです。つまり、instance を作り直して、古い volume を付け直したときにも動きます。

なので、format するのは、ファイルシステムが無いと確かめられたときだけ。あると言われたら触らない。わからないときも触らず、失敗して止まります。

テストは、この script を bash で本当に実行しています。disk に触るコマンド（`blkid`、`mkfs.xfs`、`mount` など）だけを、呼ばれたことを記録する偽物に差し替えてあります。そして、1 台目の instance で format し、2 台目の instance（fstab は新品、volume は同じ）でもう一度走らせて、`mkfs` が 1 回しか呼ばれていないことを確かめます。

ほかにも細かい工夫があります。volume が instance に付くのは起動の後なので、device が現れるまで最大 5 分待ちます。`/etc/fstab` には device 名ではなく UUID で書きます。いまの instance では、EBS volume は NVMe の device として見えて、名前が起動のたびに入れ替わることがあるからです。`nofail` は、volume が無くても OS は起動する、という指定です。無いと、volume を外した instance が起動しなくなって、中に入って直すこともできなくなります。
