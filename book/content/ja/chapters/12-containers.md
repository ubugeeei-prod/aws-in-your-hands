---
title: "12 Containers: ECR、ECS/Fargate、ALB"
revision: 5
---

# 12 Containers: ECR、ECS/Fargate、ALB

11章で作ったネットワークの上に、この章で初めて、呼ばれていない間も動き続けるものを置きます。

04章のノート API を Node.js の HTTP サーバーとしてコンテナにし、ECS on Fargate で 2 つ動かして、Application Load Balancer（ALB）の後ろに並べます。そのうえで、サービスを止めずに新しい版へ入れ替えるところまで進めます。

ここまでの章の多くは、誰も呼ばなければ料金が 0 でしたが、この章は違います。**サービスを動かしている間は、誰も呼ばなくても 1 時間におよそ USD 0.069、1 日で USD 1.65、1 か月置くと USD 50.33 かかります**（東京、既定の構成。内訳は[料金](/ja/chapters/12-containers/wrap.md)にあります）。ALB と、タスク 2 つと、パブリック IPv4 アドレス 4 つの料金です。試し終わったら、その日のうちに[片付け](/ja/chapters/12-containers/wrap.md)まで進めてください。

前提は [11章](/ja/chapters/11-network.md)の VPC と、[04章](/ja/chapters/04-http-api.md)のアプリです。コードは `examples/12-containers/` にあります。

## コンテナを選ぶ場面

<!-- section: 12.when -->

04章の Lambda は呼ばれたときだけ動き、使われなければ料金は 0 でした。それで足りているなら、コンテナに移る理由はありません。

コンテナを選ぶのは、作るものが Lambda の形に収まらないときです。

- 1 回の処理が長い。Lambda は 1 回の呼び出しが最大 15 分で、API Gateway の HTTP API はその手前の 30 秒で待つのをやめます
- 接続を張ったままにしたい。WebSocket や、データベースへの接続を使い回すプール（[13章](/ja/chapters/13-sql.md)）は、リクエストをまたいでプロセスが生きていることを前提にしています
- 手持ちのサーバーをそのまま動かしたい。すでにコンテナイメージになっているアプリや、Node.js 以外の言語、OS のパッケージに依存するアプリがこれに当たります
- 呼び出しが途切れない。ずっと忙しいなら、呼ばれた時間で課金されるより、置いてある時間で課金されるほうが安くなる負荷がどこかにあります。その境目は負荷によって変わり、この本では計算していません

コンテナイメージで配りたいだけなら、Lambda でもできます。Lambda はイメージから関数を作れて、そのイメージの置き場所もこの章と同じ ECR です。イメージにすることと、常に動かしておくことは、別々に選べます。

コンテナにすると、使っていない間の料金 0 を手放します。そして、いくつ動かすか、どう入れ替えるか、止めるときにどうするかを、自分で決めることになります。この章の後半は、ほぼその話です。

## 全体像

<!-- section: 12.architecture -->

```figure
caption: Application Load Balancer が 2 つの AZ のタスクへリクエストを配る。セキュリティグループが通すのはその通信だけで、VPC、サブネット、ルートテーブルは 11章のスタック AihNetwork から Fn::ImportValue で読む
node client: クライアント | curl, あとで SPA
node alb: Application Load Balancer | Public1 + Public2, AZ ごとにノードとパブリック IPv4 が 1 つ
node tg: ターゲットグループ | target type: ip, 10 秒ごとに GET /health
node t1: タスク | AZ 1a, 既定で Public1
node t2: タスク | AZ 1c, 既定で Public2
node ecr: ECR のリポジトリ | イメージのタグは immutable
node logs: CloudWatch Logs | 7 日保持
edge client -> alb: HTTP :80, 証明書なし (ドメイン名が無い)
edge alb -> tg: リスナー :80
edge tg -> t1: HTTP :8080
edge tg -> t2
edge t1 -> ecr: HTTPS :443
edge t2 -> ecr
edge t1 -> logs
edge t2 -> logs: HTTPS :443
group svc: ECS service on Fargate: desired count 2, auto scaling 2..4 (CPU 60 %) = t1, t2
```

```figure
caption: タスク 1 つの中では、コンテナが Map にノートを持ち、タスク実行ロールがイメージの取得とログの書き込みを受け持つ
node srv: コンテナ "api" | node server.mjs
node exec: タスク実行ロール | イメージを取得, ログを書く
node role: タスクロール | 権限なし
node app: 04章のアプリ
node svc: NoteService
node map: Map | タスクごとに 1 つ
edge srv -> app
edge app -> svc
edge svc -> map
group t: タスク: 0.25 vCPU, 0.5 GB, arm64, ネットワークインターフェイス 1 つ = srv, exec, role, app, svc, map
```

図に出てくる用語を先に説明します。

**イメージ**（image）は、アプリと、アプリが動くのに必要なファイル一式をまとめたものです。**ECR**（Elastic Container Registry）は、イメージの置き場所です。

**タスク定義**（task definition）には、どのイメージを、どれだけの CPU とメモリで、どのロールで動かすかを書きます。タスク定義から起動されて実際に動いているものが**タスク**（task）です。**サービス**（service）は、タスクを常に 2 つ動かしておくという指示と、その指示を守り続ける仕組みを指します。タスクが落ちれば補充し、タスク定義が変われば入れ替えます。

**Fargate** は、タスクを動かすサーバーを AWS に任せる方式です。EC2 のインスタンスを自分で並べる方式もありますが、この章では扱いません。タスクの大きさと動かした時間だけを考えれば済むので、Fargate を選びました。

**ALB** は HTTP の入口で、後ろのタスクにリクエストを振り分けます。振り分け先の一覧が**ターゲットグループ**（target group）です。

タスクの大きさと数は、次の設定で決めています。

<<< @/examples/12-containers/src/config.ts{size}

256 の単位は CPU ユニットで、1024 が 1 vCPU に当たります。Fargate で選べる組み合わせのうち、0.25 vCPU と 512 MiB を使っています。`MAX_CONNECTIONS` は、タスク 1 つが同時に持てる接続の数の上限です。メモリが 512 MiB しかないので、同時に抱える量に上限を付けました。

04章から変わっていない点が 1 つあります。ノートはまだメモリの中にあります。タスクが 2 つあれば `Map` も 2 つあり、ALB は既定で順番に振り分けるので、作ったノートが 2 回に 1 回しか見えません。タスクは更新のたびに入れ替わるので、ノートはそのたびに全部消えます。04章で Lambda の実行環境について見たことが、ここではもっとはっきり現れます。

置けるノートはタスクごとに 100 件までで、04章のリポジトリ層の上限がそのまま効いています。Lambda と違ってタスクは動き続けるので、上限が無ければ、POST され続けたぶんだけメモリが埋まっていきます。データをタスクの外に出すのは [05章](/ja/chapters/05-dynamodb.md)と[13章](/ja/chapters/13-sql.md)で扱い、この章では、アプリを入れて動かす側だけを見ます。

## docker は 2 つのプログラム

<!-- section: 12.docker -->

コンテナの話に入る前に、つまずきやすい点を 1 つ説明しておきます。

`docker` と入力して動くコマンドはクライアントです。イメージをビルドしたりコンテナを動かしたりするのは、**デーモン**（`dockerd`）という別の常駐プログラムで、クライアントはデーモンへ依頼を送るだけです。2 つは別のマシンにあっても構いません。

この違いは、次の場面で問題になります。

- `docker` コマンドがあるのに `failed to connect to the docker API ... check if the path is correct and if the daemon is running` と表示される。クライアントはあっても、デーモンが動いていません（この文面は、この章を書いたマシンの Docker CLI 29.7.2 が実際に出したものです）
- `docker` コマンドを入れただけでは何も動かない。デーモンは、Docker Desktop や Colima のような別のソフトウェアが用意します

この本の devShell（Nix）には、クライアントもデーモンも入っていません。イメージを扱う手順（`ecs:image:build`、`ecs:image:run`、`ecs:image:push`）だけは、Docker Desktop などを別に起動しておく必要があります。

それ以外は、Docker なしで進められるようにしてあります。サーバーの起動、テスト、イメージに入れるファイルの確認、CDK の synth は、どれも Docker を使いません。

この章を書いている間、手元ではデーモンが動いていなかったので、イメージは一度もビルドできていません。Dockerfile と `docker` のコマンドは、一次情報と help を見て書いたもので、動かして確かめてはいません。
