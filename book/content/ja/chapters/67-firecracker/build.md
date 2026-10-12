---
title: "67 Firecracker: しくみと実装"
---

# 67 Firecracker: しくみと実装

このページでは、Firecracker の API を TypeScript から呼ぶ小さなクライアントを書きます。microVM を 1 つ起動するのに要る呼び出しだけを扱い、送るものはすべて、プロジェクトが公開している API の仕様と照らします。後半では、コードにしなかった 2 つの話題、jailer とスナップショットを、資料から読みます。

## API ソケットと起動の順番

<!-- section: 67.api -->

Firecracker のプロセスは、起動しただけでは何も動かしません。Unix ドメインソケットで HTTP を待ち受け、設定を受け取り、`InstanceStart` を受けて初めてゲストを起動します。論文は、API にした理由をこう書いています。プロセスを先に起動して設定まで済ませておけば、必要になったときに `InstanceStart` を送るだけでよく、起動の待ち時間が短くなる。Lambda が起動済みの microVM をプールできるのは、この作りのおかげです。

```figure
caption: 設定の 4 つは起動の前にしか送れません。InstanceStart が成功するのは 1 回だけです。
type: sequence
actor client: クライアント
actor fc: Firecracker
actor guest: ゲスト
step client -> fc: PUT /machine-config
step client -> fc: PUT /boot-source
step client -> fc: PUT /drives/rootfs
step client -> fc: PUT /network-interfaces/net1
note fc: ここまでは送り直せる
step client -> fc: PUT /actions InstanceStart
step fc -> guest: カーネルを読み込んで起動
note fc: 以後、設定の 4 つは断られる
step guest --> client: 最初の HTTP の応答
```

API の仕様は、リポジトリの `src/firecracker/swagger/firecracker.yaml` です。仕様書（`SPECIFICATION.md`）は、API はこのファイルに従う、と約束しています。そこでこの章のコードは、版を 1 つ決めて、そのファイルと照らします。

<<< @/examples/67-firecracker/src/spec.ts{pinned}

固定したのは、2026 年 9 月 10 日に公開された v1.17.0 です。仕様の全体は 64 KB あり、バルーン、メモリのホットプラグ、MMDS など、この章が使わない操作が大半を占めます。リポジトリに入れたのは、上の 9 つの操作と、そこから参照される定義だけを切り出した JSON です（`spec/firecracker-v1.17.0.subset.json`）。切り出しは次の関数が行います。

<<< @/examples/67-firecracker/src/spec.ts{extract}

`vp run firecracker:spec` は、GitHub から仕様を取得し、SHA-256 が `SPEC.sha256` と一致することを確かめてから切り出し、リポジトリの JSON と比べます。取得するのは GitHub の公開ファイルだけで、AWS には触れません。

このクライアントは、仕様から生成したものではありません。型とリクエストは手で書き、テストが仕様と照らします。照らす道具は、切り出した定義に対して値を検査する小さな関数です。

<<< @/examples/67-firecracker/src/spec.ts{conforms}

`conforms` が読むキーワードは `$ref`、`type`、`required`、`properties`、`enum`、`minimum`、`maximum` の 7 つで、Swagger の全体ではありません。切り出した定義がこれ以外のキーワード（説明のための `description`、`default`、`format`、`readOnly` を除く）を使っていないことは、テストで固定しています。仕様より厳しい点が 1 つあり、定義に無いプロパティを誤りとして報告します。フィールド名の打ち間違いを通さないためです。

テストが確かめているのは、次のことです。このコードが送りうるすべてのリクエストについて、メソッドとパスの組が仕様にあり、`operationId` が一致し、成功として待つステータスが仕様の応答に載っていて、ボディが定義に合うこと。使うと宣言した 9 つの操作のすべてを、少なくとも 1 回は送っていること。

## 設定の検証

<!-- section: 67.config -->

microVM の設定は、ファイルやコマンドラインから来る値なので、Valibot で検証します。

<<< @/examples/67-firecracker/src/config.ts{schema}

仕様から来ている制約と、この章が足した制約が混ざっているので、分けておきます。

- vCPU の数の 1 から 32 は、仕様の `minimum` と `maximum` です。テストが、スキーマの受け入れる範囲と仕様の値が同じであることを確かめています
- 既定値の 1 vCPU と 128 MiB は、何も送らなかったときの Firecracker の値で、仕様の説明に書かれています
- メモリの下限、ID に使える文字、パスに改行を許さないことは、この章が決めたものです。仕様は ID を「文字列」としか書いていません。ID は URL のパスに入るので、文字を絞っておけばエスケープを考えずに済みます
- 起動引数の既定値は、Firecracker の手引きのものです。`console=ttyS0` はシリアルコンソールを有効にします。FAQ は、起動時間のためにコンソールは既定で無効だと書いていて、本番ホストの設定の文書は、本番では有効にしないよう勧めています。この章は練習なので、手引きに合わせました

設定からリクエストの列を作る部分は、何も送らない純粋な関数です。

<<< @/examples/67-firecracker/src/requests.ts{configure}

<<< @/examples/67-firecracker/src/requests.ts{sequences}

ドライブは、ホストにあるファイルのパスを渡すだけです。ゲストからは virtio のブロックデバイスに見えます。ネットワークは、ホストに作っておいた TAP デバイスの名前と、ゲストに見せる MAC アドレスを渡します。TAP デバイスを作ること、アドレスを付けること、外へ出るパケットを選別することは、どれも Firecracker の外の仕事です。

## クライアントと、失われた応答

<!-- section: 67.client -->

HTTP の相手は Unix ドメインソケットです。Node.js の `http.request` は `socketPath` を受け取るので、依存を足さずに書けます。

<<< @/examples/67-firecracker/src/client.ts{transport}

応答の扱いは 3 通りに分けています。仕様が成功とするステータスが返れば成功です。それ以外のステータスが返れば、Firecracker が断ったということなので、`fault_message` を添えた `FirecrackerApiError` にします。応答が届かなければ `NoAnswerError` です。最後の場合は、Firecracker がリクエストを実行したかどうかがわかりません。

<<< @/examples/67-firecracker/src/client.ts{send}

相手は同じマシンのプロセスですが、これは分散システムの問題と同じ形をしています。状態を持っているのは Firecracker のプロセスで、クライアントは応答からしか状態を知れません。この章の不変条件は次の 2 つです。**設定を途中で断られた microVM は起動しない。起動の指示が効くのは 1 回だけ。**

1 つ目は、列を順に送り、最初の失敗で止めることで守ります。`InstanceStart` は列の最後にあるので、途中で止まれば送られません。設定の呼び出しは、仕様が「作る、または更新する」と書いているとおり同じ内容を送り直せるので、失敗の原因を直してから列を最初から送り直せます。

2 つ目は、応答が失われたときに問題になります。API の文書は、`InstanceStart` は 1 回しか成功しないと書いています。応答が届かなかったからといって送り直すと、ゲストは動いているのに、2 回目は断られます。クライアントはそれを起動の失敗と取り違えます。

```figure
caption: InstanceStart の応答が失われたら、送り直さずに状態を読みます。
type: sequence
actor client: クライアント
actor fc: Firecracker
step client -> fc: PUT /actions InstanceStart
note fc: Running になる
step fc --x client: 応答が届かない
step client -> fc: GET /
step fc --> client: state: Running
```

<<< @/examples/67-firecracker/src/client.ts{start-once}

応答が無く、読んだ状態も `Running` でなければ、エラーのまま返します。そのとき再送してよいかは、状態が `Not started` だったかどうかで呼び出し側が決められます。

この振る舞いを確かめる相手として、テストには自作のサーバーがあります（`test/support/fake-firecracker.ts`）。本物の Unix ドメインソケットで待ち受けるので、クライアントの HTTP の部分は実際に通ります。ただし、これは Firecracker ではなく、この本のモデルです。知っている規則は 4 つだけで、それぞれ仕様か文書の 1 文に対応しています。ボディには定義が必須とするフィールドが要ること。設定の 4 つは起動の前だけであること。`InstanceStart` は 1 回だけで、カーネルとルートのドライブが要ること。スナップショットは `Paused` の状態でしか取れないこと。ゲストは何も起動しません。本物の Firecracker がこれらをどんなステータスとメッセージで断るかは、確かめていません。

テストは、不変条件を決まった順序で壊しにいきます。ドライブの設定を断らせて、`InstanceStart` が送られないことを確かめます。`InstanceStart` を実行させたうえで応答を捨て、そのまま送り直すと断られること、`startOnce` なら `InstanceStart` をちょうど 1 回だけ送って `was-running` を返すことを確かめます。誰も応答しないソケットでは、エラーのままであることも確かめます。

## jailer とレート制限

<!-- section: 67.jailer -->

ここからの 2 つの節には、この章のコードがほとんどありません。Firecracker を本番で動かすときの柱なので、資料から読んでおきます。

microVM の境界は KVM と VMM が作ります。Firecracker は、その外側にもう 1 枚の壁を置くことを前提にしています。VMM に欠陥があって、ゲストが Firecracker のプロセスを乗っ取ったとしても、そのプロセスにできることが少なければ被害は小さいからです。壁は 2 種類あります。

1 つは seccomp です。Firecracker は、ゲストのコードを動かす前に、スレッドごとにシステムコールのフィルターを自分に掛けます。既定のフィルターは、Firecracker が動くのに必要な最小限のシステムコールと引数だけを通します。

もう 1 つが **jailer** で、Firecracker と一緒に配布されている別のプログラムです。jailer は root で起動され、次の順で動く、と文書にあります。開いているファイルディスクリプタを閉じ、環境変数を消す。microVM の ID ごとのディレクトリを作り、Firecracker のバイナリをそこにコピーする。リソースの上限を設定し、cgroup を作る。マウントの名前空間を分け、`pivot_root` でそのディレクトリをルートにする。その中に `/dev/net/tun` と `/dev/kvm` を作る。指定があればネットワークの名前空間に入る。最後に、指定された uid と gid に権限を落として、Firecracker を `exec` する。バイナリをコピーするのは、ほかの Firecracker のプロセスとメモリを共有しないため、と理由も書かれています。

本番ホストの設定の文書は、Firecracker は jailer から起動するか、同等以上に厳しい制約の下で動かすこと、そして microVM ごとに別の uid と gid を使うことを勧めています。次のページの手順は、手引きに合わせて jailer を使わず、root で Firecracker を起動します。自分のコードを 1 つ動かして確かめるための簡略で、他人のコードを動かす構成ではありません。

レート制限は、設定のスキーマにあった `rxRateLimiter` と `txRateLimiter` です。Firecracker は、ネットワークインターフェースとドライブのそれぞれに、トークンバケットを 2 つ持たせられます。1 つは帯域（バイト）、もう 1 つは操作の数（パケットや I/O の回数）です。バケットは、大きさ、補充にかかる時間、起動のときに 1 回だけ使える上乗せで決まります。ネットワークインターフェースのレート制限は、起動のあとでも `PATCH` で変えられます。

論文は、レート制限を VMM に入れた理由を 2 つ書いています。ストレージとネットワークに制御用の通信の余地を残すこと、そして、一部の忙しい microVM がほかの microVM の性能に影響しないようにすることです。ゲストに自分を制限させることはできないので、デバイスをエミュレートする場所で絞ります。Lambda のホワイトペーパーも、分離の技術の一覧に、ブロックデバイスとネットワークデバイスのスループットを絞る Firecracker の設定を挙げています。関数のメモリの設定とこの制限がどう結びついているかは、AWS の外からはわかりません。

## スナップショットと SnapStart

<!-- section: 67.snapshot -->

Firecracker は、動いている microVM を止めて、状態をファイルに書き出せます。書き出されるのは 2 つで、ゲストのメモリのファイルと、仮想ハードウェアの状態のファイルです。ディスクのファイルは含まれず、利用者が管理します。API の呼び出しは 3 つで、この章のクライアントが組み立てる列は前の節の `snapshotSequence` です。`PATCH /vm` で `Paused` にし、`PUT /snapshot/create` で書き出し、`PATCH /vm` で `Resumed` に戻します。

再開は、新しい Firecracker のプロセスで、ほかの設定より前に `PUT /snapshot/load` を送ります。このとき Firecracker は、メモリのファイルを全部読み込みません。`MAP_PRIVATE` でマップして、ゲストが触れたページから順に読み込み、書き込みは別のメモリに行きます。再開が速いのはこのためで、代わりに、再開した microVM が生きているあいだ、メモリのファイルを残しておく必要があります。なお、差分のスナップショットは v1.17.0 では developer preview です。

文書が強く注意しているのは、一意性です。1 つのスナップショットから 2 回以上再開すると、ゲストの中で 1 つしか無いはずのものが複製されます。乱数の種、ID、1 回だけ使うはずのトークンです。Firecracker は VMGenID というデバイスで、再開したことをゲストのカーネルに知らせ、Linux 5.18 以降のゲストはカーネルの乱数を作り直します。それ以外の、アプリが持っている値は複製されたままなので、利用者が作り直す必要がある、と文書は書いています。ネットワークの接続が再開のあとも残ることも、保証されていません。

SnapStart との関係で言えるのは、AWS が書いている範囲までです。SnapStart のページは、Lambda が取るのは「Firecracker の microVM のスナップショット」で、対象は初期化の済んだ実行環境のメモリとディスクの状態だと書いています。同じページの注意書きは、上の文書と同じ 2 点です。初期化の中で作った一意な値は、スナップショットを使い回す実行環境のあいだで同じになるので、初期化のあとに作ること。初期化の中で張った接続は、再開のあとに確かめて張り直すこと。

Lambda が取るスナップショットが、ここで読んだ API やファイルの形式と同じものかどうかは、AWS の外からは確かめられません。この章のコードは、スナップショットを取る列を組み立てて仕様と照らすところまでで、実際に取ってはいません。
