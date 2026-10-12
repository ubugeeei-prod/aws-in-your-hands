---
title: "24 Self-hosting: celld を AWS で動かす"
revision: 1
---

# 24 Self-hosting: celld を AWS で動かす

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

```figure
caption: node は外から inbound のない private subnet に並び、celld は :8081 で peer と平文の HTTP を話し、Worker は各 node の 127.0.0.1:8080 だけで待つ
node cli: vp run celld:* | your machine
node a: node a (AZ 1) | celld :8081, Worker :8080
node b: node b (AZ 2) | celld :8081, Worker :8080
node c: node c (AZ 1) | celld :8081, Worker :8080
node va: data volume | retained
node vb: data volume | retained
node vc: data volume | retained
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
caption: node が読み書きできるのは fleet の bucket だけで、backup の bucket には触れない
node nodes: node a, b, c | S3 gateway endpoint から
node backup: backup bucket | s3://<bucket>/backups/, retained
node fleet: fleet bucket | s3://<bucket>/fleet/, retained
node deploy: celld deploy | your machine から S3 API
edge nodes -x backup: access なし
edge nodes -> fleet
edge deploy -> fleet
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
