---
title: "12 Containers: ECR、ECS/Fargate、ALB"
revision: 1
---

# 12 Containers: ECR、ECS/Fargate、ALB

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

```figure
caption: Application Load Balancer が 2 つの zone の task へリクエストを配る。security group が通すのはその通信だけで、VPC、subnet、route table は 11章の stack AihNetwork から Fn::ImportValue で読む
node client: Client | curl, あとで SPA
node alb: Application Load Balancer | Public1 + Public2, zone ごとに node と public IPv4 が 1 つ
node tg: target group | target type: ip, 10 秒ごとに GET /health
node t1: task | zone 1a, 既定で Public1
node t2: task | zone 1c, 既定で Public2
node ecr: ECR repository | image tag は immutable
node logs: CloudWatch Logs | 7 日保持
edge client -> alb: HTTP :80, 証明書なし (ドメイン名が無い)
edge alb -> tg: listener :80
edge tg -> t1: HTTP :8080
edge tg -> t2
edge t1 -> ecr: HTTPS :443
edge t2 -> ecr
edge t1 -> logs
edge t2 -> logs: HTTPS :443
group svc: ECS service on Fargate: desired count 2, auto scaling 2..4 (CPU 60 %) = t1, t2
```

```figure
caption: task 1 つの中では、container が Map にノートを持ち、execution role が image の取得と log の書き込みを受け持つ
node srv: container "api" | node server.mjs
node exec: execution role | image を pull, log stream に書く
node role: task role | 権限なし
node app: Hono app
node svc: NoteService
node map: Map | task ごとに 1 つ
edge srv -> app
edge app -> svc
edge svc -> map
group t: task: 0.25 vCPU, 0.5 GB, arm64, network interface 1 つ = srv, exec, role, app, svc, map
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
