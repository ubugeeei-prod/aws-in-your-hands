---
title: "24 Self-hosting: デプロイ"
---

# 24 Self-hosting: デプロイ

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

```figure
caption: witness が書き込みを続けるあいだに victim を止め、probe が終わってから、残った全部の node で読み直して判定する
type: sequence
actor witness: witness node
actor victim: victim node
actor survivors: 残った node すべて
actor judge: judge
step witness -> witness: probe: 各 cell に 1 request
note witness: 何周も繰り返す
note victim: stop-instances
note victim: --skip-os-shutdown
note witness: probe DONE
step survivors -> survivors: sweep: 各 cell を読み直す
note judge: 応答済みの値は戻らない
note judge: request のない step はない
note judge: 障害の後に
note judge: 全部の cell で応答
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

動かしたままの backup は、用意していません。動いている fleet の bucket を copy したものが、戻せる状態である保証を、公式文書のどこにも見つけられなかったからです。[22章](/ja/chapters/22-recovery.md)の PITR は DynamoDB の table を、versioning は bucket の object を 1 つずつ、前の状態に戻す道具です。あの章で見たとおり、別々に戻した置き場所は食い違います。celld の状態は bucket と複数の disk にまたがっているので、bucket だけを戻しても、揃った状態にはなりません。

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
