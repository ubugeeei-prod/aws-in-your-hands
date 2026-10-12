---
title: "51 Chime SDK: デプロイ"
---

# 51 Chime SDK: デプロイ

このページの手順は、AWS に対してまだ実行していません。タスクと手順は用意してあり、書いてある結果は、ドキュメントとコードから期待されるものです。通話は 2 人いないと確かめられないので、ユーザーを 2 人作ります。

## デプロイして通話する

<!-- section: 51.deploy -->

始める前に、料金を確かめておきます。スタックを置いただけでは、時間で課金されるものはありません。課金が始まるのは、誰かがミーティングに接続したときで、1 人 1 分ごとに USD 0.0017 です。試し終わったら、ブラウザーのタブを閉じるだけでなく、[片付け](/ja/chapters/51-chime-sdk/wrap.md)まで進めてください。

差分を見てから、デプロイします。

```bash
vp run calls:infra:diff
vp run calls:infra:deploy
```

できるのは、ユーザープール、テーブル、関数、HTTP API です。Chime のリソースは 1 つもできません。ミーティングは、誰かが最初に参加したときに API が作ります。

ユーザーを 2 人作ります。06章と同じく、仮のパスワードは Cognito がメールで送ります。

```bash
vp run calls:user:create alice@example.com
vp run calls:user:create bob@example.com
```

ページをビルドし、デプロイした API とユーザープールの設定を書き込んで、手元で配信します。

```bash
vp run calls:config
vp run preview:calls:web
```

`calls:config` は、スタックの出力から `web/dist/config.json` を作り、`media` を `"chime"` にします。ページは `http://localhost:4173` で開きます。HTTPS ではありませんが、ブラウザーは `localhost` を安全なコンテキストとして扱うので、マイクとカメラを使えます。スタックが API の呼び出しとサインインの戻り先として許可しているのも、このオリジンだけです。

ここからは 2 つのブラウザーで進めます。別のブラウザーか、プライベートウィンドウを使ってください。

1. 1 つ目で Alice としてサインインし、「Create a room」を押す。部屋の ID が表示される
2. 2 つ目で Bob としてサインインする。画面の上に、Bob のユーザー ID（`sub`）が表示される
3. Alice の画面で、Bob のユーザー ID を入力して「Add」を押す
4. Bob の画面で、部屋の ID を入力して「Open」を押す
5. 両方で「Join」を押し、マイクの許可を与える

期待される結果は、両方の画面に「has a seat and is connected」が 2 人ぶん並び、互いの声が聞こえることです。同じ部屋で 2 つのブラウザーを使うと、スピーカーの音をもう一方のマイクが拾うので、イヤホンを使うか、片方を消音にしてください。

確かめてほしいことが 3 つあります。どれも、この章の不変条件に対応しています。

- Alice が Bob を「Remove」で外すと、Bob の通話が切れ、Bob がもう一度「Join」を押しても入れない
- Bob が「Leave」を押すと、Alice の画面から Bob の「is connected」が消える
- Alice が同じ部屋を別のタブで開いて「Join」を押すと、先のタブの通話が切れる。古い join token のアテンディーを、サーバーが消すからです

関数のログは、06章と同じ形で出ます。席を渡した呼び出しは `POST /rooms/{id}/join` の 200 として残り、`sub` が入ります。join token はログに書きません。

最後に、drift を確かめます。

```bash
vp run calls:infra:drift
```

ミーティングはスタックのリソースではないので、drift の検査には現れません。動いているミーティングがあるかどうかは、次のページの `calls:end` で見ます。

次は[費用、注意点、片付け](/ja/chapters/51-chime-sdk/wrap.md)です。
