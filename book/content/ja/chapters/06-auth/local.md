---
title: "06 Auth: 手元で動かす"
---

# 06 Auth: 手元で動かす

## 手元で 2 人になる

<!-- section: 06.local -->

動かしてみましょう。`examples/06-auth/.env.example` を、同じ場所に `.env` という名前でコピーします。

<<< @/examples/06-auth/.env.example

ターミナルを 2 つ使います。

```bash
vp run dev:app:api
vp run dev:app:web
```

<http://localhost:5173> を開いて、利用者名（既定は `alice`）を入れてサインインします。ノートを作ったら、別のブラウザか private window で `bob` としてサインインしてみてください。Bob の一覧は空のはずです。同じノートを 2 つのタブで開いて両方で保存すると、後から保存したタブに、保存済みの内容と自分の入力の両方が出ます。

Docker も、AWS の認証情報も、user pool も要りません。

### 開発用のサインイン

手元には Cognito がないので、代わりを用意しました。

<<< @/examples/06-auth/api/src/local-auth.ts

<<< @/examples/06-auth/api/src/dev.ts{dev}

`POST /local/token` は、利用者名を送ると、その利用者の token を無条件に返します。パスワードはありません。手元でアプリを 2 人として動かすための道具です。

こんなものがデプロイに混ざったら大変ですよね。混ざらないことは、仕組みで保証しています。

- この endpoint と開発用の検証は、`dev.ts` と `local-auth.ts` にだけあります。Lambda の入口（`lambda.ts`）は、どちらも import しません。bundle に入りません
- 開発用の token は共有の秘密で署名します（HS256）。API Gateway の JWT authorizer が受け付けるのは RSA 系の署名だけなので、仮にこの token をデプロイした API に送っても、通りません

それから、これは Cognito の模擬ではありません。再現しないものがあります。

- managed login とパスワード: 実際のサインイン画面、パスワードの規則、初回のパスワード変更
- authorization code と PKCE の往復: SPA の Cognito 用のコード（`web/src/auth/cognito.ts`）は、手元では一度も実行されない
- API Gateway の JWT authorizer: 不正な token が、関数に届く前に拒否されること。そのときの応答の形
- token の期限、更新、失効: 1 時間後に何が起きるか

とくに 2 つ目は大事です。手元で動いているのは「サインイン後のアプリ」であって、「Cognito でのサインイン」ではありません。

### 設定は実行時に読む

<<< @/examples/06-auth/web/src/config.ts{config}

SPA は、起動するときに `/config.json` を読んで、API の場所とサインインの方法を知ります。`web/public/config.json` は手元用です。デプロイするときは、stack の output から作った `config.json` に置き換えます。SPA は一度ビルドすれば、どのデプロイにも向けられます。

この設定に秘密はありません。client ID もサインイン用のドメインも、ページを読み込んだ人なら誰でも見られます。ブラウザで動くアプリは秘密を持てないので、そういうアプリを public client と呼びます。

## SPA からサインインする

<!-- section: 06.pkce -->

SPA がサインインに使うのは、authorization code grant と PKCE の組み合わせです。手順は、全体像の図の 1 から 4。

<<< @/examples/06-auth/web/src/auth/provider.ts{provider}

<<< @/examples/06-auth/web/src/auth/cognito.ts{cognito}

先に、正直に言っておきます。Cognito でのサインインは、まだ**一度も実行していません**。この `web/src/auth/cognito.ts` は型検査を通っただけで、本物の user pool を相手に動かしたことがないんです。この章でいちばん大きな「まだ」なので、そのつもりで読んでください。

さて、`signIn` は乱数を 2 つ作ります。

1 つ目は state。戻ってきた redirect が、このタブが送った依頼への答えであることを確かめるためのものです。攻撃者が、自分のサインインで得た code を含むリンクを踏ませても、state が合わないので受け付けません。

2 つ目は code verifier。PKCE の秘密です。サインイン画面へ送るのは、その hash（code challenge）だけ。code を token と交換するときに、元の値を示します。途中で code を盗み見た人は、元の値を知らないので交換できません。

public client は client secret を持てません。PKCE が、その代わりをします。Cognito が対応する challenge の方式は `S256` だけです。

サインイン画面へ移動すると、SPA のページは破棄されます。戻ってくるまでの間、2 つの値はタブごとの sessionStorage に置いておきます。

<<< @/examples/06-auth/web/src/auth/pending.ts{pending}

取り出せるのは 1 回だけです。state が合わないとき、古すぎるときは、何も返しません。偽の state、同じ callback URL の再利用、10 分を過ぎた依頼。テストは、この 3 つをそれぞれ拒否することを確かめています。

Cognito には、code を使わずに token を直接 URL に載せて返す implicit grant もあります。公式ドキュメントは、token を利用者の側に露出させるので安全性が低い、と説明しています。この章の client は implicit grant を無効にしています。

### token はどこに置く？

SPA は、access token をメモリの変数にだけ持ちます。localStorage にも cookie にも入れません。

| 置き場所 | 再読み込み後 | ページに入り込んだスクリプトから |
| --- | --- | --- |
| メモリ（この章） | 消える。もう一度サインインする | ページが開いている間は読める |
| localStorage | 残る | いつでも読める。タブを閉じた後も残る |
| サーバー側の session と cookie（[09章](/ja/chapters/09-ssr.md)） | 残る | 読めない（`HttpOnly` の場合） |

再読み込みのたびにサインインし直すのは、正直ちょっと不便です。ただ、managed login 自身が 1 時間有効の session cookie を持っているので、その間はパスワードを打ち直さずに戻ってこられます。

refresh token はどうでしょう。token endpoint の応答には、refresh token も入っています。SPA はそれを保存せずに捨てています。持たせればもっと長く保てますが、長く使える token をブラウザに置くことになります。この章は、短い側に倒しました。

どの方式でも、ページに悪意のあるスクリプトが入り込めば（XSS）、そのページが開いている間、利用者として API を呼べます。token の置き場所で被害の範囲は変わりますが、XSS そのものの対策の代わりにはなりません。

型付きの client は、リクエストのたびに token を取りに来ます。

<<< @/examples/06-auth/api/src/client.ts{client}

API が 401 を返したら、SPA は持っている token を捨てて、サインインし直すよう促します。

「Sign out」を押したときも、まず手元の token を捨てます。そのうえで managed login の `/logout` へ移動して、サインイン画面側の session も終わらせます。手元の開発用サインインには移動する先がないので、token を捨てるだけです。

### 競合は利用者に見せる

05章で、古い version からの更新は 409 で拒否されて、保存済みのノートが `current` として返るようにしました。この章の画面は、それを利用者に見せます。自分の入力は欄に残したまま、保存済みの内容を並べて表示して、「自分の入力で保存し直す」か「保存済みの内容を採る」かを選んでもらいます。どちらを残すかを、アプリが勝手に決めることはしません。
