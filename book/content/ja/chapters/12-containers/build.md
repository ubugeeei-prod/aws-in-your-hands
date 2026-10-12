---
title: "12 Containers: しくみと実装"
---

# 12 Containers: しくみと実装

## handler から、ずっと動くサーバーへ

<!-- section: 12.server -->

04章のアプリは、最初から「必要なものを全部、引数でもらう」形で書いてありました。おかげで、アプリ本体には 1 行も手を入れずに済みます。

<<< @/examples/12-containers/src/compose.ts{compose}

`createApp` は 04章のものをそのまま import しています。足したのは、まわりの 2 つだけです。

<<< @/examples/12-containers/src/compose.ts{wrap}

`quietHealth` は、成功した health check をログに書かないための包み。ALB は 10 秒おきに、AZ ごとの node から、task ごとに `/health` を呼びます。全部書くと、ログのほとんどが health check になってしまうので。失敗したものは残します。

`withVersion` は、応答に `x-app-version` というヘッダーを足します。中身は image の tag。更新中は 2 つの版が同時に応答するので、「いま答えたのはどっち？」が見えるようにしておきたいんです。

環境変数は 2 つ増えました。

<<< @/examples/12-containers/src/env.ts{env}

そして、これが入口です。

<<< @/examples/12-containers/src/server.ts{main}

Lambda の handler との違いは、最後の `for` に出ています。Lambda では、関数がいつ止まるかを気にする場面がほとんどありませんでした。ずっと動くプロセスは、**止められ方を自分で決めます**。次の節でやります。

動かしてみましょう。`examples/12-containers/.env.example` を、同じ場所に `.env` という名前でコピーします。

<<< @/examples/12-containers/.env.example

```bash
vp run dev:ecs
```

```bash
curl -si http://localhost:8080/health
curl -s -X POST http://localhost:8080/notes -H 'content-type: application/json' -d '{"title":"first note"}'
curl -s http://localhost:8080/notes
```

1 つ目の応答に `x-app-version: dev` と `Keep-Alive: timeout=65` が付いているはずです。65 という数字の理由は、あとで出てきます。Ctrl-C で止めると、`draining`、`stopped` の 2 行がログに出てから終わります。

## 止められ方を決める

<!-- section: 12.shutdown -->

ECS は、task をしょっちゅう止めます。新しい版への入れ替え、scale in、health check の失敗。そのたびに、コンテナの中のプロセスへ **SIGTERM** という signal を送ります。「終わってほしい」というお願いです。そして `stopTimeout`（Fargate の既定は 30 秒、最大 120 秒）だけ待って、まだ動いていたら SIGKILL を送ります。こちらは断れません。

SIGTERM を受けたときの処理を何も書いていなければ、進行中のリクエストは守られません。プロセスがその場で終了すれば、応答をもらえないまま接続が切れます。コンテナの中でいちばん最初のプロセス（PID 1）として動いている Node.js は、処理を書いていない signal に反応しない、と Node.js の Docker image のドキュメントは書いています。その場合は 30 秒待たされたあと、SIGKILL で同じことになります。

やりたいのは、こうです。新しいリクエストは受けない。進行中のものは最後まで答える。それから終わる。これを graceful shutdown と呼びます。

<<< @/examples/12-containers/src/serve.ts{serve}

`server.close()` が、新しい接続を受けるのをやめて、進行中の応答が終わるのを待ってくれます。ECS のドキュメントに載っている Node.js の例も、この 1 行です。

ただ、それだけだと足りませんでした。ここ、実際に試してわかったところです。

ALB は、task との接続を使い回します（keep-alive）。`server.close()` は、呼ばれた瞬間に暇だった接続は閉じてくれますが、そのとき応答の途中だった接続は、応答が終わったあと「暇な接続」として残ります。相手が閉じるか、keep-alive の時間切れまで、サーバーは終われません。このサンプルは keep-alive を 65 秒にしているので、放っておくと `stopTimeout` の 30 秒のほうが先に来ます。

`sweep` は、そのためのものです。暇になった接続を、短い間隔で閉じ続けます。締め切り（25 秒）を過ぎたら残りを切って、`forced` と報告する保険も付けました。終了コードも、`drained` なら 0、`forced` なら 1 に分けています。

`maxConnections` は、止め方とは別の話です。task が同時に持つ接続を 512 本までにして、それを超えた接続は応答せずに閉じます。本文は 1 件 64 KiB までなので、受け取っている途中の本文は、多くても 32 MiB ほど。流量の制限ではなく、メモリの蓋です。いっぱいのあいだは ALB の health check も同じ枠を取り合うので、叩かれ続ければ task が不健全と判定されることもありえます。

テストは、本当にプロセスを起動して、SIGTERM を送ります。Docker は使いません。

<<< @/examples/12-containers/test/shutdown.test.ts{sigterm}

ちょっとした工夫が要りました。「リクエストの途中」という状態を、待ち時間に頼らずに作りたかったんです。そこで、`Expect: 100-continue` を付けてヘッダーだけ送ります。サーバーが `100 Continue` を返したら、リクエストは確かに届いていて、本文を待っている。その状態で SIGTERM を送り、`draining` のログを確認してから本文を送ります。応答が 201 で、ノートが返ってきて、それからプロセスが終了コード 0 で終わる。順序が決まっているので、何度走らせても同じ結果になります。

`sweep` を外してこのテストを走らせると、`drained` のはずが `forced` になって落ちます。さっきの話は、それで見つけました。

ほかに、暇な keep-alive 接続では待たされないこと、いつまでも終わらない処理は締め切りで切って `forced` になること、signal が 2 回来ても同じ 1 回の shutdown になることも、テストにしてあります。

## image を作る

<!-- section: 12.image -->

image に入れるのは、ファイル 1 つです。

<<< @/examples/12-containers/scripts/bundle.ts{bundle}

```bash
vp run ecs:bundle
vp run ecs:bundle:check
```

esbuild が、サーバーと、Hono や Zod などの依存を全部まとめて `dist/server.mjs` にします（書いた時点で 860 KiB ほど）。04章で `NodejsFunction` が synth のときにやっていたのと同じことを、自分でやっているだけです。

`ecs:bundle:check` は、そのファイルを `node_modules` の無い場所へコピーして起動し、`/health` を呼んで、SIGTERM で終了コード 0 になることを確かめます。image に入るのはこのファイルそのものなので、「コンテナの中で依存が見つからない」は、Docker を動かす前にここで見つかります。

Dockerfile はこうなりました。

<<< @/examples/12-containers/Dockerfile

短いですよね。理由を順に。

**multi-stage にしていません。** よく見る Dockerfile は、1 つ目の stage で依存を入れて build し、2 つ目の stage に成果物だけをコピーします。build の道具を最終的な image に残さないための書き方です。このサンプルは build を image の外で済ませているので、残すものがそもそもありません。外で build して困らないのは、道具の版を Nix と lockfile が固定していることと、成果物が純粋な JavaScript で、build したマシンの OS や CPU に依存しないことが理由です。ネイティブのモジュールを含む依存があるなら話は変わって、動かす環境と同じ OS・CPU の中で build する stage が要ります。

**root で動かしません。** `USER node` で、base image に最初から入っている権限のないユーザーに切り替えています。8080 番を使うのも、特権なしで待ち受けられる番号だからです。

**`HEALTHCHECK` を書いていません。** 書いても、ECS は image に埋め込まれた health check を見ません。見るのは task definition に書いたものだけです。そちらに書く手もありますが、コンテナの中から自分を呼ぶ確認より、ALB が外から、本物のリクエストと同じ経路で呼ぶ確認のほうが、知りたいことに近い。なので、ALB の health check だけにしました。

**`CMD` は配列で書きます。** `CMD node server.mjs` と書くと、`/bin/sh -c` が間に入って、SIGTERM は shell に届きます。shell は node へ伝えてくれないので、せっかくの graceful shutdown が動かず、30 秒後に SIGKILL です。

`.dockerignore` も置いてあります。build のとき daemon に送るのを `dist/server.mjs` だけにして、ソースや `.env` が image に紛れ込まないようにしています。

daemon が動いていれば、build して、手元で動かせます。

```bash
vp run ecs:image:build v1
vp run ecs:image:run v1
```

`--platform linux/arm64` を付けて build します。task definition が arm64 を指定しているからで、x86 のマシンで build するなら、daemon が arm64 の image を作れる設定になっている必要があります。コマンドだけ見たいときは、末尾に `--dry-run` を付けると、実行せずに表示します。

繰り返しになりますが、この 2 つは実行できていません。

## image の置き場所

<!-- section: 12.registry -->

build した image は手元の daemon の中にあるだけです。Fargate が取りに来られる場所、ECR の repository に置きます。

<<< @/examples/12-containers/infra/lib/containers-stack.ts{repository}

**tag は immutable にしました。** `v1` という tag が、あとから別の image を指すことはありません。同じ tag をもう一度 push すると、ECR が拒否します。「`v1` が動いている」が 1 つの意味しか持たなくなるので、入れ替えも巻き戻しも、何が起きるかを言い切れます。`latest` を使わないのも同じ理由で、設定の schema が弾きます。

<<< @/examples/12-containers/src/config.ts{schema}

lifecycle の規則は、新しいほうから 10 個を残して、古い image を消します。置きっぱなしの image にも保存料金がかかるので。

### なぜ 2 回に分けて deploy するのか

`return` に注目してください。`-c imageTag=...` を渡さないと、この stack は repository だけになります。

<<< @/examples/12-containers/infra/bin/app.ts{context}

service は、起動するとすぐ image を取りに行きます。repository が空のうちに service を作ると、task は起動に失敗し続けて、deploy は待ち時間の上限まで待ったあとで失敗します。なので、順番を分けました。

1. tag なしで deploy する。repository だけができる
2. image を build して push する
3. `-c imageTag=v1` を付けて deploy する。ここで初めて、ALB と task ができる

この形には、おまけがあります。tag なしでもう一度 deploy すると、ALB と task が消えて、repository と image だけが残ります。「時間課金だけ止めて、image は取っておく」ができるわけです。

### `ecs.ContainerImage.fromAsset` を使わなかった理由

CDK には、ディレクトリを渡すと build から push までやってくれる `ecs.ContainerImage.fromAsset` があります。便利ですが、使いませんでした。

調べたことを書いておきます。固定した版（aws-cdk-lib 2.273.0）で試したところ、`fromAsset` を使っても synth は Docker なしで通ります。synth がやるのは、ディレクトリを `cdk.out` にコピーして、「この image をこの repository に置く」という一覧を書くところまで。Docker が要るのは deploy のときです。cdkd（0.296.28）のソースを読むと、deploy の中で `docker build`、`docker tag`、`docker push` を実行し、置き場所は `cdkd bootstrap` が作る `cdkd-container-assets-<account>-<region>` という共用の repository になります。tag は内容の hash です。

つまり `fromAsset` だと、deploy のたびに daemon が要り、tag は自分で選べず、image は共用の repository に入ります。この章では、repository、login、push、tag を自分の手で一度通してほしかったので、分けました。本番で CI から deploy するなら、`fromAsset` や、CI が push した image の digest を渡す形のほうが楽なことも多いです。

## task はどの subnet に住む？

<!-- section: 12.network -->

11章の VPC を、名前で取りに行きます。`importNetwork` は 11章が用意した関数で、全部が `Fn::ImportValue` になるので、synth は AWS に問い合わせません。

さて、Fargate の task は、起動するときに ECR から image を取ってきます。ECR の入口は VPC の外です。11章の既定の構成だと、private subnet には外へ出る経路がありませんでした。道は 3 つあります。

| task の置き場所 | 11章に足すもの | 時間で課金されるもの（月額） |
| --- | --- | --- |
| public subnet、task に public IP | なし | task の public IPv4 アドレス 2 つ。USD 7.30 |
| private subnet | `-c egress=nat` | NAT Gateway と Elastic IP アドレス。USD 48.91 |
| private subnet | `-c interfaceEndpoints=ecr.api,ecr.dkr,logs` | interface endpoint 3 つ × 2 AZ。USD 61.32 |

3 つ目で endpoint が 3 つ要るのは、image の取得に `ecr.api` と `ecr.dkr`、ログの送信に `logs` を使うからです。image の中身（layer）は S3 から来ますが、そちらは 11章が既定で作っている gateway endpoint を通ります。

**既定は 1 つ目にしました。** 理由は料金です。練習用の構成に、置いてあるだけで月 USD 49 や USD 61 を足したくありません。

「task に public IP を付けて大丈夫？」と思いますよね。入ってくる通信を決めるのは、public IP の有無ではなく security group です。

<<< @/examples/12-containers/infra/lib/containers-stack.ts{firewall}

task の security group には、入ってくる向きの規則を 1 つも書いていません。あとで ALB につなぐときに、CDK が「ALB の security group から、8080 番」という規則を 1 つだけ足します。インターネットから task の public IP を直接叩いても、届きません。テストは、task への入口がその 1 つだけであることを見ています。

出ていく向きは 443 番だけ。ECR も S3 も CloudWatch Logs も HTTPS です。名前解決（DNS）は、security group が見ない通信なので、規則は要りません。

それでも、1 つ目は「簡易な構成」です。task ごとに public IPv4 アドレスを持つので、task が増えれば料金も増えます。組織によっては、アプリを public subnet に置くこと自体を禁じています。そういうときは切り替えます。

```bash
vp run ecs:infra:deploy -c imageTag=v1 -c taskSubnets=private
```

この場合、11章の側を先に NAT か endpoint つきで deploy しておいてください。していないと、task は image を取れずに起動に失敗し続けます。
