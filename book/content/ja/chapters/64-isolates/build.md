---
title: "64 Isolates: しくみと実装"
---

# 64 Isolates: しくみと実装

このページは、04章のアプリを workerd の worker にするところから始めて、設定のファイル、isolate の境界を確かめる 2 つのテスト、workerd が課さない上限、イメージとスタックの順に進みます。全体の構成は[最初のページ](/ja/chapters/64-isolates.md)にあります。

## アプリを worker にする

<!-- section: 64.adapter -->

workerd が呼ぶのは、メインのモジュールが default で export しているオブジェクトの `fetch` です。引数はリクエストと `env` で、`env` には設定に書いた binding が入っています。04章のアプリは `Fetch`、つまりリクエストを受けてレスポンスを返す関数なので、あいだに要るのは `env` の受け渡しだけです。

<<< @/examples/64-isolates/src/worker.ts{adapter}

Lambda では、モジュールを読み込むときに `process.env` からアプリを組み立てていました。workerd の binding は、モジュールを読み込むときではなく、リクエストと一緒に届きます。そこで、最初のリクエストでアプリを組み立て、あとは使い回します。組み立てに失敗したときは何も残さないので、必須の設定が欠けていれば、ヘルスチェックを含むすべてのリクエストが失敗します。壊れた設定のタスクにリクエストが流れないのは、この動きのおかげです。

入口のファイルは、これで全部です。

<<< @/examples/64-isolates/src/entry.ts{entry}

`composeApp` は 04章のファイルから import しています。04章の Lambda では、同じ場所に `handleApiGateway(app)` と書いていました。

workerd は TypeScript を読まず、`node_modules` も探しません。そこで、入口とその先のすべてを、esbuild で 1 つの ES module にまとめます。

<<< @/examples/64-isolates/src/bundle.ts{bundle}

`platform` を `neutral` にしているのは、バンドルが Node.js にもブラウザーにも寄りかからないようにするためです。`node:` で始まる import だけは外に残します。Cloudflare のドキュメントによれば、compatibility date が 2026-08-04 以降の worker では、Node.js 互換の API が既定で使えます。04章のアプリが使う `node:crypto` と、あとで使う `node:async_hooks` は、どちらも対応済みの一覧に載っています。

## 型から設定のファイルを作る

<!-- section: 64.config -->

workerd の設定は、Cap'n Proto のテキスト形式です。手で書くこともできますが、この章では TypeScript の値から生成します。スタックのポートや環境変数と食い違わないことをテストで確かめたいのと、起動してから気づく間違いを、ファイルを書く前に止めたいからです。

設定の元になる値は、worker とソケットの一覧です。この章が使う項目だけをスキーマにしました。workerd の設定には、ほかにも多くの項目があります。

<<< @/examples/64-isolates/src/definition.ts{worker}

<<< @/examples/64-isolates/src/definition.ts{socket}

binding は 2 種類だけ扱います。値を設定のファイルに書き込む `text` と、workerd を起動したときの環境変数から取る `environment` です。後者は、workerd の設定では `fromEnvironment` と書きます。

<<< @/examples/64-isolates/src/definition.ts{binding}

個々の項目の検査のほかに、全体としての検査があります。

<<< @/examples/64-isolates/src/definition.ts{deployment}

検査のうち 2 つは、workerd の動きに合わせたものです。compatibility date は、固定した版が知っている日付までしか受け付けません。手元の workerd に 1 日先の日付を渡すと、「未来の compatibility date は設定できない」というエラーを出しました。モジュールの名前は、設定のファイルと同じディレクトリにあるファイルの名前に限っています。設定は `embed` でファイルを取り込むので、ここに任意のパスを書けると、マシンの上の別のファイルを worker に埋め込めてしまいます。

Valibot の `v.isoDate()` は形しか見ないので、`2026-02-31` を通します。カレンダーにある日付かどうかは、明示の検査で補いました。

検査を通った値から、テキストを組み立てます。

<<< @/examples/64-isolates/src/capnp.ts{render}

文字列は、スキーマで表示可能な ASCII に限ったうえで、引用符とバックスラッシュだけをエスケープします。

<<< @/examples/64-isolates/src/capnp.ts{text}

コンテナが使う設定は、次の定義から生成します。

<<< @/examples/64-isolates/src/deployments.ts{image}

環境ごとに違う値は、設定のファイルには書かず、環境変数から取ります。イメージを 1 つ作れば、どのステージにも使えます。`forwardedProtoHeader` は、ロードバランサーが付ける `x-forwarded-proto` ヘッダーを読んで、`request.url` のスキームを呼び出し元が使ったものに合わせる設定です。04章のアプリはスキームを見ないので、いまは動きに違いが出ません。

生成されるファイルは、テストが 1 文字ずつ固定しています。

<<< @/examples/64-isolates/test/definition.test.ts{rendered}

このファイルを本物の workerd が受け付けることは、別のテストが確かめます。

<<< @/examples/64-isolates/test/workerd.test.ts{image}

## 1 つのプロセスの中の 2 つの worker

<!-- section: 64.apart -->

この章の 1 つ目の不変条件は、**同じプロセスの中の別々の worker は、状態を共有しない**ことです。

テストは、npm が連れてきた workerd のバイナリを実際に起動します。ポートはカーネルに選ばせ、workerd が `--control-fd` で知らせてくる番号を読みます。

<<< @/examples/64-isolates/src/runtime.ts{start}

設定には、同じバンドルを読む worker を 2 つ書きます。ディスクの上のコードは 1 つで、プロセスも 1 つです。

<<< @/examples/64-isolates/test/workerd.test.ts{apart}

A に作ったノートは、B からは見えません。04章のアプリはノートをモジュールの中の `Map` に置いているので、B の一覧が空だということは、B が自分のモジュールスコープを持っているということです。binding も、worker ごとに別の値が届いています。

このテストが示しているのは、この 2 つの worker が、ふつうに書いたコードでは互いの状態に触れないことまでです。V8 のバグを突くコードに対して境界が保たれるかどうかは、テストでは確かめられません。そこは、最初のページで読んだ README の警告のとおりに扱います。

設定のスキーマには、もう 1 つ注意があります。ある worker を `inherit` で継承した worker は、元の worker と同じ isolate で動くと書かれています。この章の定義は `inherit` を使いません。

## 1 つの worker の中の 2 つのリクエスト

<!-- section: 64.scope -->

2 つ目の不変条件は、worker の内側の話です。**1 つの isolate は、同時に複数のリクエストを処理し、モジュールスコープはそのすべてに共有されます。** Cloudflare のドキュメントも、1 つの Workers のインスタンスが並行するリクエストを 1 つのスレッドのイベントループで処理すると書き、グローバルな状態を使ったり書き換えたりしないよう勧めています。

04章のアプリでは、この共有がそのまま見えます。ノートを置く `Map` は、isolate が生きているあいだ、すべてのリクエストから見えます。

<<< @/examples/64-isolates/test/worker.test.ts{shared}

共有されて困るのは、リクエストごとの値です。35章は、リクエスト ID をモジュールスコープの変数に置くと、処理中の 2 つのリクエストのあいだで ID が入れ替わることを、Node.js の上で再現しました。ここでは、35章のアプリをそのまま workerd に載せて、同じことを確かめます。

<<< @/examples/64-isolates/src/entry-scoped.ts{entry}

テストは、リクエスト A のボディを半分だけ送って止めます。worker は A を受け取り、ボディの残りを待っています。そのあいだに B を送って応答を受け取り、それから A の残りを送ります。待ち時間に頼らずに、「A の処理中に B が来る」という順序を作れます。

<<< @/examples/64-isolates/test/workerd.test.ts{leak}

モジュールスコープの版では、A が保存したノートのログに B のリクエスト ID が付きます。`AsyncLocalStorage` の版では、A の ID が付きます。35章が Node.js で見せた不具合と直し方は、workerd でも同じでした。

Workers から来た読者にとっては、新しい話ではないはずです。標準の Lambda だけが、1 つの実行環境で一度に 1 つのリクエストしか処理しないという、珍しい約束をしていました。workerd に載せると、その約束は無くなります。

## workerd が課さない上限

<!-- section: 64.limits -->

Workers には、リクエストごとの上限があります。2026-10-13 に読んだ Limits のページでは、HTTP リクエスト 1 件の CPU 時間が、有料プランの既定で 30 秒、最大で 5 分です。メモリは isolate ごとに 128 MB です。

workerd の設定のスキーマには、worker の CPU 時間やメモリを制限する項目がありません。サーバーのソースでは、それぞれの worker の isolate に、「上限を課さない」とコメントされた実装が渡されています。ソースで読んだのはこの 2 点だけなので、動きは手元で確かめました。確かめるための worker は、頼まれた時間だけ CPU を使い続けます。

<<< @/examples/64-isolates/src/spin.ts{spin}

`vp run isolates:observe` は、この worker と 04章のアプリを 1 つの workerd に載せて、spin に 2000 ms を頼み、200 ms 後に隣のアプリの `/health` を呼びます。

<<< @/examples/64-isolates/scripts/observe.ts{cpu}

macOS（arm64）の workerd 1.20261012.1 で実行した結果です。

```text
1. One worker holds the CPU for 2000 ms
   the spinning worker: answered 200 after 2012 ms and 33957991 turns of its loop
   its neighbour, asked 200 ms in: answered 200 after 1807 ms
```

ループは 2 秒間、打ち切られずに回りました。そのあいだ、隣の worker の `/health` は答えられず、ループが終わってから返っています。worker どうしは状態を共有しませんが、スレッドは共有しています。1 つの worker の暴走は、同じプロセスのすべての worker を止めます。ロードバランサーのヘルスチェックも同じスレッドが答えるので、暴走が長引けば、タスクは不健全と判定されて入れ替えられます。

自分で足せる上限は、プロセスの外側のものだけです。タスクに割り当てたメモリは 512 MB で、これが workerd のプロセス全体の上限になります（超えたときの動きは [41章](/ja/chapters/41-fargate.md)）。ロードバランサーは、データが流れないまま 60 秒たった接続を切りますが、切れるのは接続で、worker の中のループは止まりません。リクエストごとの CPU 時間の上限は、この構成にはありません。

メモリを使い切る実験はしていません。Linux で同じ結果になるかも確かめていません。

## イメージとスタック

<!-- section: 64.image -->

イメージに入れるのは、workerd のバイナリ、設定のファイル、バンドルの 3 つです。この 3 つの組み合わせが 1 つの版になり、タグが付きます。リポジトリはタグの付け替えを禁じているので、タグは 1 つの組み合わせを指し続けます。

Linux arm64 のバイナリは、`vp run isolates:fetch` が npm のレジストリから取得します。大きさとダイジェストが固定した値と合わなければ、展開せずに止まります。

<<< @/examples/64-isolates/scripts/fetch.ts{verify}

ダイジェストが合っていて分かるのは、npm のレジストリにあるものと同じだということまでです。レジストリは、このパッケージに provenance の証明があると表示していますが、この章ではその検証をしていません。

Dockerfile は短く、ネットワークに出ません。

<<< @/examples/64-isolates/Dockerfile

ベースイメージを Debian 12 にしているのは、glibc の版のためです。`CMD` を配列で書く理由と、SIGTERM の届き方は、12章で説明しました。Nix のシェルに Docker のデーモンは入っていないので、このイメージは一度もビルドしていません。

スタックは 12章と同じ形で、違うのはタスクの定義とタスクの数です。

<<< @/examples/64-isolates/infra/lib/isolates-stack.ts{task}

環境変数の名前は、設定の `fromEnvironment` と一致していなければなりません。片方だけ変えると、binding が届かず、アプリは既定値で動くか、組み立てに失敗します。ポートも同じで、設定のソケットとタスクの定義が別々の数字を持つと、ヘルスチェックが通りません。テストが、2 つを突き合わせています。

<<< @/examples/64-isolates/infra/test/isolates-stack.test.ts{bindings}

`readonlyRootFilesystem` は、workerd がディスクに何も書かないという前提に立っています。macOS では、ファイルへの書き込みをすべて禁じた状態で workerd を起動し、リクエストに答えることを確かめました。Fargate の上では確かめていません。

サービスは、新しいタスクが健全になるまで古いタスクを残します。

<<< @/examples/64-isolates/infra/lib/isolates-stack.ts{service}

タスクは 1 つです。2 つにすると、workerd のプロセスが 2 つになり、ノートの `Map` も 2 つになります。あるタスクに作ったノートは、もう一方のタスクからは見えません。04章の Lambda で、実行環境ごとに `Map` が別だったのと同じです。状態を外に置くまでは、タスクの数を増やしても、アプリとしては正しく動きません。

入れ替えのとき、ECS は古いタスクをロードバランサーから外してから SIGTERM を送ります（12章）。workerd が SIGTERM をどう扱うかは、ドキュメントに見つからなかったので、手元で観察しました。

<<< @/examples/64-isolates/scripts/observe.ts{sigterm}

```text
2. SIGTERM with a request in flight
   a new request, sent 200 ms after SIGTERM: no answer within 1500 ms
   the request in flight, finished 1700 ms after SIGTERM: answered 201
   workerd: exited with 0, 1708 ms after SIGTERM

3. SIGTERM, then a request on a new connection
   the request, sent 200 ms after SIGTERM: connect ECONNREFUSED 127.0.0.1:64167
   workerd: exited with 0, 2 ms after SIGTERM

4. SIGTERM with an idle keep-alive connection open
   before SIGTERM: answered 200 after 2 ms
   the same connection, 200 ms after SIGTERM: connect ECONNREFUSED 127.0.0.1:64170
   workerd: exited with 0, 1 ms after SIGTERM
```

処理中のリクエストがあれば、workerd はそれに答えてから終了コード 0 で終わりました。処理中のものが無ければ、アイドルの接続が残っていても、すぐに終わりました。気をつけたいのは 2 番目の観察の 1 行目です。終了を待っているあいだに届いた新しいリクエストは、答えをもらえませんでした。ロードバランサーから外すのが先、SIGTERM が後という順序が守られていれば、この状況は起きません。処理中のリクエストをいつまで待つのか、上限があるのかは、確かめていません。ECS は `stopTimeout` の 30 秒で SIGKILL を送るので、待ちはそこで終わります。

観察はどれも macOS でのものです。コンテナの中で PID 1 として動く workerd に SIGTERM が届くかは、イメージをビルドしていないので確かめていません。
