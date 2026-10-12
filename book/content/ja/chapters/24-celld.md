---
title: "24 Self-hosting: celld を AWS で動かす"
revision: 2
---

# 24 Self-hosting: celld を AWS で動かす

[23章](/ja/chapters/23-ec2.md)では、マシンを 1 台、OS ごと自分で受け持ちました。最後のこの章では、そうしたマシンの上で、AWS が面倒を見てくれない分散システムを動かします。

題材は celld です。celld は Deno Land が公開しているオープンソースのデーモンで、Cloudflare Workers と Durable Objects のアプリケーションを自分のマシンで動かし、長く残す状態を自分のバケットに置きます。AWS のマネージドサービスではないので、止まったら自分で起こし、更新の順番は自分で決め、壊れたら自分で戻すことになります。この章では、その運用を小さな fleet で体験します。

この章も、**置いてあるだけで時間で課金されるもの**を作ります。ノードを 1 台動かすと 1 日でおよそ USD 2.71、1 か月（730 時間）で USD 82.56 かかります。3 台なら 1 日 USD 4.11、1 か月 USD 125.03 です。既定の構成はノードが 0 台で時間課金はなく、台数は自分で指定したときだけ増えます。試した日のうちに、[片付け](/ja/chapters/24-celld/wrap.md)まで進めてください。

この章の手順は、AWS では一度も動かしていません。celld のバイナリも、手元で一度も実行していません。celld について書いたことはすべて、v0.6.2 の公式文書とソースを読んで得た内容です。手元で確かめたのは、インフラの定義と、操作の順序を決めるロジックと、検査の判定です。内訳は[章末の検証メモ](/ja/chapters/24-celld/wrap.md)にまとめました。

前提は [23章](/ja/chapters/23-ec2.md)と、[11章](/ja/chapters/11-network.md)の VPC と、[22章](/ja/chapters/22-recovery.md)の復旧の考え方です。コードは `examples/24-celld/` にあります。

## celld とは

<!-- section: 24.what -->

celld の公式文書は、3 つのことばを次のように説明しています。

- **cell** は、名前と自分専用の SQLite データベースを持つ小さなサーバーです。Cloudflare の用語では Durable Object にあたり、ユーザーごと、文書ごと、チャットルームごとに 1 つ作ります
- **node** は、マシン 1 台で動く celld のプロセス 1 つです。この章ではノードと書きます
- **fleet** は、同じバケットを共有するノードの集まりです。参加の手続きはなく、ノードはバケットの中の記録でお互いを見つけます

celld にはリーダー選出も、メンバーを管理する仕組みもありません。代わりに、cell ごとの小さな持ち主の記録（ownership record）がバケットの中にあります。ノードは条件付きの書き込みでこの記録を取りに行き、勝った 1 台だけがその cell を担当します。どのノードが勝ったかを決めるのはバケットです。

celld が約束しているのは、1 つの cell を担当するノードは同時に 1 台だけであることと、応答を返した書き込みは失われないことです。どちらの約束にも前提があり、バケットが条件付きの書き込みと範囲指定の読み取りを正しく実装していることと、プロセスを起動し直すスーパーバイザーがいることを求めています。Amazon S3 は、celld が使えると挙げているストアのひとつです。ただしリリース前の試験は Cloudflare R2 に対して行われていて、S3 は「同じクライアントとヘッダーを使う」という位置づけです。

この章を書くために読んだ時点では、次のとおりでした。

- 最新のリリースは v0.6.2（2026-10-07 公開）で、公式の limitations と security のページはこれを **beta** と呼んでいます
- セキュリティ修正が入るのは最新のリリースだけです
- 最初のリリースから 2 か月ほどで 11 回のリリースが出ています。この章の内容は、すぐ古くなります
- fleet 1 つで動かせるアプリケーションは 1 つです。互いに信頼していないコードを同じ fleet に載せる使い方は「安全ではない」と明記されています

Cloudflare で Durable Objects を使うなら、ノードもバケットもディスクも利用者からは見えません。celld ではそのすべてが見え、すべてを自分で運用します。Cloudflare 側の保証や料金は、この章では調べていません。比べているのは、誰が運用するかだけです。

## 版を固定して、中身を確かめる

<!-- section: 24.pin -->

自分で運用するソフトウェアは、最初に、動かす版を固定します。公式のインストーラーは、指定がなければ最新版を取りに行くシェルスクリプトです。手軽ですが、同じ手順でも実行した日によって違う版が入ります。

この章では、版と配布物の SHA-256 をリポジトリに書いておきます。

<<< @/examples/24-celld/src/celld.ts{releases}

ダイジェストは GitHub のリリースに載っている値です。実際にアーカイブを取得して計算し直し、同じ値になることを確かめました。v0.6.1 も入れてあるのは、古い版から更新する練習に使うためです。

アーカイブを取得するタスクは、大きさとダイジェストが合わなければ何も残しません。

<<< @/examples/24-celld/scripts/fetch.ts{verify}

```bash
vp run celld:fetch
```

このタスクを実行すると、ノード用の Linux arm64 のアーカイブが `examples/24-celld/.celld/download/` に入ります。`--host` を付けると、手元のマシン用のバイナリと公式の counter の example も取得します。この 2 つは、後でアプリケーションをデプロイするときに使います。タスクが通信する相手は github.com だけで、取得したものは実行しません。

ダイジェストが合っていても、分かるのは GitHub に置いてあるものと同じだということまでです。配布物が celld の CI で作られたものかどうかは、公式が案内している `gh attestation verify <file> --repo denoland/celld` で確かめます。GitHub CLI は devShell に入っていないので、この確認は各自で用意して実行してください。

## 全体像

<!-- section: 24.architecture -->

構成は 2 つの図に分けました。1 つ目はノードの配置と通信、2 つ目はバケットへのアクセスです。

```figure
caption: ノードは外からのインバウンドがないプライベートサブネットに並び、celld は :8081 でピアと平文の HTTP を話し、Worker は各ノードの 127.0.0.1:8080 だけで待つ
node cli: vp run celld:* | 手元のマシン
node a: node a (AZ 1) | celld :8081, Worker :8080
node b: node b (AZ 2) | celld :8081, Worker :8080
node c: node c (AZ 1) | celld :8081, Worker :8080
node va: データボリューム | retained
node vb: データボリューム | retained
node vc: データボリューム | retained
edge cli -> a: Run Command
edge cli -> b
edge cli -> c
edge b -> a: HTTP
edge c -> b: HTTP
edge a -> va
edge b -> vb
edge c -> vc
group vpc: VPC (11章), private subnets, ap-northeast-1 = a, b, c, va, vb, vc
```

```figure
caption: ノードが読み書きできるのは fleet のバケットだけで、バックアップのバケットには触れない
node nodes: node a, b, c | S3 ゲートウェイエンドポイントから
node backup: backup bucket | s3://<bucket>/backups/, retained
node fleet: fleet bucket | s3://<bucket>/fleet/, retained
node deploy: celld deploy | 手元のマシンから S3 API
edge nodes -x backup: アクセスなし
edge nodes -> fleet
edge deploy -> fleet
```

CDK が作るのは、2 つの図に出てくるバケット、ロール、セキュリティグループと、指定した数のインスタンスとボリュームまでです。celld のインストール、起動、更新は CDK の外に置きました。23章と同じく、テンプレートを変えるたびにインスタンスが作り直されるのを避けるためです。celld ではさらに、どのノードをいつ止めるかが正しさに関わるので、CloudFormation や cdkd の都合で止める順番が決まることも避けています。

cdkd と celld をつなぐ仕組みは作っていません。そうした仕組みが公式にあるという記述は見つからず、想像で補うことはしませんでした。

設定は CDK のコンテキストで渡します。

<<< @/examples/24-celld/src/config.ts{schema}

`nodes` の既定は 0 なので、`vp run celld:infra:deploy` とだけ実行しても、時間で課金されるものは 1 つもできません。

11章で書いた注意が、ここでも当てはまります。`-c` はその回の実行にしか効きません。`-c nodes=3` で作った後に `-c` を付け忘れてデプロイすると、cdkd はノードを 3 台とも消しにいきます。データボリュームは残ります（理由は[しくみと実装](/ja/chapters/24-celld/build.md)のページで説明します）が、テンプレートの管理からは外れるので、次に `-c nodes=3` でデプロイすると空のボリュームが新しく作られます。デプロイの前には、必ず `vp run celld:infra:diff -c nodes=3` の結果を見てください。

デプロイの計画を手元で見るタスクもあります。このタスクは AWS に触りません。

```bash
vp run celld:plan nodes=3
```
