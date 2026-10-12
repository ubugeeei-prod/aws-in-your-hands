---
title: "04 HTTP API: Lambda と API Gateway HTTP API"
revision: 3
---

# 04 HTTP API: Lambda と API Gateway HTTP API

SPA は公開できました。次は API です。

この章では、ノートを作って、読んで、消せる小さな HTTP API を書きます。まず手元で動かして、それから同じコードを Lambda にのせます。Docker は要りません。手元で試すぶんには AWS のアカウントも要りません。

先に 2 つだけ。この章の API は、ノートをメモリに置くだけで保存しません（保存は [05章](/ja/chapters/05-dynamodb.md)）。認証もないので、URL を知っている人は誰でも呼べます（認証は [06章](/ja/chapters/06-auth.md)）。消えて困るもの、見られて困るものは入れないでくださいね。

前提は [02章](/ja/chapters/02-toolchain.md)だけです。コードは `examples/04-http-api/` にあります。

## 全体像

<!-- section: 04.architecture -->

```figure
caption: API Gateway は route に合うリクエストだけを Lambda 関数に渡し、関数は CloudWatch Logs に書き出します。
node client: Client | curl、型付き client、のちに SPA
node health: /health | GET
node notes: /notes | GET, POST
node note: /notes/{id} | GET, DELETE
node other: それ以外 | 404、Lambda は呼ばれない
node fn: Lambda 関数 | Node.js 24, arm64, 256 MB, timeout 10 s
node logs: CloudWatch Logs | リクエストごとに JSON 1 行、7 日保持
edge client -> health: HTTPS
edge client -> notes
edge client -> note
edge client -> other
edge health -> fn
edge notes -> fn
edge note -> fn
edge fn -> logs: 実行 role: 自分の log group だけ
group api: API Gateway HTTP API (ap-northeast-1) = health, notes, note, other
```

```figure
caption: Lambda 関数の中では、Hono app が NoteService を呼び、NoteService がメモリ上の repository にノートを置きます。
direction: right
node hono: Hono app
node service: NoteService
node repo: InMemoryNoteRepository | 実行環境ごと
edge hono -> service
edge service -> repo
group fn: Lambda 関数 = hono, service, repo
```

登場人物は 3 つです。

入口が **API Gateway**。HTTPS を受けて、決めておいた route に合うリクエストだけを奥へ渡します。あなたのコードが動くのは **Lambda**。リクエストが来たときだけ起動して、終わったら待機に戻ります。常駐するサーバーはありません。そして Lambda が書き出すログが **CloudWatch Logs** に溜まります。

Lambda が動くのは東京リージョンの中です。CloudFront のような edge ではありません。

### HTTP API ってどれのこと？

API Gateway には種類があって、ここで使うのは「HTTP API」です。名前がややこしいのですが、「REST API」とは別の製品だと思ってください。

| | HTTP API | REST API |
| --- | --- | --- |
| リクエスト料金（東京、最初の段階） | 100 万件あたり USD 1.29 | 100 万件あたり USD 4.25 |
| JWT authorizer | あり | なし（Cognito 用の authorizer と Lambda authorizer はある） |
| AWS WAF、API キー、リクエスト検証、cache、X-Ray | なし | あり |
| レスポンスの streaming | なし | あり |

公式ドキュメントの言い方を借りると、HTTP API は「機能を絞って安くしたもの」。ノートの API に要るのは route と、06章で使う JWT authorizer くらいなので、こちらで十分です。

逆に、API の直前に WAF を置きたい、応答を streaming したい、となったら選び直しです。「API Gateway は streaming できない」みたいに、種類を混ぜて覚えないのがコツです。

### Lambda じゃないほうがいいとき

Lambda のいいところは、使われていない間の料金が 0 なことと、ネットワークの設計なしで API を 1 つ足せること。ただ、向かない場面もあります。

- 1 回の処理が 30 秒を超える。HTTP API は Lambda の応答を最大 30 秒しか待ってくれません（[08章](/ja/chapters/08-async.md)、[16章](/ja/chapters/16-long-jobs.md)）
- つなぎっぱなしの接続が要る、あるいは手持ちのコンテナをそのまま動かしたい（[12章](/ja/chapters/12-containers.md)）
- 読者のすぐ近くで動かしたい（[10章](/ja/chapters/10-edge.md)）

## まず契約から

<!-- section: 04.contract -->

コードを書く前に、API の入力と出力の形を schema にします。

<<< @/examples/04-http-api/src/contract.ts{note}

この定義を、サーバーも client も使います。サーバーは届いたリクエストをこれで検証し、client は返ってきたレスポンスをこれで検証する。TypeScript の型も、ここから `z.infer` で作ります。定義が 1 つしかないので、「サーバーだけ直して client を直し忘れた」が起きません。

エラーの形も決めておきましょう。

<<< @/examples/04-http-api/src/contract.ts{error}

呼ぶ側は、メッセージの文章を読み解かなくても `code` で分岐できます。`requestId` は、あとでログを探すときの手がかりです。

## アプリを書く

<!-- section: 04.app -->

HTTP の処理には Hono を使います。Web 標準の `Request` と `Response` で動く小さなフレームワークで、Node.js でも Lambda でも同じアプリがそのまま動きます。Workers で使ったことがある人も多いはず。

<<< @/examples/04-http-api/src/app.ts{app}

ポイントは 3 つです。

**必要なものは全部、引数でもらう。** 時刻、ID の生成、ログの出力先、ノートの保存先。`createApp` の中で `Date.now()` や `process.env` を直接触りません。テストでは決まった値を渡せて、本番では本物を渡せます。

**リクエストは実行時に確かめる。** TypeScript の型は、実行時には消えています。「型が `CreateNote` だから大丈夫」とは言えないんです。届いた JSON は `validator` が schema に通して、合わなければどの項目がまずいかを添えて 400 を返します。

**想定外の例外は、理由を外に出さない。** `onError` がログに書いて、呼んだ側には `requestId` だけを返します。スタックトレースを応答に載せると、中の作りを教えてしまうので。

ノートの保存先は interface にしてあります。

<<< @/examples/04-http-api/src/notes.ts{repository}

いまの中身はただの `Map` です。05章で DynamoDB に差し替えますが、この interface はそのまま使います。

そして、本物の時刻や乱数や環境変数に触るのは、ここ 1 か所だけ。

<<< @/examples/04-http-api/src/compose.ts{compose}

## 設定は起動時に確かめる

<!-- section: 04.env -->

環境変数も、型の外からやってくる値です。`process.env` の型は「全部 `string` か `undefined`」。必要な変数がちゃんと入っているかは、型を見てもわかりません。

<<< @/examples/04-http-api/src/env.ts{env}

起動するときに一度だけ確かめます。足りなければ、変数の名前つきのメッセージで、最初の呼び出しがコケます。「ある条件のときだけ `undefined` を読んで壊れる」より、ずっと見つけやすいですよね。

ちなみに、ここに置いているのは設定であって、秘密ではありません。Lambda の環境変数は、コンソールで関数の設定を見られる人なら誰でも読めます。API キーのような秘密は環境変数に直接置かず、Secrets Manager などから実行時に取ってきます。この章のサンプルには秘密がないので、そのコードはこの章にはありません（[21章](/ja/chapters/21-security.md)で扱います）。

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

## AWS にのせる準備

<!-- section: 04.infra -->

ここからは CDK です。順に見ていきます。

### ログの置き場所

<<< @/examples/04-http-api/infra/lib/http-api-stack.ts{logs}

わざわざ自分で作っているのには理由があります。作らずにおくと、Lambda が最初の実行のときに自動で作ってくれるのですが、その log group は保持期間が無期限で、stack を消しても残ります。保存料金がかかり続けるうえ、どの stack のものか迷子になります。

### 関数の権限

<<< @/examples/04-http-api/infra/lib/http-api-stack.ts{role}

実行 role（execution role）は、関数が AWS の中で動くときに使う権限です。**あなた自身の権限とは別物**なので、「手元の `aws` コマンドでは通るのに、Lambda の中では拒否される」が普通に起きます。

CDK は、何も言わなければ `AWSLambdaBasicExecutionRole` という管理ポリシーを付けます。これ、アカウント内のどの log group にも書ける権限なんです。ここでは role を自分で作って、さっきの log group に書くことだけを許しています。テストも、許可が 2 つの操作だけであること、対象が `*` でないことを見ています。

05章で DynamoDB を足すときは、この role に table の権限を足します。「この関数は何ができるのか」が、この数行を見ればわかる。そういう状態を保ちたいわけです。

### 関数

<<< @/examples/04-http-api/infra/lib/http-api-stack.ts{function}

`NodejsFunction` は、synth のときに esbuild で TypeScript を 1 つの JavaScript にまとめてくれます。Docker は使いません。

`timeout` は 10 秒にしました。HTTP API は Lambda の応答を最大 30 秒しか待たず、この上限は引き上げられません。それより長く動かしても、もう誰も待っていない処理にお金を払うだけです。

`architecture` は arm64。東京リージョンでは、x86 より実行時間の単価が安くなります（1 GB 秒あたり USD 0.0000133334 と USD 0.0000166667）。

### API

<<< @/examples/04-http-api/infra/lib/http-api-stack.ts{api}

route を 1 つずつ並べています。「全部の path を Lambda に渡す」と書くこともできますが、そうすると存在しない path へのアクセスでも関数が起動して、料金がかかります。並べておけば、それ以外は API Gateway が 404 で返してくれます。

そのかわり、route が Hono のアプリとこの stack の 2 か所に書かれることになります。ずれると困るので、テストが「stack の route はこの 5 つちょうど」を見張っています。

CORS は、ブラウザが別の origin から API を呼ぶのを許す設定です。許す origin は 1 つだけ。既定は SPA の開発サーバーにしてあります。

## デプロイして呼ぶ

<!-- section: 04.deploy -->

```bash
vp run api:infra:diff
vp run api:infra:deploy
```

終わると、`ApiUrl` に `https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com` の形の URL が出ます。

```bash
curl -s https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com/health
vp run api:smoke
```

03章の SPA から呼べるようにするなら、SPA の URL を渡してデプロイし直します。

```bash
vp run api:infra:deploy -c allowedOrigin=https://dxxxxxxxxxxxx.cloudfront.net
```

SPA の画面をこの API につなぐのは、もう少し先です。メモリのノートを画面に出しても、さっき見たとおり、再読み込みのたびに結果が変わるだけなので。05章で保存先を作って、誰のノートかを区別できる 06章でつなぎます。

## ログを見る

<!-- section: 04.observe -->

```bash
vp run api:logs
vp run api:logs --follow
```

stack の output から log group の名前を取ってきて、`aws logs tail` を実行するタスクです。

アプリは、1 リクエストにつき 1 行の JSON を書きます。Lambda の既定のログ形式では、その前に時刻や Lambda の request ID が付くので、CloudWatch Logs に入る 1 件は「前置き + JSON」です（[19章](/ja/chapters/19-observability.md)で、もう一度見ます）。

<<< @/examples/04-http-api/src/log.ts{logger}

1 件のリクエストを追いかけたいときは、応答の `x-request-id` ヘッダー（エラーなら本文の `requestId`）を控えて、その値でログを探します。`status`、`durationMs`、エラーなら `error` にスタックトレースが入っています。同じ ID が、応答ヘッダー、エラー本文、ログの 3 か所に出ることは、テストで確かめてあります。

Lambda 自身も、呼び出しごとに `START`、`END`、`REPORT` の行を書きます。`REPORT` には実行時間、課金対象の時間、使ったメモリの最大値。cold start のときは `Init Duration` も付きます。メトリクスやアラームは [19章](/ja/chapters/19-observability.md)で扱います。

drift の検査は、02章と同じです。

```bash
vp run api:infra:drift
```

## Workers から来た人へ

<!-- section: 04.workers -->

Cloudflare Workers で API を書いたことがあるなら、ここまでの流れは見覚えがあると思います。違うところだけ並べますね。

| | Cloudflare Workers | この章（Lambda と API Gateway） |
| --- | --- | --- |
| 手元での実行 | `wrangler dev` か Vite plugin。Miniflare が本番と同じ runtime（workerd）で動かす | `vp run dev:api` は Node.js の HTTP サーバー。Lambda の runtime ではない。寄せるなら `dev:api:cdkd`（Docker が必要） |
| 他のサービスとの接続 | binding。設定に書くと `env` に現れる。手元では既定でローカルの模擬につながる | AWS SDK で呼ぶ。接続先は環境変数、権限は実行 role。手元の模擬は付いてこない |
| 権限 | binding を宣言したものに触れる | IAM。role に書いた操作だけが通る。手元とデプロイ後で権限が別 |
| 実行場所 | Cloudflare のネットワーク上 | 1 つのリージョン（この本では東京） |
| 入口 | Worker 自体が HTTP を受ける | API Gateway が受けて Lambda に渡す。別のリソースで、料金も別 |
| デプロイ | `wrangler deploy` | synth して template にして、cdkd（または CloudFormation）が反映する |

AWS のほうが部品が多いのは、そのとおりです。入口、関数、role、log group を、それぞれ自分で定義します。そのぶん、部品ごとに設定を選べます。どちらがいいかは作るもの次第で、この本は Workers をやめようとは言いません。

名前が似ている CloudFront Functions（03章）は、Workers の仲間ではありません。ネットワークにもファイルシステムにも触れない、URL やヘッダーを書き換えるための小さな環境です。

## お金の話

金額は USD、東京リージョン、従量課金、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

**誰も呼ばない月は 0 です。** HTTP API にも Lambda にも、置いてあるだけでかかる料金はありません。ログは 7 日で消えます。

呼ばれると、こうなります。月 100 万リクエスト、平均 50 ミリ秒、256 MB、arm64、1 リクエストあたりログ 0.5 KB（アプリの 1 行と、Lambda が書く `START`、`END`、`REPORT` の行の合計）という仮定です。

| 対象 | 数量 | 定価 | 毎月の無料枠の適用後 |
| --- | --- | --- | --- |
| API Gateway HTTP API のリクエスト | 100 万件 | 1.29 | 1.29（無料枠は確認できず、引いていない） |
| Lambda のリクエスト | 100 万件 | 0.20 | 0 |
| Lambda の実行時間 | 12,500 GB 秒 | 0.17 | 0 |
| CloudWatch Logs の取り込み | 0.477 GB | 0.36 | 0 |
| CloudWatch Logs の保存 | 0.111 GB 月 | 0.00 | 0 |
| 小計 | | **2.02** | **1.29** |

無料枠は、Lambda が月 100 万リクエストと 40 万 GB 秒、CloudWatch Logs が 5 GB。アカウント全体で共有です。Lambda の料金ページには、この枠に期限があるかどうかは書かれていません。

応答をインターネットへ送るデータ転送の料金は、この表に入れていません（0 という意味ではなく、未算入です）。50 ミリ秒という実行時間も仮定で、あなたの関数の実際の値はログの `REPORT` 行でわかります。

stack を消せば、この章のぶんの料金は止まります。

## ハマりどころ

| こうなったら | ここを見る |
| --- | --- |
| `dev:api` が `Invalid environment` で止まる | `examples/04-http-api/.env` はありますか。メッセージに出た変数名を確認 |
| デプロイ後、全部の応答が 500 で、`x-request-id` ヘッダーが無い | 関数が初期化でコケています。`vp run api:logs` で `Invalid environment` や import のエラーを探す |
| `{"message":"Not Found"}` が返る | これは API Gateway の応答。stack に無い path を呼んでいます。この本のエラーの形（`error.code`）じゃないので見分けられます |
| 一部の応答だけ、`x-request-id` ヘッダーの無いエラーになる | 関数が timeout したか、途中で落ちています。ログの `REPORT` 行で実行時間を確認 |
| ブラウザから呼ぶと CORS のエラー | デプロイ時の `allowedOrigin` が、呼び出し元の origin（scheme とポートまで）と完全に一致していますか |
| 作ったノートが `GET /notes` に出ない | 別の箱が応答しました。「ノートはどこにある？」のとおりで、この章の仕様です |
| 新しいアカウントで同時実行のエラー | 新しいアカウントは、Lambda の同時実行数の上限が低めです。Service Quotas で確認 |

コツを 1 つ。エラーが返ってきたら、まず `x-request-id` ヘッダーがあるかを見てください。あれば、あなたのアプリまで届いています。なければ、その手前（API Gateway か、関数の起動）です。これだけで探す場所が半分になります。

## 本番にするなら

- **認証と認可を足す。** いまは誰でも呼べます（06章）
- **データを保存する。** いまは消えます（05章）
- **流量を制限する。** HTTP API の stage には throttling の設定があります。上限のない公開 API は、料金の上限もありません
- **アラームを付ける。** 5xx の割合と、応答の遅さを見張ります。このアプリは例外を捕まえて 500 を返すので、Lambda の `Errors` は増えません。見るのは API Gateway の `5xx` と `Latency` です（[19章](/ja/chapters/19-observability.md)）
- **ログの保持期間を決める。** 7 日は学習用の値です
- **反映の経路を AWS CDK CLI と CloudFormation にする。** 02章で話したとおりです
- **同時実行数の上限を確かめる。** 既定はリージョンごとに 1,000 で、アカウント内の全関数で共有。新しいアカウントは、それより低い値から始まります

## 片付け

<!-- section: 04.cleanup -->

```bash
vp run api:infra:destroy
```

関数、role、API、log group が消えます。ログも一緒です。

残るのは、cdkd の bootstrap で作った保存場所（02章）と、そこに置かれたデプロイ用のファイルだけです。

::: details この章の検証メモ

**手元で確かめたこと。** アプリ、client、インフラのユニットテスト。型検査。synth（esbuild の bundle 込み）。`dev:api` を起動して、本文の `curl` を実行。

**まだ確かめていないこと。** `dev:api:cdkd`、`api:infra:deploy`、`api:smoke`、`api:logs`、`api:infra:drift`、`api:infra:destroy` は、実際の AWS では動かしていません。とくに、Node.js 24 の Lambda runtime で bundle が動くこと、API Gateway が返すエラーの状態コードと本文（「ハマりどころ」の `Not Found` など）、関数が timeout したときに呼び出し側へ返る応答、箱が複数になったときの `api:smoke` の表示は、実環境での確認待ちです。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| まず契約から | `examples/04-http-api/src/contract.ts` | `test:unit` |
| アプリを書く | `examples/04-http-api/src/app.ts`、`src/notes.ts`、`src/compose.ts`、`src/log.ts` | `test:unit` |
| 設定は起動時に確かめる | `examples/04-http-api/src/env.ts`、`test/env.test.ts`、`.env.example` | `test:unit` |
| 手元で動かす | `examples/04-http-api/src/dev.ts` | `dev:api`、`dev:api:cdkd` |
| テスト | `examples/04-http-api/test/app.test.ts`、`test/client.test.ts`、`src/client.ts` | `test:unit` |
| ノートはどこにある？ | `examples/04-http-api/src/lambda.ts`、`src/notes.ts`、`scripts/smoke.ts` | `api:smoke` |
| AWS にのせる準備 | `examples/04-http-api/infra/lib/http-api-stack.ts`、`infra/bin/app.ts`、`infra/test/http-api-stack.test.ts`、`cdk.json` | `api:infra:synth`、`test:unit` |
| デプロイして呼ぶ | `tools/src/infra/`、`examples/04-http-api/scripts/smoke.ts` | `api:infra:diff`、`api:infra:deploy`、`api:smoke` |
| ログを見る | `examples/04-http-api/src/log.ts`、`scripts/logs.ts` | `api:logs`、`api:infra:drift` |
| 片付け | `tools/src/infra/` | `api:infra:destroy` |
| お金の話 | `data/pricing/`、`tools/src/pricing/calc.test.ts` | `test:unit` |

**一次情報**（確認日はすべて 2026-10-11）

- [Choose between REST APIs and HTTP APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vs-rest.html)
- [Quotas for HTTP APIs in API Gateway](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-quotas.html)
- [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)
- [AWS Lambda pricing](https://aws.amazon.com/lambda/pricing/)
- AWS Price List bulk API: [Lambda](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/ap-northeast-1/index.json)、[API Gateway](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonApiGateway/current/ap-northeast-1/index.json)、[CloudWatch](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/ap-northeast-1/index.json)
- [Cloudflare Workers: Local development](https://developers.cloudflare.com/workers/local-development/)
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)

:::
