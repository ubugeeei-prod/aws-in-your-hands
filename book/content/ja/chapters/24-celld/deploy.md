---
title: "24 Self-hosting: デプロイ"
---

# 24 Self-hosting: デプロイ

## まず 1 台で動かす

<!-- section: 24.one-node -->

このページの手順は、どれも実行していません。順番に意味があるので、理由と一緒に書きます。

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

1 行目は 23章と同じで、プライベートサブネットのインスタンスが Systems Manager に届くためのエンドポイントを足します。4 行目の `celld:status` では、ユーザーデータの処理が終わり、データボリュームがマウントされたことを確かめます。

`celld:artifacts` がアーカイブをバケットに置き、`celld:install` が[しくみと実装](/ja/chapters/24-celld/build.md)のページで見たインストールのスクリプトを各ノードで動かします。この時点では、celld はまだ起動していません。

`celld:app-deploy` は、この章でただ 1 つ、手元のマシンで celld のバイナリを動かす手順です。公式の counter の example を、`celld deploy` で fleet のバケットに書き込みます。この操作には、手元の認証情報で fleet のバケットに書ける権限が必要です。公式が「バケットの認証情報を持つ者が fleet を支配する」と書いていたとおり、この権限は fleet の管理者の権限にあたります。

`celld:start` でノードが起動します。celld は起動のたびに、バケットが条件付きの書き込みを本当に守るかを自分で試験します。この試験は無効にできません。

うまくいけば、`celld:smoke` が `{"ok":true}` と、`{"n":1,...}`、`{"n":2,...}` を表示します。counter は、リクエストのたびに 1 を足して返すだけの Durable Object です。`celld:diagnose` は、バケットの試験の結果と、生きているノードの一覧を表示します。

<<< @/examples/24-celld/src/remote.ts{commands}

1 台だけの fleet について、公式は 2 つのことを書いています。まず、書き込みは毎回バケットへの往復を待つので遅くなります。同じリージョンのストアで 90 ms ほど、という目安が載っています。次に、その 1 台が止まっている間は、cell を引き継ぐ相手がいません。[23章で見た単一障害点](/ja/chapters/23-ec2/wrap.md)の話が、そのまま当てはまります。

## fleet にして、1 台ずつ入れ替える

<!-- section: 24.rollout -->

ノードを増やすには、`nodes` の数字を変えてデプロイします。

```bash
vp run celld:infra:diff -c nodes=3
vp run celld:infra:deploy -c nodes=3
vp run celld:install
vp run celld:start
vp run celld:diagnose
```

fleet に参加させるコマンドはありません。同じバケットを指して起動したノードは、バケットのリースでお互いを見つけます。2 台になった時点で、書き込みはフォロワーのディスクに載れば応答を返せるようになります。3 台ならフォロワーは 2 台です。

この節で扱うのは、動いている fleet のノードを入れ替える手順です。

公式の手順は短く、ノードを SIGTERM で止め、代わりのノードが healthy になるのを待ってから、次のノードへ進みます。待つ間の目安も書かれていて、`celld diagnose` がすべてのノードについて `restoring=0` を返すまでは次を止めるな、とあります。

ノードを止めるときは、`systemctl stop` が SIGTERM を送ります。celld は health の応答を 503 にして、受け付け済みのリクエストを終わらせ、cell をピアに引き渡してから終了します。

```bash
vp run celld:drain a
```

この停止を 1 台ずつ、確認を挟みながら繰り返すのがローリングアップデートです。手作業では、確認を 1 回飛ばしただけで、2 台が同時に落ちている時間ができてしまいます。そこで、順番は関数にしました。

<<< @/examples/24-celld/src/rollout.ts{rolling}

この関数は AWS も celld も直接には知らず、`FleetOps` の 6 つの操作だけを使います。

<<< @/examples/24-celld/src/rollout.ts{ops}

本物の `FleetOps` は Run Command を送ります。テストの `FleetOps` は、呼ばれた操作を配列に記録するだけの代役です。`wait` も記録するだけなので、テストは実際の時間を待ちません。08章と同じやり方で、決まった場所に失敗を差し込みます。

- 2 台目の drain、install、start のそれぞれで失敗させる。関数はそこで止まり、3 台目には触らない
- 再起動したノードが、いつまでも `restoring` を終えない。関数は決めた回数で諦めて止まり、次のノードは動いたままになる
- 再起動したノードが、古いバイナリで起動してきた。関数は待たずに止まる
- 最初から 1 台落ちている。関数は何も触らない

どの場合でも、同時に落ちているノードが最大 1 台であることを確かめています。

次のノードへ進んでよいかどうかは、次の関数が判定します。

<<< @/examples/24-celld/src/health.ts{settled}

読めない出力は「まだ進めない」と扱います。celld の運用者向けのインターフェースは alpha で、リリースごとに変わりうる、と公式が書いているからです。出力の形が変わると、この関数は「進むな」と答え続けます。黙って先へ進むより、止まるほうが安全なので、そうしてあります。

### ローリングアップデートにできない版の組み合わせ

ローリングアップデートの間は、古い版と新しい版が同時に動きます。それが許されるかどうかは、版の組み合わせによって決まります。

<<< @/examples/24-celld/src/celld.ts{upgrade-notes}

この表は、公式の upgrade notes を写したものです。たとえば v0.5.1 から v0.6.0 への更新は、全部のノードを止めてから行います。v0.6.0 のノードは、v0.5.1 のフォロワーがいると起動を拒みます。v0.3.0 から v0.4.0 では、混ぜると commit 済みの値が読めなくなることがある、と書かれています。

`celld:rollout` は、いま動いている版と目標の版でこの表を引きます。表に無い組み合わせ（版を 1 つ飛ばす更新、downgrade、この章より新しい版）は「不明」として止まり、推測でローリングアップデートにはしません。その場合は、公式の notes を読み、表に足してから、もう一度実行してください。

全部のノードを止めてから更新する組み合わせでは、手順が変わります。

```bash
vp run celld:stop-all
vp run celld:backup
vp run celld:rollout v0.6.2 --stopped
```

全部のノードを止め、リースが切れるのを待ち、バックアップを取り、全部のノードに新しいバイナリを入れてから起動します。古いノードが 1 台でも動いていたら、`--stopped` を付けた rollout は何もしません。

練習するなら、v0.6.1 で fleet を作り（`vp run celld:fetch v0.6.1 --host`、`vp run celld:artifacts v0.6.1`、`vp run celld:install v0.6.1`）、`vp run celld:artifacts`、`vp run celld:rollout v0.6.2` の順に実行して v0.6.2 に上げてみてください。アプリケーションをデプロイする手元のバイナリも、fleet と同じ版に揃えます。公式も、運用者の道具と celld のリリースは揃えておくよう書いています。

## ノードを 1 台失う

<!-- section: 24.loss -->

drain は、ノードに後始末をさせてから止める方法でした。この節では、後始末をさせずにノードを止めます。

そのために、celld の約束を、クライアントから見える形に言い直します。counter はリクエストのたびに 1 を足して、新しい値を返します。したがって、ある cell に順番にリクエストを送り続けるクライアントから見て、次のことが成り立つはずです。

> 応答をもらった値は、後から小さくならない。そして、リクエストを送った回数より多くは進まない。

前半が破れたら、応答済みの書き込みが消えています。後半が破れたら、1 つのリクエストが 2 回実行されたか、別の書き手がいます。

扱いが難しいのは、タイムアウト、503、壊れたボディのように、応答が返ってこなかったリクエストです。実行されたのかどうかがクライアントには分からないので、どちらの場合もありうるものとして数えます。

<<< @/examples/24-celld/src/ledger.ts{invariant}

次の図は、検査の流れを時間の順に示したものです。

```figure
caption: witness が書き込みを続けるあいだに victim を止め、probe が終わってから、残った全部のノードで読み直して判定する
type: sequence
actor witness: witness node
actor victim: victim node
actor survivors: 残ったノードすべて
actor judge: judge
step witness -> witness: probe: 各 cell に 1 request
note witness: 何周も繰り返す
note victim: stop-instances
note victim: --skip-os-shutdown
note witness: probe DONE
step survivors -> survivors: sweep: 各 cell を読み直す
note judge: 応答済みの値は戻らない
note judge: request のないステップはない
note judge: 障害の後に
note judge: 全部の cell で応答
```

残すほうのノード（witness）で、クライアント役のスクリプトを動かします。少し書き込ませてから、別のノード（victim）を `aws ec2 stop-instances --skip-os-shutdown` で止めます。OS の shutdown を飛ばすので、celld は SIGTERM を受け取れず、cell の引き渡しもできません。スクリプトで起こせる範囲では、マシンを失う状況にいちばん近い止め方です。インスタンスもボリュームも消えないので、後で起動し直せます。

<<< @/examples/24-celld/scripts/fleet.ts{loss-check}

probe が終わったら、残ったノードの 1 台 1 台から、全部の cell をもう一度読みます。図で sweep と書いたこの読み直しが、持ち主が 1 台だけであることの検査です。もし 2 台がそれぞれ自分を持ち主だと思っていたら、リクエストを送るノードを変えたときに値が食い違います。celld 自身の試験も、cell を別々のノード経由で読む方法を使っています。

クライアント役のスクリプトは次のとおりです。

<<< @/examples/24-celld/src/probe.ts{script}

```bash
vp run celld:loss-check b
vp run celld:revive b
```

**この検査を、celld の実物に対して実行したことはありません。** テストで判定に掛けているのは、`test/toy-fleet.ts` という、この章のために書いた作り物の fleet です。celld のプロトコルを再現したものではありません。この作り物にはわざと壊した変種があり、判定がそれを見つけられることを確かめています。

- 書き込みが残る前に応答を返す fleet。ノードを失うと値が戻るので、見つかる
- 古い持ち主が、交代に気づかず応答を続ける fleet。リクエストを送るノードを変えて読むと食い違うので、見つかる。1 台からしか読まないと見つからないことも、テストにしてあります
- リクエストを 2 回実行する fleet。見つかる
- 何も壊れていない fleet。応答が 1 つ消えても、違反にはならない

celld の持ち主の記録（ownership record）そのものを読む検査は、作っていません。記録の形式は公開されたインターフェースではなく、ソースの内部にしか無いからです。この検査が確かめるのは、クライアントから見える結果だけです。

また、この検査が「守られた」と答えても、それは今回送ったリクエストと、今回起こした 1 つの障害についての結果にすぎません。celld が正しいことの証明にはなりません。「判定できない」という結果もあります。障害の後に一度も応答しなかった cell があると、その cell の書き込みが残っているかどうかが分からないからです。

## バックアップとリストア

<!-- section: 24.backup -->

celld に、バックアップのコマンドはありません。公式文書に出てくる手順は 1 つだけで、v0.4.1 からの更新の説明の中にあります。全部のノードを止め、リースが切れるのを待ってから、バケットとノードのデータを両方バックアップします。戻すときは、そのバックアップをまるごと戻します。バックアップより後の書き込みは失われます。

ノードのデータも一緒に取るのは、[しくみと実装](/ja/chapters/24-celld/build.md)のページで見たとおり、バケットにまだ無い応答済みの書き込みが、ディスクにあるかもしれないからです。

```bash
vp run celld:stop-all
vp run celld:backup
vp run celld:start
```

`celld:backup` は、動いているノードが 1 台でもあれば何もしません。全部が止まっていることを確かめると、ノードごとにデータボリュームのスナップショットを取り、fleet のプレフィックスをバックアップ用のバケットにコピーして、どのスナップショットがどのノードのものかをマニフェストに書きます。

fleet を動かしたまま取るバックアップは、用意していません。動いている fleet のバケットをコピーしたものが戻せる状態である、という保証を、公式文書のどこにも見つけられなかったからです。[22章](/ja/chapters/22-recovery.md)の PITR は DynamoDB のテーブルを、バージョニングはバケットのオブジェクトを 1 つずつ、前の状態に戻す道具でした。22章で見たとおり、別々に戻した置き場所は食い違います。celld の状態はバケットと複数のディスクにまたがっているので、バケットだけを戻しても、揃った状態にはなりません。

リストアは、いまあるものを消す操作です。そのため、既定は dry-run にしました。

<<< @/examples/24-celld/src/backup.ts{restore}

```bash
vp run celld:stop-all
vp run celld:restore 20261012T010203Z
vp run celld:restore 20261012T010203Z --yes
```

`--yes` を付けない `celld:restore` は、何が上書きされ、何が消えるかを表示するだけです。`--yes` を付けると、fleet のプレフィックスをバックアップと同じ内容に戻し、続けて、ノードごとのボリュームをスナップショットから作り直すデプロイのコマンドを表示します。バケットとディスクは、必ず両方戻します。バックアップに含まれるノードと、いまの fleet のノードが一致しないときは、リストアは始まりません。

ボリュームの作り直しは、23章で見たとおり、cdkd が「状態を持つリソースの置き換え」として扱い、`--force-stateful-recreation` を求めます。古いボリュームは `retain` の設定で残るので、後で自分で消します。

この一連の手順は、通しで動かしていません。特に、`aws s3 sync` でコピーしたバケットと、スナップショットから戻したディスクで celld が問題なく起動するかどうかは、最初に確かめるべき項目です。戻せることを確かめていないバックアップは、まだバックアップとは呼べません。
