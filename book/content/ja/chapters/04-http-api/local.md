---
title: "04 HTTP API: 手元で動かす"
---

# 04 HTTP API: 手元で動かす

## 手元で動かす

<!-- section: 04.local -->

動かしてみましょう。`examples/04-http-api/.env.example` を、同じ場所に `.env` という名前でコピーします。

<<< @/examples/04-http-api/.env.example

```bash
vp run dev:api
```

<http://localhost:8787> で API が立ち上がります。別のターミナルから叩いてみてください。

```bash
curl -s http://localhost:8787/health
curl -s -X POST http://localhost:8787/notes -H 'content-type: application/json' -d '{"title":"first note"}'
curl -s http://localhost:8787/notes
curl -s -X POST http://localhost:8787/notes -H 'content-type: application/json' -d '{"title":""}'
```

最後のはわざと失敗させています。`code` が `invalid_request` で、`issues` に `title` が入った 400 が返ってくるはずです。サーバー側のターミナルには、リクエストごとに JSON が 1 行ずつ流れます。ソースを保存すれば、勝手に再起動します。

この開発サーバーの正体は、これだけです。

<<< @/examples/04-http-api/src/dev.ts{dev}

Lambda で動かすのと同じアプリを、ふつうの Node.js の HTTP サーバーにのせているだけ。だから軽いし、課金もされません。そのかわり、Lambda そのものではないので、再現しないものがあります。

- **API Gateway の route**: 本番では、定義していない path は Lambda に届く前に API Gateway が 404 を返す
- **Lambda の制限**: 10 秒を超えた処理は打ち切られる。メモリにも上限がある
- **IAM**: 許可していない AWS の操作は拒否される
- **API Gateway の CORS**: 本番では、preflight のリクエストは Lambda に届く前に API Gateway が答える
- **実行環境の入れ替わり**: メモリの中身が、次の呼び出しまで残っているとは限らない

最後のは、この章の後半の主役です。

### もう一歩、本番に寄せたいとき

cdkd には、API Gateway と Lambda をローカルのコンテナで動かす機能があります。

```bash
vp run dev:api:cdkd
```

こちらは Docker の daemon が動いている必要があります。devShell に入っても Docker は付いてこないので、Docker Desktop などを別に起動しておいてください。

1 つ注意があります。cdkd のソースとドキュメントを読むかぎり、この機能は handler を動かすコンテナに、既定で**あなた自身の認証情報**を渡します。handler が AWS SDK を呼べば、ローカルで動いているのに本物の AWS に届いて、課金もされます。しかも実行 role ではなくあなたの権限で動くので、「ここで動いた」は「デプロイ後も権限が足りる」を意味しません。この章の handler は AWS を呼ばないので関係ありませんが、05章からは頭の片隅に置いておいてください。

正直に言うと、このタスクはまだ実際に動かせていません。

## テスト

<!-- section: 04.tests -->

```bash
vp run test:unit
```

テストは 3 か所にあります。それぞれ、見ているものが違います。

| どこ | ファイル | 見ているもの | 見ていないもの |
| --- | --- | --- | --- |
| アプリ | `test/app.test.ts` | 入力の検証、エラーの形、request ID、CORS | Lambda と API Gateway を通したときの動き |
| client | `test/client.test.ts` | client とサーバーの契約。契約を破る応答の扱い | 本物のネットワーク |
| インフラ | `infra/test/http-api-stack.test.ts` | 権限、ログの保持、timeout、route | AWS が template どおりに動くこと |

アプリのテストは、ポートを開きません。Hono のアプリに `Request` を直接渡すだけです。

client のテストでは、モックを手書きしていません。本物のアプリを、client の通信手段としてそのまま渡します。サーバーの実装を変えて契約が崩れたら、このテストが落ちます。

その client がこちら。

<<< @/examples/04-http-api/src/client.ts{client}

`hc<App>` のおかげで、サーバーの route やレスポンスの型が、コンパイル時に client へ伝わります。path を打ち間違えれば型エラーです。気持ちいいですね。

ただ、この型が語っているのは**このリポジトリにあるコード**の話です。実際に応答するサーバーが同じ版とは限りません。古いデプロイかもしれないし、途中の proxy がエラーページを返すかもしれない。だから client は、受け取った応答を schema に通してから返します。「200 だけど形が違う」「502 で HTML が返ってきた」も、テストに入れてあります。

もう 1 つ、ちょっと変わったテストがあります。アプリのインスタンスを 2 つ作って、片方に書いたノートがもう片方から見えないことを確かめるものです。バグ探しではありません。次の節の話を、仕様として固定しています。

## ノートはどこにある？

<!-- section: 04.state -->

Lambda は、関数を「実行環境（execution environment）」という隔離された箱の中で動かします。箱は最初の呼び出しのときに作られて、初期化されます。これが cold start です。そのあとしばらくは、同じ箱が使い回されます。

<<< @/examples/04-http-api/src/lambda.ts{handler}

`composeApp` はファイルのいちばん外側にあります。ここが動くのは、リクエストごとではなく、箱ごとに 1 回。ノートを入れる `Map` も、そのとき 1 つできます。

さて、何が起きるでしょう。

```figure
type: sequence
caption: 実行環境はそれぞれ自分の Map を持つので、同じ GET /notes でも t2 と t3 で答えが違います。
actor client: Client
actor a: 実行環境 A
actor b: 実行環境 B
step client -> a: t1 POST /notes
note a: 作られる。Map = {n1}
step client -> a: t2 GET /notes
step a --> client: 使い回し。[n1] を返す
step client -> b: t3 GET /notes
note a: 別のリクエストを処理中
note b: 作られる。Map = {}
step b --> client: [] を返す
note a: t4 しばらく使われない
note a: 破棄。n1 は消える
```

t3 を見てください。A が別のリクエストを処理している最中に次のリクエストが来ると、Lambda は 2 つ目の箱 B を作ります。B の `Map` は空っぽです。t2 と同じ URL を呼んだのに、答えが違う。

t4 では、しばらく使われなかった A が片付けられて、`n1` はどこにもなくなります。

つまり、Lambda のメモリに置いたものは、cache としては使えても、**データの持ち主にはなれません**。箱は 1 つとは限らないし、いつ消えるかも選べないからです。05章で DynamoDB を足すと、持ち主が table になって、どの箱から読んでも同じ答えになります。

これは、デプロイした API で実際に観察できます。

```bash
vp run api:smoke
```

ノートを 1 件作って、すぐ読み戻すタスクです。読み戻しが別の箱に届いたら 404 になりますが、タスクはそれを失敗にせず、「別の実行環境が応答した」と表示します。この章の作りでは、それが正しい期待だからです。
