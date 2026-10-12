---
title: "12 コンテナを動かす: ECR、ECS/Fargate、ALB"
revision: 1
---

# 12 コンテナを動かす: ECR、ECS/Fargate、ALB

11章でネットワークができました。この章では、その上に初めて「ずっと動いているもの」を置きます。

04章のノート API を、Node.js の HTTP サーバーとしてコンテナにして、ECS on Fargate で 2 つ動かし、Application Load Balancer（ALB）の後ろに並べます。そのうえで、止めずに新しい版へ入れ替えるところまでやります。

先にお金の話を。ここまでの章の多くは「誰も呼ばなければ 0」でしたが、この章は違います。**service を動かしている間は、誰も呼ばなくても 1 時間におよそ USD 0.069、1 日で USD 1.65、1 か月置くと USD 50.33 かかります**（東京、既定の構成、内訳は「お金の話」に）。ALB と、task 2 つと、public IPv4 アドレス 4 つのぶんです。試し終わったら、その日のうちに「片付け」まで進んでくださいね。

前提は [11章](/ja/chapters/11-network.md)の VPC と、[04章](/ja/chapters/04-http-api.md)のアプリです。コードは `examples/12-containers/` にあります。

## コンテナにするのはいつ？

<!-- section: 12.when -->

04章の Lambda は、呼ばれたときだけ動いて、使われなければ料金は 0 でした。それで足りているなら、コンテナに移る理由はありません。これは先に言っておきます。

コンテナを選ぶのは、Lambda の形に収まらないときです。

- 1 回の処理が長い。Lambda は 1 回の呼び出しが最大 15 分で、API Gateway の HTTP API はその手前の 30 秒で待つのをやめます
- 接続を張りっぱなしにしたい。WebSocket や、データベースへの接続を使い回す pool（[13章](/ja/chapters/13-sql.md)）のように、リクエストをまたいでプロセスが生きている前提のもの
- 手持ちのサーバーをそのまま動かしたい。すでにコンテナ image になっているアプリ、Node.js 以外の言語や OS のパッケージに依存するもの
- 呼び出しが途切れない。ずっと忙しいなら、「呼ばれた時間だけ課金」より「置いてある時間で課金」のほうが安くなる点がどこかにあります（どこかは、あなたの負荷次第です。この本では計算していません）

ちなみに、「コンテナ image で配りたい」だけなら Lambda でもできます。Lambda は image から関数を作れて、その image の置き場所もこの章と同じ ECR です。image にすることと、常駐させることは、別の選択なんです。

引き換えに手放すものも、はっきりしています。使っていない間の 0。そして「何個動かすか」「どう入れ替えるか」「止めるときにどうするか」を、自分で決めることになります。この章の後半は、ほぼその話です。

## 全体像

<!-- section: 12.architecture -->

```text
Client (curl, later the SPA)
  |  HTTP :80           no certificate: this chapter has no domain name
  v
Application Load Balancer     in Public1 + Public2; one node and one public IPv4 address per zone
  |  listener :80 -> target group (target type: ip)
  |  health check: GET /health every 10 s
  |  HTTP :8080         security group: load balancer -> tasks, and nothing else
  v
ECS service on Fargate        desired count 2; auto scaling 2..4 on 60 % CPU
  |  task (zone 1a)           task (zone 1c)
  |  0.25 vCPU, 0.5 GB, arm64; one network interface each; in Public1 / Public2 by default
  |  container "api": node server.mjs -> Hono app -> NoteService -> Map (one per task)
  |  execution role: pull the image, write the log stream      task role: nothing
  |
  +--> ECR repository         HTTPS :443 out; image tags are immutable
  +--> CloudWatch Logs        HTTPS :443 out; kept 7 days

VPC, subnets, route tables: chapter 11 (stack AihNetwork), read through Fn::ImportValue
```

言葉がいくつか出てきます。

**image** は、アプリと、それが動くのに要るファイル一式を固めたもの。**ECR**（Elastic Container Registry）は、その置き場所です。

**task definition** は「どの image を、どれだけの CPU とメモリで、どの role で動かすか」の設計書。そこから起動された、動いている実体が **task** です。**service** は「この task を常に 2 つ動かしておく」という指示と、それを守り続ける仕組み。task が落ちれば補充し、task definition が変われば入れ替えます。

**Fargate** は、その task を動かすサーバーを AWS に任せる方式です。EC2 の instance を自分で並べる方式もありますが、この章では扱いません。task の大きさと動かした時間だけを考えれば済むほうを選びました。

**ALB** は HTTP の入口で、後ろの task にリクエストを振り分けます。振り分け先の一覧が **target group** です。

大きさと数は、ここで決めています。

<<< @/examples/12-containers/src/config.ts{size}

256 は「CPU ユニット」という単位で、1024 が 1 vCPU。Fargate で選べる組み合わせのうち、0.25 vCPU と 512 MiB を使っています。

1 つ、04章から変わっていないことがあります。ノートはまだメモリの中です。task が 2 つあれば `Map` も 2 つあって、ALB は既定で順番に振り分けるので、作ったノートが 2 回に 1 回しか見えない、ということが起きます。しかも task は更新のたびに入れ替わるので、そのたびに全部消えます。04章で Lambda の実行環境について見たのと同じ話が、もっとはっきり見えるだけです。データを task の外に出すのは [05章](/ja/chapters/05-dynamodb.md)や[13章](/ja/chapters/13-sql.md)の仕事で、この章は「入れ物」のほうに集中します。

## docker は 2 つのプログラム

<!-- section: 12.docker -->

コンテナの話に入る前に、つまずきやすい点を 1 つ片付けておきます。

`docker` と打って動くコマンドは、client です。実際に image を build したりコンテナを動かしたりするのは、**daemon**（`dockerd`）という別の常駐プログラムで、client はそこへ頼みごとを送るだけ。2 つは別のマシンにあっても構いません。

これが効いてくるのは、次の場面です。

- `docker` コマンドがあるのに `failed to connect to the docker API ... check if the path is correct and if the daemon is running` と言われる。client はあるが、daemon が動いていない（この文面は、この章を書いたマシンの Docker CLI 29.7.2 が実際に出したものです）
- `docker` コマンドを入れただけでは何も動かない。daemon を用意するのは、Docker Desktop や Colima のような別のソフトウェア

この本の devShell（Nix）には、client も daemon も入っていません。image を build する手順（`ecs:image:build`、`ecs:image:run`、`ecs:image:push`）だけは、Docker Desktop などを別に起動しておく必要があります。

逆に言うと、それ以外は全部 Docker なしで進められるようにしてあります。サーバーの起動も、テストも、image に入れるファイルの確認も、CDK の synth もです。

正直に言うと、この章を書いている間、手元で daemon が動いていませんでした。なので image は一度も build できていません。Dockerfile と `docker` のコマンドは一次情報と help を見て書いたもので、動かして確かめたものではない、という前提で読んでください。

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

## role は 2 つ

<!-- section: 12.roles -->

04章の Lambda には、実行 role が 1 つありました。ECS の task には 2 つあります。名前が紛らわしいので、ここで整理します。

<<< @/examples/12-containers/infra/lib/containers-stack.ts{roles}

**task execution role** は、あなたのコードが動き出す**前**に、ECS の agent が使います。image を ECR から取る。ログの stream を開く。それだけです。コンテナの中のコードからは使えません。

**task role** は、コンテナの中のコードが AWS を呼ぶときに使います。Lambda の実行 role に当たるのは、こちらです。

04章と並べると、こうなります。

| | Lambda（04章） | ECS の task |
| --- | --- | --- |
| コードが AWS を呼ぶ権限 | 実行 role | task role |
| コードの取得とログの送信 | Lambda 自身がやる（ログは実行 role の権限で書く） | task execution role |

このアプリは AWS を 1 つも呼ばないので、task role は空です。05章の table につなぐなら、`table.grantReadWriteData(taskRole)` と書きます。execution role に付けても、アプリからは使えません。逆に、execution role の権限を task role に付けると、アプリが要らない権限を持つことになります。

execution role の中身は、CDK が組み立てています。`ecs.ContainerImage.fromEcrRepository` がこの repository からの pull を、`ecs.LogDrivers.awsLogs` がこの log group への書き込みを足します。

<<< @/examples/12-containers/infra/lib/containers-stack.ts{task}

テストは、policy が execution role にしか付いていないこと、許可が 6 つの操作ちょうどであることを見ています。1 つだけ、`ecr:GetAuthorizationToken` の対象が `*` になります。04章から続けてきた「`*` を使わない」の例外で、この操作は repository を指定できないためです。stack の中の `*` がこれ 1 つであることも、テストで固定しました。

`readonlyRootFilesystem` は、コンテナのファイルシステムを読み取り専用にします。このアプリはディスクに何も書かないので、誰にも書かせない、というだけです。

## service と ALB

<!-- section: 12.service -->

<<< @/examples/12-containers/infra/lib/containers-stack.ts{service}

<<< @/examples/12-containers/infra/lib/containers-stack.ts{load-balancer}

listener は HTTP の 80 番だけです。HTTPS には証明書が要り、証明書にはドメイン名が要ります。この章はドメイン名を持っていないので、通信は暗号化されません。06章の token のような、見られて困るものを流さないでください。

### health check

ALB は、target group に登録された task に、決まった間隔で `GET /health` を送ります。失敗が続いた task には、リクエストを送らなくなります。

既定の間隔は 30 秒ですが、10 秒にしました。新しく登録された task は、**1 回**成功すれば健全と見なされます（`healthyThresholdCount` の 2 は、不健全になった task が復帰するときの回数です）。逆に、2 回続けて失敗すると外されるので、壊れた task にリクエストが届く時間は、長くて 20 秒ほどになります。

知っておきたいのは、全部の task が不健全になったときの挙動です。ALB は「送り先がない」とはせず、全部の task に送ります（fail open）。health check が厳しすぎて全滅するくらいなら、動いているかもしれない task に送るほうがまし、という判断です。

### 時間の関係

この章には、互いに関係し合う「秒数」がたくさん出てきます。ばらばらに書くとずれるので、1 か所にまとめました。サーバーも stack も、ここを読みます。

<<< @/examples/12-containers/src/timing.ts{timing}

ずれると何が起きるかも、関数にしてあります。

<<< @/examples/12-containers/src/timing.ts{rules}

1 つ目が、さっきの 65 秒の話です。ALB は、task との接続を使い回して、60 秒使わなかったら閉じます。Node.js のサーバーは、既定では 5 秒で閉じます。サーバーのほうが先に閉じると、ALB が「まだ使える」と思っている接続にリクエストを流して、行き場のないリクエストが 502 になります。AWS のドキュメントも、アプリ側の時間を ALB より長くするように勧めています。なので 65 秒。

<<< @/examples/12-containers/test/timing.test.ts{broken}

型は、この関係を守ってくれません。`serverKeepAlive: 5` も `number` です。テストは、いまの値の組み合わせに問題がないことと、1 つ崩すと何が報告されるかを見ています。stack のテストは、template に入った値が、この表の値と同じであることを見ています。

## 更新中に起きること

<!-- section: 12.rollout -->

`-c imageTag=v2` を付けて deploy すると、task definition が新しくなり、service が task を入れ替え始めます。これが rolling update です。

```text
desired count 2, minimumHealthyPercent 100, maximumPercent 200

step  old tasks (v1)   new tasks (v2)                    who answers
1     2 running        -                                 v1 v1
2     2 running        up to 2 starting (pull, boot)     v1 v1
3     2 running        running, first health check ok    v1 v1 v2 v2    <- both versions answer
4     2 draining       2 running                         v2 v2          (v1 finishes what is in flight)
5     stopped          2 running                         v2 v2

if the new tasks never get past step 3:
3'    2 running        fail to start or to pass the health check, 3 times
4'    2 running        circuit breaker: deployment FAILED, rolled back to the last COMPLETED one
```

`minimumHealthyPercent: 100` は「健全な task を、2 つより減らさない」。`maximumPercent: 200` は「入れ替えの間、4 つまで動かしていい」。この 2 つで、古い task を止める前に新しい task を起動する、という順序が決まります。50 と 100 にすれば、先に 1 つ止めてから 1 つ起動する形になって、余分な task は要らないかわりに、途中の処理能力が半分になります。

**deployment circuit breaker** は、3' と 4' のためのものです。新しい task が起動できない、あるいは health check に通らないことが続くと、更新を失敗と判定します。何回で諦めるかは、task の数の半分（最低 3、最高 200）。task 2 つなら 3 回です。`rollback: true` にしてあるので、最後に成功した状態へ自動で戻します。

有効にしていないと、更新は失敗と判定されないまま続きます。

1 つ、できないことを覚えておいてください。circuit breaker が見るのは、task が起動したかと、health check に通ったかです。`/health` には 200 を返すのに `/notes` が 500 になる、という壊れ方は見つけられません。次の節で、まさにそれを起こします。

### task が止まるとき

4 の「draining」の中身を、もう少し細かく見ます。

```text
time     ECS and the load balancer                           the server in the task
t0       ECS decides to stop the task
         task: DEACTIVATING    target: draining
         no new requests go to this target                   still answers what is in flight
t0+?     the target has no connections left, or 30 s passed  (deregistrationDelay = 30)
t1       task: STOPPING    ECS sends SIGTERM  -------------> logs "draining"; stops listening
                                                             closes idle keep-alive connections
                                                             finishes what is still in flight
                                                             logs "stopped"; exits with 0
t1+25                                                        deadline: cuts the rest; exits with 1
t1+30    ECS sends SIGKILL if the process is still there     (stopTimeout = 30)
```

先に ALB から外して、それから SIGTERM。この順序のおかげで、SIGTERM が届く頃には、新しいリクエストはもう来ていないはずです。

**deregistration delay** は、ALB が「外す」と決めた task について、進行中のリクエストが終わるのを待つ時間です。既定は 300 秒。task を 1 つ止めるたびに最大 5 分待つことになるので、30 秒に縮めました。このアプリのリクエストは長くても 10 秒、という前提です。ファイルの upload や streaming のような長いリクエストがあるなら、縮めすぎると途中で切れます。

「じゃあ graceful shutdown は要らないのでは？」と思うかもしれません。要ります。deregistration delay より長いリクエストは残りますし、さっき見たとおり、keep-alive の接続を片付けないとプロセスが終われません。ALB を通らない仕事（[08章](/ja/chapters/08-async.md)の、queue の処理など）には、そもそも前半がありません。

正直に言うと、この順序は、ECS のドキュメントが書いている task の状態の並び（DEACTIVATING で登録解除、そのあと STOPPING で SIGTERM）から読み取ったものです。実際に動かして、ログの時刻で確かめてはいません。確かめるためのタスクは用意してあります。

```bash
vp run ecs:watch
```

`/health` を 1 秒に 1 回呼んで、どの版が答えたかを表示し続けます。別のターミナルで動かしたまま deploy すれば、v1 と v2 が混ざる時間と、エラーが 1 件も出ないこと（出ないはず、です）が見えます。

## 新旧が同時に動く

<!-- section: 12.versions -->

さっきの図の 3 行目に戻ります。v1 と v2 が、同時に応答している時間があります。数十秒かもしれないし、task が多ければ数分かもしれない。rollback が起きれば、v2 が書いたものを v1 が読む時間も来ます。

task の外にデータがあるなら、それを両方の版が読み書きします。

この章の invariant を 1 文で書くと、こうです。**「同時に動いているどの版も、同時に動いているどの版が書いた record でも読める」。**

具体的にやってみます。v2 で、ノートに `pinned` という項目を足すとしましょう。

<<< @/examples/12-containers/src/compat.ts{formats}

`v1` と `v2` は、うまくいく組み合わせです。v1 は知らない項目を黙って捨て、v2 は無い項目を既定値で埋めます。

`v2Required` と `v1Strict` は、どちらも「きちんとしている」ように見えて、更新を壊す書き方です。

テストでは、task の外にあるデータの代わりを用意しました。

<<< @/examples/12-containers/src/compat.ts{store}

保存してあるのは JSON の文字列で、それぞれの task は、自分の版の schema を通して読み書きします。DynamoDB の item でも、SQL の行でも、キューのメッセージでも、起きることは同じです。

そして、本物の HTTP サーバーを 2 つ、同時に立てます。

<<< @/examples/12-containers/test/versions.test.ts{rollout}

```text
records (outlive every task)       task running v1                 task running v2
t1  POST /notes -> v1              writes {id,title,body,createdAt}
t2  POST /notes -> v2                                              writes {..., pinned:false}
t3  GET  /notes -> v1              reads both; drops "pinned"
t4  GET  /notes -> v2                                              reads both; fills pinned=false
t5  rollback: v2 stops             still reads what v2 wrote
```

壊れるほうの 2 つは、こう壊れます。

**新しい版が、古い record に無い項目を必須にした（`v2Required`）。** v2 の task に届いた `GET /notes` が 500 になります。v1 の task に届いたものは成功するので、利用者から見ると「2 回に 1 回失敗する」。そして `/health` は 200 のままです。ALB も circuit breaker も気づきません。テストは、health check が通ることと一覧が失敗することを、並べて確かめています。

**古い版が、知らない項目を拒否する（`v1Strict`）。** v2 が 1 件書いた瞬間から、v1 の task が読めなくなります。慌てて rollback しても直りません。v2 のコードは消えますが、v2 が書いた record は残るからです。

ここから、順序の決まりが出てきます。

- 項目を**足す**ときは、任意の項目として足し、読む側で既定値を埋める。古い版は、知らない項目を無視できるようにしておく
- 項目を**必須にする**のは、それを書かない版がどこにも動いていなくなり、古い record も埋め終わってから。足すのと必須にするのは、別の deploy にする
- 項目を**消す・名前を変える**のは、1 回ではやらない。新しい名前を足す、両方を書く、読む側を切り替える、古いほうを消す、と分ける

この決まりは、ECS に限った話ではありません。止めずに入れ替える仕組みなら、どこでも新旧が同居する時間があります。task を 2 つ並べて、順に入れ替えるようになって、それが目に見えるようになっただけです。

1 つ断っておくと、このサンプルを deploy しても、task どうしが共有するデータはありません（ノートはまだメモリの中です）。deploy した環境で新旧が同時に触るのは、いまのところ利用者だけ。`ecs:watch` で見える `x-app-version` の入れ替わりが、それです。テストが使っている `SharedRecords` は、05章や 13章のデータストアにつないだときに起きることを、手元で先に見るためのものです。

## task を増やす、減らす

<!-- section: 12.scaling -->

<<< @/examples/12-containers/infra/lib/containers-stack.ts{scaling}

**target tracking** という方式です。「service 全体の平均 CPU 使用率を 60% に保つ」とだけ決めて、task の数の増減は任せます。エアコンの設定温度みたいなものですね。

指標は、よく使われるものが 2 つあります。

**CPU 使用率。** このサンプルで使っているほうです。計算で忙しくなるアプリに向きます。Node.js は 1 つのスレッドでリクエストをさばくので、0.25 vCPU の task は CPU を使い切るとすぐ待ち行列ができます。早めに増やしたくて、目標を 60% にしました。

**target あたりのリクエスト数**（`ALBRequestCountPerTarget`）。ALB が数えた、task 1 つあたりのリクエスト数です。データベースや外部の API を待っている時間が長いアプリは、忙しくても CPU は暇なままなので、こちらのほうが実態に合います。このサンプルには入れていません。「task 1 つが何件さばけるか」を測らないと、目標の値を決められないからです。

両方付けることもできます。その場合、どちらか 1 つでも「増やす」と言えば増え、全部が「減らしていい」と言ったときだけ減ります。増やすのは速く、減らすのは慎重に、という作りです。

上限の 4 は、料金の上限でもあります。task が 1 つ増えると、public subnet なら月 USD 12.65。4 つで張り付くと、この stack の固定費は月 USD 75.62 になります。上限を決めずに auto scaling を付けるのは、上限のない請求を受け入れるのと同じです。

scale in で task が減るときも、止まり方は更新のときと同じです。ALB から外され、SIGTERM が届き、`stopTimeout` で SIGKILL。graceful shutdown が、ここでも効きます。ちなみに deploy が進んでいる間は、scale in は止まります（scale out は止まりません）。

正直に言うと、auto scaling は負荷をかけて試していません。template に入ることを確かめただけです。

## 手元で確かめる

<!-- section: 12.local -->

ここまで出てきたもののうち、Docker も AWS も要らないものをまとめます。

```bash
vp run test:unit
vp run ecs:bundle:check
vp run ecs:infra:synth
vp run ecs:infra:synth -c imageTag=v1
```

テストは 4 か所を見ています。

| どこ | ファイル | 見ているもの | 見ていないもの |
| --- | --- | --- | --- |
| プロセス | `test/shutdown.test.ts` | SIGTERM で進行中のリクエストを終えてから終了すること | コンテナの中での signal の届き方、ECS が送る順序 |
| 版の同居 | `test/versions.test.ts` | 新旧が同じ record を読めること、壊れる 2 つの書き方 | 本物のデータストア、ALB の振り分け |
| 設定と時間 | `test/timing.test.ts`、`test/config.test.ts`、`test/compose.test.ts` | 秒数どうしの関係、tag の検証、`docker` コマンドの組み立て | その値で実際に 502 が出ないこと |
| インフラ | `infra/test/containers-stack.test.ts` | 権限、入口、入れ替えの設定、tag なしなら時間課金のリソースが無いこと | AWS が template どおりに動くこと |

手元で再現しないものも、はっきりさせておきます。

- image の build と、コンテナとしての起動
- Fargate が image を取得できるかどうか（経路と権限）
- ALB の振り分けと health check
- rolling update、circuit breaker、auto scaling の実際の動き
- cdkd が template のとおりにリソースを作れること

cdkd については、固定した版（0.296.28）のソースを読みました。この stack が使う 15 種類のうち 12 種類（ECS の cluster、task definition、service、ALB、listener、target group、ECR の repository、security group とその ingress、IAM の role と policy、log group）は、cdkd が専用の実装を持っています。残りの 3 種類、`AWS::ApplicationAutoScaling::ScalableTarget`、`AWS::ApplicationAutoScaling::ScalingPolicy`、`AWS::EC2::SecurityGroupEgress` は、Cloud Control API 経由です。テストは、種類の一覧と、専用の実装が扱う property だけを使っていることを固定しています。

## デプロイする

<!-- section: 12.deploy -->

ここからは時間課金が始まります。順番が大事なので、1 つずつ。

まず 11章の VPC。既定の構成で、これは無料です。

```bash
vp run net:infra:deploy
```

次に、tag なしで deploy します。repository だけができます。

```bash
vp run ecs:infra:deploy
```

image を作って、push します。Docker の daemon が要るのはここです。

```bash
vp run ecs:bundle
vp run ecs:image:build v1
vp run ecs:image:push v1
```

`ecs:image:push` は、stack の output から repository の URI を読み、`aws ecr get-login-password` の出力を `docker login` に標準入力で渡してから、tag を付けて push します。login の有効期間は 12 時間です。

そして、tag を付けて deploy。**ここから課金されます。**

```bash
vp run ecs:infra:diff -c imageTag=v1
vp run ecs:infra:deploy -c imageTag=v1
```

この本の deploy タスクは cdkd に `--full-wait` を渡しているので、service が安定するまで待ちます。cdkd のドキュメントによると、ALB が使えるようになるまでに 90〜180 秒、service の待ち時間は上限 600 秒です。終わると `ServiceUrl` に `http://xxxx.ap-northeast-1.elb.amazonaws.com` の形の URL が出ます。

```bash
curl -si http://xxxx.ap-northeast-1.elb.amazonaws.com/health
vp run ecs:watch
vp run ecs:logs
```

`x-app-version: v1` が返ってくれば、image の中のサーバーまで届いています。

次は、止めずに入れ替えます。`ecs:watch` を別のターミナルで動かしたまま、どうぞ。

```bash
vp run ecs:image:build v2
vp run ecs:image:push v2
vp run ecs:infra:deploy -c imageTag=v2
```

気をつけたいのは、11章と同じで、`-c` はその 1 回のコマンドにしか効かないことです。`-c imageTag=...` を付け忘れて deploy すると、ALB と task は消える変更として現れます。止め方としては便利ですが、うっかりやると止まります。`diff` にも同じ `-c` を付けて、先に見てください。

drift の検査は、02章と同じです。

```bash
vp run ecs:infra:drift
```

正直に言うと、この節のコマンドは、まだ実際の AWS で通せていません。11章が「12章を書くときに最初に通す場所」と書いた、別のアプリの stack から `Fn::ImportValue` で VPC を読む経路も、未確認のままです。もう 1 つ、わかっていないことがあります。task definition が変わると、cdkd は新しい revision を登録し、service を更新して、古い revision を登録解除します。circuit breaker が rollback したとき、`--full-wait` の待ちが成功と失敗のどちらを報告するのかは、ソースからは読み取れませんでした。rollback 先の revision は、cdkd の手順の中で登録解除される側です。壊れた image を deploy したあとは、cdkd の表示だけで判断せず、`aws ecs describe-services` で `rolloutState` を見てください。

## お金の話

<!-- section: 12.cost -->

金額は USD、東京リージョン、従量課金、税別、1 か月は 730 時間です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

まず、置いてあるだけでかかるぶん。既定の構成です。

| 対象 | 数量 | 単価 | 月額 |
| --- | --- | --- | --- |
| Fargate の vCPU（arm64） | task 2 × 0.25 vCPU × 730 時間 | 0.04045／vCPU 時 | 14.76 |
| Fargate のメモリ（arm64） | task 2 × 0.5 GB × 730 時間 | 0.00442／GB 時 | 3.23 |
| ALB | 730 時間 | 0.0243／時 | 17.74 |
| public IPv4 アドレス | （ALB 2 + task 2）× 730 時間 | 0.005／時 | 14.60 |
| 小計 | | | **50.33** |

1 日なら USD 1.65 です。これに、repository に置いた image の保存料金が乗ります（1 GB あたり月 USD 0.10。image 1 つを 0.1 GB と仮定して USD 0.01）。

表から読み取れることが 3 つあります。

**何もしていなくても、Lambda の章のおよそ 25 倍。** 04章は、月 100 万リクエストで USD 2.02 でした。こちらは 0 リクエストで USD 50.33。コンテナを選ぶなら、この固定費に見合う理由が要ります。

**public IPv4 アドレスが、Fargate と同じくらいかかっている。** 4 つで月 USD 14.60。ALB は AZ ごとに node を持ち、それぞれが 1 つずつ使います。task のぶんは、private subnet に移せば消えますが、そのかわりに NAT Gateway か endpoint の料金が乗ります。

**arm64 にしておくと 2 割安い。** 同じ大きさの task 1 つが、arm64 で月 USD 9.00、x86 で USD 11.25 です。

呼ばれると、こうなります。月 100 万リクエスト、task は 2 つのまま、という仮定です。

| 対象 | 数量 | 定価 |
| --- | --- | --- |
| 置いてあるだけのぶん（上の表と image） | | 50.34 |
| ALB の LCU | 11.1 LCU 時間 | 0.09 |
| CloudWatch Logs の取り込み | 0.191 GB | 0.15 |
| CloudWatch Logs の保存 | 0.045 GB 月 | 0.00 |
| インターネットへのデータ転送 | 0.477 GB | 0.05 |
| 小計 | | **50.63** |

CloudWatch Logs の毎月の無料枠（5 GB）を引くと USD 50.48 です。100 万リクエスト増えても、増えるのは USD 0.29。固定費がほとんどです。

LCU は、ALB が仕事量に応じて課金する単位で、新規の接続数、同時の接続数、通したデータ量、規則の評価数のうち、いちばん大きいものが数えられます。ここでは 1 リクエスト 1 接続として、新規の接続数で計算しました。リクエストが無いときの LCU（health check が数えられるのかどうか）は確認できていないので、最初の表には入れていません。0 という意味ではなく、未算入です。

task の置き場所を変えると、こうです。

| 構成 | この章の stack | 11章の側 | 合計 |
| --- | --- | --- | --- |
| 既定（public subnet） | 50.33 | 0 | 50.34 |
| `-c taskSubnets=private` と NAT Gateway 1 つ | 43.03 | 48.91 | 92.07 |
| `-c taskSubnets=private` と interface endpoint 3 つ | 43.03 | 61.32 | 104.37 |

合計には、image の保存（USD 0.01）と、NAT Gateway を通るデータを月 2 GB、endpoint を通るデータを月 1 GB とした仮定のぶんが入っています。

無料枠について。Fargate の料金ページに、無料枠の記述は見つかりませんでした。ALB と ECR には新規の利用者向けの枠が書かれていますが、すべてのアカウントに当てはまるものではないので、引いていません。

tag なしで deploy し直して repository だけにすれば、時間課金は止まり、残るのは image の保存料金だけです。

時間で課金されるものの数え方は、コードにしてあります。

<<< @/examples/12-containers/src/cost.ts{billable}

テストは、この関数が出す時間数が料金データのシナリオと一致することと、ここに書いた金額が計算結果と一致することを見ています。

## Cloudflare から来た人へ

<!-- section: 12.cloudflare -->

Cloudflare にも Containers があります。ドキュメントを読んだ範囲で、違いを並べます（使って確かめたわけではありません）。

| | Cloudflare Containers | この章（ECS on Fargate と ALB） |
| --- | --- | --- |
| 入口 | Worker。コンテナには Durable Object を通してだけ届く | ALB。HTTP を直接 task へ振り分ける |
| 起動 | リクエストが来たとき、または Worker のコードが起動したとき。使われなければ sleep する | service が決めた数を常に動かす |
| 料金 | 動いている間だけ、10 ms 単位。Workers Paid プランに含まれる枠がある | 置いてある時間。使われなくても同じ |
| 数の調整 | Worker のコードで決める。stateless なアプリ向けの組み込みの autoscaling は、いまは無い | target tracking に任せられる |
| 入れ替え | 既定で 10%、100% の 2 段階。止めるときは SIGTERM、15 分後に SIGKILL | rolling update。SIGTERM のあと最大 120 秒 |
| ネットワーク | 設計するものが無い | VPC、subnet、security group を自分で決める |
| 手元 | `wrangler dev`。Docker 互換の CLI と engine が要る | このサンプルは Node.js で直接動かす。image の build にだけ Docker が要る |

いちばん大きな違いは、使っていない間です。Cloudflare のコンテナは sleep して、料金が止まります。そのかわり、止まった状態からの起動（cold start）があって、ドキュメントは多くの場合 1〜3 秒としています。ECS の service は止まらないので、待たされません。そのかわり、使われていない時間にも料金がかかります。

もう 1 つ。Cloudflare では、コンテナの手前に必ず Worker と Durable Object がいて、振り分けや起動をコードで書きます。ECS では、その役を ALB と service の設定が担います。どちらが合うかは、作るもの次第です。

SIGTERM を受けて、進行中の仕事を終えてから止まる、という作法は、どちらでも同じです。更新中に新旧が同居するのも同じで、Cloudflare のドキュメントも、新しい Worker のコードが古い image のコンテナに届きうる、と書いています。この章の後半は、そのまま持っていけます。

## ハマりどころ

| こうなったら | ここを見る |
| --- | --- |
| `dev:ecs` が `Invalid environment` で止まる | `examples/12-containers/.env` はありますか。メッセージに出た変数名を確認 |
| `ecs:image:build` が `No Docker daemon answered` で止まる | client だけあって daemon が動いていません。Docker Desktop などを起動する |
| push が `ImageTagAlreadyExistsException` で失敗する | その tag はもう使われています。tag は immutable なので、新しい tag を付ける |
| deploy が service のところで長く止まり、失敗する | task が起動できていません。`aws ecs list-tasks --desired-status STOPPED` と `aws ecs describe-tasks` で `stoppedReason` を見る。image を取れない（tag の打ち間違い、private subnet なのに経路がない）ことが多い |
| task は動いているのに、ALB の URL がエラーを返す | `aws elbv2 describe-target-health` で、target が健全かどうかを見る。`/health` が 200 を返すか、8080 番が security group で許されているか |
| ときどき 502 が返る | サーバーの keep-alive が ALB の idle timeout より短くなっていませんか。`src/timing.ts` の関係を確認 |
| 更新のたびに、数件のリクエストが失敗する | SIGTERM を受けていない（`CMD` を配列で書いたか）、または deregistration delay より長いリクエストがある |
| 作ったノートが、呼ぶたびに出たり消えたりする | task が 2 つあって、それぞれが自分の `Map` を持っています。この章の仕様です |
| `net:infra:destroy` が `StackHasActiveImportsError` で止まる | この章の stack が VPC を使っています。先に `ecs:infra:destroy` |
| 使っていないのに請求がある | service が動いています。tag なしで deploy し直すか、destroy する |

最初の 2 行以外は、ドキュメントの記述から組み立てたもので、実際に起こして確かめたわけではありません。

## 本番にするなら

- **HTTPS にする。** ドメイン名と証明書を用意して、listener を 443 番にします。いまは平文です
- **認証と認可を足す。** 04章と同じで、URL を知っている人は誰でも呼べます（06章）
- **データを task の外に置く。** いまは更新のたびに消えます（05章、13章）。そのとき、「新旧が同時に動く」の決まりが本物の制約になります
- **task を private subnet に置く。** 出口を NAT にするか endpoint にするかは、11章の表で決めます
- **秘密は環境変数に直接書かない。** task definition の `secrets` で、Secrets Manager などから起動時に渡します。読む権限は execution role に付けます（secret の扱いは [21章](/ja/chapters/21-security.md)。あちらは Lambda の例です）
- **アプリの指標でも更新を止める。** circuit breaker は起動と health check しか見ません。ECS には、CloudWatch のアラームで更新を失敗にする仕組みもあります（アラームの組み立て方は [19章](/ja/chapters/19-observability.md)）
- **base image を digest で固定する。** `node:24-bookworm-slim` という tag は、中身が更新されていきます。いつ build しても同じ image にしたいなら、digest で指定します
- **AZ を 3 つにして、task も 3 つ以上にする。** 2 つだと、片方の AZ が止まった瞬間に処理能力が半分になります
- **ログの保持期間、ALB の削除保護、repository の `emptyOnDelete` を見直す。** どれも、練習用に「消しやすい」ほうへ倒してあります
- **反映の経路を AWS CDK CLI と CloudFormation にする。** cdkd の公式ドキュメントは、cdkd を開発・テスト用途向けとし、本番には AWS CDK CLI を勧めています（02章）

## 片付け

<!-- section: 12.cleanup -->

時間課金だけ止めて、image は残しておくなら、tag なしで deploy し直します。

```bash
vp run ecs:infra:diff
vp run ecs:infra:deploy
```

`diff` で、ALB、service、task definition などが消える変更として出て、repository が残ることを確かめてから実行してください。

全部消すなら、こちらです。

```bash
vp run ecs:infra:destroy
vp run net:infra:destroy
```

順番はこのとおりに。VPC を使っている stack が残っていると、11章の destroy は拒否されます。

repository は、中の image ごと消えます（`emptyOnDelete`）。log group も一緒です。stack の外に残るリソースは無いようにしてあって、テストも、残す設定がどのリソースにも付いていないことを見ています。

最後は、自分の目で確かめるのが確実です。

```bash
aws elbv2 describe-load-balancers --region ap-northeast-1
aws ecs list-clusters --region ap-northeast-1
aws ecr describe-repositories --region ap-northeast-1
```

1 つ目にこの章の load balancer が無く、2 つ目に cluster が無ければ、この章のぶんの時間課金は止まっています。3 つ目には、02章の `cdkd bootstrap` が作った repository だけが残っているはずです。

手元の daemon には、build した image が残ります。`docker image rm aih-notes:v1` で消せます。

::: details この章の検証メモ

**手元で確かめたこと。** サーバーを子プロセスとして起動し、リクエストの途中で SIGTERM を送るテスト。graceful shutdown のテスト（`sweep` を外すと `drained` が `forced` になって落ちることも確認）。新旧 2 つの版を同時に立てるテスト。時間の関係、設定、`docker` コマンドの組み立て、料金、stack の assertion のユニットテスト。型検査。`ecs:infra:synth`（tag なし、`-c imageTag=v1`、`-c imageTag=v1 -c taskSubnets=private`。`-c imageTag=latest` が拒否されることも）。`ecs:bundle` と `ecs:bundle:check`。`dev:ecs` を起動して、本文の `curl` と、Ctrl-C のときのログを確認。`ecs:image:build`、`ecs:image:run`、`ecs:image:push` の `--dry-run` と、daemon なしで実行したときのメッセージ。`ecs:watch` を `--url` で手元のサーバーに向けて実行。`ecs.ContainerImage.fromAsset` を使った synth が、`docker` コマンドの無い PATH で通ること（aws-cdk-lib 2.273.0）。`docker` の flag は、Docker CLI 29.7.2 の help で確かめました。本文の金額は、Price List の単価から `tools/src/pricing/calc.ts` が計算した値で、`examples/12-containers/test/pricing.test.ts` が照合しています。

**まだ確かめていないこと。** Docker の daemon が動いていなかったため、image を一度も build していません。したがって、Dockerfile が通ること、`.dockerignore` の例外指定が効くこと、arm64 の base image で起動すること、`--read-only` で動くこと、image の大きさ（料金の表の 0.1 GB は仮定）は未確認です。`ecs:infra:diff`、`ecs:infra:deploy`、`ecs:image:push`、`ecs:watch`、`ecs:logs`、`ecs:infra:drift`、`ecs:infra:destroy` は、実際の AWS では動かしていません。次はすべて実環境での確認待ちです。cdkd 0.296.28 がこの stack を作って消せること。別のアプリの stack から `Fn::ImportValue` で 11章の VPC を読めること。Cloud Control API 経由の 3 種類が通ること。public subnet の task が image を取得できること、443 番だけの egress で足りること。`-c taskSubnets=private` の 2 通りの経路。ALB の health check と fail open。rolling update の間にエラーが出ないこと。target の登録解除のあとに SIGTERM が届くという順序。circuit breaker の rollback と、そのときの cdkd の表示。auto scaling の増減。tag なしで deploy し直すと ALB と task だけが消えること。「ハマりどころ」の症状。

一次情報で確かめられなかったこと。リクエストが無いときの ALB の LCU。ECS と Application Auto Scaling の service-linked role が、そのアカウントでの最初の deploy で自動的に作られるかどうか。auto scaling が動いている service を deploy し直したとき、task の数が `desiredCount` の 2 に戻るかどうか。ALB が負荷に応じて node を増やしたときの public IPv4 アドレスの数。Docker Hub の `node:24-bookworm-slim` に arm64 版があることは、API の応答の先頭（amd64 の項目）しか読んでおらず、確かめていません。Cloudflare Containers は、ドキュメントを読んだだけです。

cdkd が扱うリソースの種類。`v0.296.28` タグの `src/provisioning/register-providers.ts` では、`AWS::ECS::Cluster`、`TaskDefinition`、`Service`（ECS の provider）、`AWS::ElasticLoadBalancingV2::LoadBalancer`、`TargetGroup`、`Listener`（ELBv2 の provider）、`AWS::ECR::Repository`、`AWS::EC2::SecurityGroup`、`SecurityGroupIngress`、`AWS::IAM::Role`、`Policy`、`AWS::Logs::LogGroup` が専用の実装に登録されています。`AWS::ApplicationAutoScaling::ScalableTarget`、`ScalingPolicy`、`AWS::EC2::SecurityGroupEgress` は登録が無く、未対応の一覧にも無いので、Cloud Control API 経由です。ECS の provider は、task definition の変更を置き換え（新しい revision の登録と、古い revision の登録解除）として扱い、service は既定では `CreateService`／`UpdateService` が受け付けられた時点で戻り、`--full-wait` のときだけ安定するまで待ちます。ECR の provider は、`EmptyOnDelete` が true のときに限って、image ごと repository を消します。npm の tarball には TypeScript のソースが入っていないため、GitHub のタグの archive を読みました。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 全体像 | `examples/12-containers/infra/lib/containers-stack.ts`、`src/config.ts` | `ecs:infra:synth` |
| docker は 2 つのプログラム | `examples/12-containers/src/image.ts`、`scripts/image.ts` | `ecs:image:build` |
| handler から、ずっと動くサーバーへ | `examples/12-containers/src/compose.ts`、`src/env.ts`、`src/server.ts`、`test/compose.test.ts`、`.env.example` | `dev:ecs`、`test:unit` |
| 止められ方を決める | `examples/12-containers/src/serve.ts`、`src/server.ts`、`test/shutdown.test.ts` | `test:unit` |
| image を作る | `examples/12-containers/Dockerfile`、`.dockerignore`、`scripts/bundle.ts`、`scripts/check-bundle.ts`、`src/image.ts` | `ecs:bundle`、`ecs:bundle:check`、`ecs:image:build`、`ecs:image:run` |
| image の置き場所 | `examples/12-containers/infra/lib/containers-stack.ts`、`infra/bin/app.ts`、`src/config.ts`、`test/config.test.ts` | `ecs:infra:synth`、`ecs:image:push`、`test:unit` |
| task はどの subnet に住む？ | `examples/12-containers/infra/lib/containers-stack.ts`、`infra/test/containers-stack.test.ts`、`examples/11-network/infra/lib/import-network.ts` | `test:unit`、`net:plan` |
| role は 2 つ | `examples/12-containers/infra/lib/containers-stack.ts`、`infra/test/containers-stack.test.ts` | `test:unit` |
| service と ALB | `examples/12-containers/infra/lib/containers-stack.ts`、`src/timing.ts`、`test/timing.test.ts` | `test:unit`、`ecs:infra:synth` |
| 更新中に起きること | `examples/12-containers/infra/lib/containers-stack.ts`、`src/timing.ts`、`scripts/watch.ts`、`src/watch.ts` | `ecs:watch` |
| 新旧が同時に動く | `examples/12-containers/src/compat.ts`、`test/versions.test.ts` | `test:unit` |
| task を増やす、減らす | `examples/12-containers/infra/lib/containers-stack.ts`、`src/config.ts` | `test:unit` |
| 手元で確かめる | `examples/12-containers/test/`、`infra/test/containers-stack.test.ts`、`scripts/check-bundle.ts` | `test:unit`、`ecs:bundle:check`、`ecs:infra:synth`、`dev:ecs` |
| デプロイする | `examples/12-containers/infra/bin/app.ts`、`cdk.json`、`scripts/image.ts`、`scripts/watch.ts`、`scripts/logs.ts`、`tools/src/infra/` | `ecs:infra:diff`、`ecs:infra:deploy`、`ecs:image:push`、`ecs:watch`、`ecs:logs`、`ecs:infra:drift` |
| お金の話 | `examples/12-containers/src/cost.ts`、`test/pricing.test.ts`、`data/pricing/` | `test:unit` |
| 片付け | `tools/src/infra/` | `ecs:infra:deploy`、`ecs:infra:destroy` |

**一次情報**（確認日はすべて 2026-10-12）

- [What is Amazon ECS?](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/Welcome.html)、[Amazon ECS task lifecycle](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-lifecycle-explanation.html)、[ContainerDefinition](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_ContainerDefinition.html)、[Best practices for Amazon ECS container images](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/container-considerations.html)、[Fargate task definition differences](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html)、[64-bit ARM workloads](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-arm64.html)
- [Deploy Amazon ECS services by replacing tasks](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-ecs.html)、[deployment circuit breaker](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-circuit-breaker.html)、[connection draining parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/load-balancer-connection-draining.html)、[load balancer health check parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/load-balancer-healthcheck.html)、[container health checks](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/healthcheck.html)、[AWS::ECS::Service](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecs-service.html)
- [Amazon ECS task IAM role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html)、[Amazon ECS task execution IAM role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html)
- [Automatically scale your Amazon ECS service](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-auto-scaling.html)、[Use a target metric to scale Amazon ECS services](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-autoscaling-targettracking.html)
- [Amazon ECS task networking options for Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html)、[Amazon ECR interface VPC endpoints](https://docs.aws.amazon.com/AmazonECR/latest/userguide/vpc-endpoints.html)（11章で 2026-10-11 に確認）、[Security groups](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html)
- [Health checks for Application Load Balancer target groups](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/target-group-health-checks.html)、[Edit target group attributes](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-target-group-attributes.html)、[Edit attributes for your Application Load Balancer](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-load-balancer-attributes.html)、[Application Load Balancers](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/application-load-balancers.html)
- [Pushing a Docker image to an Amazon ECR private repository](https://docs.aws.amazon.com/AmazonECR/latest/userguide/docker-push-ecr-image.html)、[Image tag mutability](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-tag-mutability.html)
- [AWS Fargate pricing](https://aws.amazon.com/fargate/pricing/)、[Elastic Load Balancing pricing](https://aws.amazon.com/elasticloadbalancing/pricing/)、[Amazon ECR pricing](https://aws.amazon.com/ecr/pricing/)
- AWS Price List bulk API: [ECS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/ap-northeast-1/index.json)（Fargate）、[ELB](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/current/ap-northeast-1/index.json)、[ECR](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECR/current/ap-northeast-1/index.json)。NAT Gateway、interface endpoint、public IPv4 アドレス、CloudWatch Logs、データ転送の単価は、11章までに取得したもの（2026-10-11 確認）
- [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)
- [What is Docker?](https://docs.docker.com/get-started/docker-overview/)、[Dockerfile reference](https://docs.docker.com/reference/dockerfile/)、[docker-node: Best Practices](https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md)、[Docker Hub: node:24-bookworm-slim](https://hub.docker.com/v2/repositories/library/node/tags/24-bookworm-slim)、[Node.js v24: HTTP](https://nodejs.org/docs/latest-v24.x/api/http.html)
- Cloudflare Containers: [Overview](https://developers.cloudflare.com/containers/)、[Pricing](https://developers.cloudflare.com/containers/platform/pricing/)、[Rollouts](https://developers.cloudflare.com/containers/configuration/rollouts/)、[Lifecycle of a container](https://developers.cloudflare.com/containers/concepts/architecture/)、[FAQ](https://developers.cloudflare.com/containers/faq/)、[Local development](https://developers.cloudflare.com/containers/guides/local-dev/)
- cdkd v0.296.28: [src/provisioning](https://github.com/go-to-k/cdkd/tree/v0.296.28/src/provisioning)、[docs/cli-deploy.md](https://github.com/go-to-k/cdkd/blob/v0.296.28/docs/cli-deploy.md)、[src/assets/docker-asset-publisher.ts](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/assets/docker-asset-publisher.ts)、[Introduction](https://cdkd.dev/introduction/)（2026-10-11 確認）
- [aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0)（`ecs.ContainerImage.fromAsset` の synth を実行して観察）

:::
