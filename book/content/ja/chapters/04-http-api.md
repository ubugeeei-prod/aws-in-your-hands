---
title: 04 HTTP API を足す: Lambda と API Gateway HTTP API
revision: 1
---

# 04 HTTP API を足す: Lambda と API Gateway HTTP API

## この章の成果

- ノートを作成・取得・削除する HTTP API を、手元で、Docker も AWS も使わずに動かせる
- 同じコードを Lambda にデプロイし、API Gateway 経由で HTTPS で呼べる
- リクエストとレスポンスの形が、サーバー、client、テストで 1 つの定義を共有している
- ログから 1 件のリクエストを探せる
- 「Lambda のメモリに置いたデータ」がなぜ消えるのかを説明できる

前提は [02章](/ja/chapters/02-toolchain.md)です。[03章](/ja/chapters/03-spa.md)は読んでいなくても進められます。サンプルは `examples/04-http-api/` にあります。

この章の API はノートをメモリに置くだけで、永続化しません。保存は 05章（planned）です。認証もありません。URL を知っていれば誰でも呼べます。認証は 06章（planned）です。**この章の API に、消えて困るデータや他人に見られて困るデータを入れないでください。**

## 構成

<!-- section: 04.architecture -->

```text
Client (curl, typed client, later the SPA)
  |  HTTPS
  v
API Gateway HTTP API (ap-northeast-1)
  |  routes: GET /health, GET|POST /notes, GET|DELETE /notes/{id}
  |  anything else: 404 from API Gateway, Lambda is not invoked
  v
Lambda function (Node.js 24, arm64, 256 MB, timeout 10 s)
  |  execution role: may write to its own log group, nothing else
  |  Hono app -> NoteService -> InMemoryNoteRepository (per execution environment)
  v
CloudWatch Logs (one JSON line per request, kept 7 days)
```

何がどこで動くかを整理します。

- **あなたのコードが動くのは Lambda** です。東京リージョンの中で動きます。edge ではありません。
- **API Gateway は入口**です。HTTPS を受け、route に合うリクエストを Lambda に渡します。
- **Lambda は、リクエストが来たときだけ動きます。** 常駐するサーバーはありません。

### なぜこの構成か

API Gateway には種類があります。この章が使うのは HTTP API です。REST API、WebSocket API とは機能も料金も違います。

| | HTTP API | REST API |
| --- | --- | --- |
| リクエスト料金（東京、最初の段階） | 100 万件あたり USD 1.29 | 100 万件あたり USD 4.25 |
| JWT authorizer | あり | なし（Cognito 用の authorizer と Lambda authorizer はある） |
| AWS WAF、API キー、リクエスト検証、cache、X-Ray | なし | あり |
| レスポンスの streaming | なし | あり |

公式ドキュメントは、HTTP API を「機能を絞って安くしたもの」と位置づけています。ノートの API に必要なのは route と、06章で使う JWT authorizer だけなので、HTTP API で足ります。AWS WAF を API の直前に置きたい、応答を streaming したい、という要求が出たら、REST API か別の入口を選び直します。「API Gateway は streaming できない」のように、種類を区別せずに語らないことが大事です。

Lambda を選ぶ理由は、使われていない間の料金が 0 であること、そして API を 1 つ足すのにネットワークの設計が要らないことです。次の場合は別の選択肢を検討します。

- 1 回の処理が 30 秒を超える。HTTP API は Lambda の応答を最大 30 秒しか待ちません（08章、16章の予定）
- 常時つながった接続を保ちたい、または既存のコンテナをそのまま動かしたい（12章の予定）
- 読者の近くで動かしたい。Lambda はリージョンの中で動きます（10章の予定）

## 契約を 1 か所に書く

<!-- section: 04.contract -->

API の入力と出力の形を、最初に schema として書きます。

<<< @/examples/04-http-api/src/contract.ts{note}

この 1 つの定義を、3 か所が使います。

- サーバーは、届いたリクエストを `createNoteSchema` で検証する
- client は、返ってきたレスポンスを `noteSchema` で検証する
- どちらも、TypeScript の型をこの schema から導く

エラーの形も 1 つに決めます。

<<< @/examples/04-http-api/src/contract.ts{error}

呼び出す側は、文章を解釈せずに `code` で分岐できます。`requestId` は、あとでログを探すための鍵です。

## アプリを書く

<!-- section: 04.app -->

HTTP の処理には Hono を使います。Hono は Web 標準の `Request` と `Response` で動く小さなフレームワークで、Node.js でも Lambda でも同じアプリを動かせます。

<<< @/examples/04-http-api/src/app.ts{app}

`createApp` は、必要なものをすべて引数で受け取ります。時刻、ID の生成、ログの出力先、ノートの保存先です。`Date.now()` や `process.env` を直接読みません。こうしておくと、テストでは決まった値を渡して結果を固定でき、本番では本物を渡せます。

リクエストの検証は route の中で行います。`validator` が `createNoteSchema` に通し、合わなければ、どの項目が悪いかを添えて 400 を返します。TypeScript の型は実行時には存在しないので、「型が `CreateNote` だから正しい」とは言えません。届いた JSON が正しいかどうかは、実行時に確かめるしかありません。

想定外の例外は `onError` が受けます。原因はログに書き、呼び出した側には `requestId` だけを返します。スタックトレースを応答に含めません。

ノートの保存先は interface です。

<<< @/examples/04-http-api/src/notes.ts{repository}

この章の実装は `Map` です。05章で DynamoDB の実装に差し替えますが、interface は変わりません。

本物の時刻、乱数、環境変数に触れるのは、次の 1 か所だけです。

<<< @/examples/04-http-api/src/compose.ts{compose}

## 設定を検証する

<!-- section: 04.env -->

環境変数も、型の外から来る値です。`process.env` の型は「すべてが `string` か `undefined`」で、必要な変数が設定されているかどうかは、型からは分かりません。

<<< @/examples/04-http-api/src/env.ts{env}

起動時に一度だけ検証します。足りない変数があれば、最初の呼び出しで、変数名を含むメッセージとともに失敗します。「ある条件のリクエストのときだけ `undefined` を読んで壊れる」よりも、ずっと見つけやすくなります。

ここにあるのは設定であって、秘密ではありません。Lambda の環境変数は、コンソールで関数の設定を見られる人なら誰でも読めます。API キーやパスワードのような秘密は環境変数に直接置かず、Secrets Manager などから実行時に取得します。この章のサンプルは秘密を持たないので、その実装はありません（21章の予定）。

## 手元で動かす

<!-- section: 04.local -->

`examples/04-http-api/.env.example` を、同じディレクトリに `.env` としてコピーします。

<<< @/examples/04-http-api/.env.example

```bash
vp run dev:api
```

<http://localhost:8787> で API が動きます。別のターミナルから呼んでみます。

```bash
curl -s http://localhost:8787/health
curl -s -X POST http://localhost:8787/notes -H 'content-type: application/json' -d '{"title":"first note"}'
curl -s http://localhost:8787/notes
curl -s -X POST http://localhost:8787/notes -H 'content-type: application/json' -d '{"title":""}'
```

最後の 1 つは、`code` が `invalid_request` で、`issues` に `title` を含む 400 になります。ターミナルには、リクエストごとに JSON が 1 行ずつ出ます。ソースを保存すると、プロセスが自動で再起動します。

このローカルサーバーの入口は、次のファイルです。

<<< @/examples/04-http-api/src/dev.ts{dev}

Docker も、AWS の認証情報も、課金もありません。その代わり、次のものは再現しません。

| 再現しないもの | 実環境での意味 |
| --- | --- |
| API Gateway のイベント形式と route | 定義していない path は、Lambda に届く前に API Gateway が 404 を返す |
| Lambda の timeout とメモリの上限 | 10 秒を超えた処理は打ち切られる |
| IAM の実行 role | 許可していない AWS の操作は拒否される |
| 実行環境の生成と破棄 | メモリの内容は呼び出しをまたいで残るとは限らない |
| API Gateway の CORS 設定 | preflight は Lambda に届く前に API Gateway が応答する |

### もう一段、実環境に近づける

cdkd には、synth した template を読んで、API Gateway と Lambda をローカルのコンテナで動かす機能があります。

```bash
vp run dev:api:cdkd
```

これは **Docker の daemon が動いていること**が前提です。devShell に入っているのは Docker とは無関係のツールだけなので、Docker Desktop などを別に起動しておきます。

固定した版のソースとドキュメントによると、この機能は API Gateway の HTTP API のイベント形式で handler を呼び、ソースの変更で synth し直します。一方で、handler を動かすコンテナには既定で**開発者自身の認証情報**が渡されます。handler の中で AWS SDK を呼ぶと、ローカルで動いているのに、実際の AWS に届き、課金もされます。しかも実行 role ではなくあなたの権限で動くので、ここで動いたことは「デプロイ後も権限が足りる」ことを意味しません。この章の handler は AWS を呼ばないので影響はありませんが、05章以降では意識する必要があります。

このタスクは実行して確かめていません。**未検証**です。

## テストする

<!-- section: 04.tests -->

```bash
vp run test:unit
```

テストは 3 つの層に分かれています。それぞれ、確かめられることが違います。

| 層 | ファイル | 確かめること | 確かめられないこと |
| --- | --- | --- | --- |
| アプリ | `test/app.test.ts` | 入力の検証、エラーの形、request ID、CORS | Lambda と API Gateway を通ったときの挙動 |
| client | `test/client.test.ts` | client とサーバーの契約。契約を破る応答の扱い | 実際のネットワーク |
| インフラ | `infra/test/http-api-stack.test.ts` | template の権限、ログの保持、timeout、route | AWS がその template どおりに動くこと |

アプリのテストは、ソケットを開きません。Hono のアプリに `Request` を直接渡します。時刻と ID は決まった値です。

client のテストは、モックを手で書きません。本物のアプリの `fetch` 処理を、client の通信手段として渡します。サーバーの実装を変えて契約が崩れると、このテストが落ちます。

型付きの client は次のとおりです。

<<< @/examples/04-http-api/src/client.ts{client}

`hc<App>` は、サーバーの route、パラメーター、レスポンスの型を、コンパイル時に client へ伝えます。path を打ち間違えると、型エラーになります。

ただしこの型は、**このリポジトリにあるコード**についての主張です。実際に応答するサーバーが同じ版だとは限りません。古いデプロイかもしれないし、途中の proxy がエラーページを返すかもしれません。そこで client は、受け取った応答を schema で検証してから、型の付いた値として返します。「200 だが形が違う」「502 で HTML が返る」という場合のテストも入れてあります。

守っている性質のうち、分散システムとして大事なものを 1 つ挙げます。

**2 つのアプリのインスタンスは、ノートを共有しない。** テストの最後の 1 件は、インスタンスを 2 つ作り、片方に書いたノートがもう片方から見えないことを確かめます。これは不具合の検出ではなく、この章の実装の限界を仕様として固定するものです。理由は次の節で説明します。

## 状態はどこにあるか

<!-- section: 04.state -->

Lambda は、関数を実行環境（execution environment）という隔離された場所で動かします。実行環境は、最初の呼び出しのときに作られて初期化されます。これを cold start と呼びます。そのあとしばらくは同じ実行環境が再利用されます。

<<< @/examples/04-http-api/src/lambda.ts{handler}

`composeApp` はファイルの最上位にあります。ここは、リクエストごとではなく、実行環境ごとに 1 回だけ実行されます。`InMemoryNoteRepository` の `Map` も、そのとき 1 つ作られます。

何が起きるかを時系列で見ます。

```text
time  request            execution environment A      execution environment B
t1    POST /notes  -->   created; Map = {n1}
t2    GET /notes   -->   reused;  returns [n1]
t3    GET /notes   --->  (busy with another request)  created; Map = {}; returns []
t4    (idle for a while) discarded; n1 is gone
```

- **t3**: 実行環境 A が別のリクエストを処理している間に次のリクエストが来ると、Lambda は 2 つ目の実行環境を作ります。そこには `n1` がありません。t2 と同じ URL を呼んだのに、結果が違います。
- **t4**: 使われない実行環境は、いずれ破棄されます。メモリの内容も消えます。

Lambda のメモリに置いたものは、cache としては使えますが、**データの持ち主にはなれません**。この章の状態の持ち主は「個々の実行環境」で、それは 1 つではなく、いつ消えるかも選べません。05章で DynamoDB を足すと、状態の持ち主が table になり、どの実行環境から読んでも同じ答えになります。

この挙動を、デプロイした API で観察できます。

```bash
vp run api:smoke
```

このタスクは、型付きの client でノートを 1 件作り、すぐに読み戻します。読み戻しが別の実行環境に届いた場合は 404 になり、タスクはそれを「別の実行環境が応答した」と表示します。これは失敗として扱いません。この章の実装ではそうなり得る、というのが正しい期待だからです。

## インフラを定義する

<!-- section: 04.infra -->

### ログ

<<< @/examples/04-http-api/infra/lib/http-api-stack.ts{logs}

log group を明示的に作ります。作らずにおくと、Lambda が最初の実行時に自動で作ります。その log group は保持期間が無期限で、stack を消しても残ります。保存量に料金がかかり続けるうえに、どの stack のものか分からなくなります。

### 実行 role

<<< @/examples/04-http-api/infra/lib/http-api-stack.ts{role}

実行 role（execution role）は、関数が AWS 上で動くときに引き受ける IAM role です。**あなた自身の権限とは別物**です。手元で `aws` コマンドが通ることは、Lambda の中の同じ操作が通ることを意味しません。

CDK は、何も指定しなければ `AWSLambdaBasicExecutionRole` という管理ポリシーを付けます。これは、アカウント内のどの log group にも書ける権限です。ここでは role を自分で作り、上で作った 1 つの log group への書き込みだけを許可します。テストは、許可される操作がこの 2 つ（`logs:CreateLogStream`、`logs:PutLogEvents`）だけであること、対象が `*` でないことを確かめます。

05章で DynamoDB を足すとき、この role に table への権限を 1 つ加えます。「関数が何をできるか」が、この数行に集まります。

### 関数

<<< @/examples/04-http-api/infra/lib/http-api-stack.ts{function}

`NodejsFunction` は、synth のときに esbuild で TypeScript を 1 つの JavaScript ファイルにまとめます。Docker は使いません。

`timeout` は 10 秒です。HTTP API は Lambda の応答を最大 30 秒しか待たず、この上限は引き上げられません。関数の timeout をそれより長くすると、呼び出した側がもう待っていない処理を、料金を払って続けることになります。テストは、timeout が 30 秒未満であることを確かめます。

`architecture` は arm64 です。東京リージョンでは、実行時間の単価が x86 より安くなります（1 GB 秒あたり USD 0.0000133334 と USD 0.0000166667）。

### API

<<< @/examples/04-http-api/infra/lib/http-api-stack.ts{api}

route を 1 つずつ列挙しています。「すべての path を Lambda に渡す」という書き方もできますが、そうすると、存在しない path へのアクセスでも関数が起動し、料金がかかります。列挙しておけば、それ以外は API Gateway が 404 を返します。

その代わり、route は 2 か所に書かれます。Hono のアプリと、この stack です。片方だけ直すとずれるので、テストが「stack の route は、この 5 つちょうどである」ことを確かめます。

CORS は、ブラウザが別の origin から API を呼ぶことを許可する設定です。許可する origin は 1 つだけで、既定は SPA の開発サーバーです。03章の SPA から呼ぶときは、デプロイ時に CloudFront の URL を渡します。

## デプロイして呼ぶ

<!-- section: 04.deploy -->

```bash
vp run api:infra:diff
vp run api:infra:deploy
```

終わると `ApiUrl` に `https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com` の形の URL が出ます。

```bash
curl -s https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com/health
vp run api:smoke
```

03章の SPA の origin を許可するには、context で渡します。

```bash
vp run api:infra:deploy -c allowedOrigin=https://dxxxxxxxxxxxx.cloudfront.net
```

SPA の画面をこの API につなぐ変更は、この章ではまだ行いません。メモリに置いたノートを画面に出しても、前の節で見たとおり、再読み込みのたびに結果が変わるだけだからです。保存先ができる 05章と、誰のノートかを区別できる 06章で、順につなぎます。

## ログを見る

<!-- section: 04.observe -->

```bash
vp run api:logs
vp run api:logs --follow
```

このタスクは、stack の output から log group の名前を取り、AWS CLI の `aws logs tail` を実行します。AWS を読みますが、変更はしません。

ログは 1 行が 1 つの JSON です。

<<< @/examples/04-http-api/src/log.ts{logger}

1 件のリクエストを追う手順は決まっています。

1. 応答の `x-request-id` ヘッダー、またはエラー本文の `requestId` を控える
2. その値でログを検索する
3. `status`、`durationMs`、エラーなら `error` のスタックトレースを読む

テストは、同じ ID が応答ヘッダー、エラー本文、ログの 3 か所に出ることを確かめます。

Lambda 自身も、呼び出しごとに `START`、`END`、`REPORT` の行を書きます。`REPORT` には実行時間、課金対象の時間、使ったメモリの最大値が出ます。cold start のときは `Init Duration` が加わります。メトリクス、アラーム、複数のサービスをまたぐ trace は 19章で扱う予定です。

## drift を確かめる

```bash
vp run api:infra:drift
```

02章と同じ gate です。この stack のリソースは、どれも固定した版の cdkd が専用の実装で扱う種類です。実際の AWS での結果は確かめていません。

## Workers に慣れた人へ

<!-- section: 04.workers -->

Cloudflare Workers で API を書いたことがあるなら、ここまでの流れは見覚えがあるはずです。違いが出るところを並べます。

| | Cloudflare Workers | この章（Lambda と API Gateway） |
| --- | --- | --- |
| 手元での実行 | `wrangler dev` か Vite plugin。Miniflare が本番と同じ runtime（workerd）で動かす | `vp run dev:api` は Node.js の HTTP サーバー。Lambda の runtime ではない。近づけるには `dev:api:cdkd`（Docker が必要） |
| 他のサービスとの接続 | binding。設定に宣言すると `env` に現れる。手元では既定でローカルの模擬に接続する | AWS SDK で呼ぶ。接続先は環境変数で渡し、権限は実行 role に書く。手元の模擬は用意されない |
| 権限 | binding を宣言したものに触れる | IAM。role に書いた操作だけが通る。手元の権限とデプロイ後の権限は別 |
| 実行場所 | Cloudflare のネットワーク上 | 1 つのリージョン（この本では東京） |
| 入口 | Worker 自体が HTTP を受ける | API Gateway が受けて Lambda に渡す。入口と関数は別のリソースで、料金も別 |
| デプロイ | `wrangler deploy` | synth して template にし、cdkd（または CloudFormation）が反映する |

Workers 側の記述は、Cloudflare の公式ドキュメント（確認日 2026-10-11）に基づきます。

AWS のほうが部品が多いのは事実です。入口、関数、role、log group を、それぞれ自分で定義します。その代わり、各部品の設定を個別に選べます。どちらが良いかは、作るものによります。この本は、Workers をやめることを勧めていません。

CloudFront Functions（03章）は、名前が似ていますが Workers の対応物ではありません。ネットワークにもファイルシステムにも触れず、URL やヘッダーを書き換えるためのものです。

## 料金

金額は USD、東京リージョン、従量課金、税別です。計算の入力と単価は[料金の計算](/ja/reference/pricing.md)にあります。

**使われていないとき。** 0 です。API Gateway の HTTP API にも Lambda にも、存在するだけでかかる料金はありません。ログは 7 日で消えます。

**使われたとき。** 月 100 万リクエスト、平均実行時間 50 ミリ秒、256 MB、arm64、1 リクエストあたりログ 0.5 KB と仮定した計算です。

| 対象 | 数量 | 定価 | 毎月の無料枠の適用後 |
| --- | --- | --- | --- |
| API Gateway HTTP API のリクエスト | 100 万件 | 1.29 | 1.29（無料枠は確認できず、引いていない） |
| Lambda のリクエスト | 100 万件 | 0.20 | 0 |
| Lambda の実行時間 | 12,500 GB 秒 | 0.17 | 0 |
| CloudWatch Logs の取り込み | 0.477 GB | 0.36 | 0 |
| CloudWatch Logs の保存 | 0.111 GB 月 | 0.00 | 0 |
| 小計 | | **2.02** | **1.29** |

この表と同じ数字が出ることを、テストで確かめています。

無料枠は、Lambda が月 100 万リクエストと 40 万 GB 秒、CloudWatch Logs が 5 GB です。アカウント全体で共有されます。Lambda の料金ページには、この枠に期限があるかどうかは書かれていません。

この計算に入っていないのは、応答をインターネットへ送るデータ転送の料金です。未算入であって、0 ではありません。

実行時間の仮定（50 ミリ秒）は計測値ではありません。あなたの関数の値は、ログの `REPORT` 行で分かります。

**消した後。** 何も残りません。log group も stack と一緒に消えます。

## うまくいかないとき

| 症状 | 確かめること |
| --- | --- |
| `dev:api` が `Invalid environment` で止まる | `examples/04-http-api/.env` があるか。メッセージに出た変数名を確かめる |
| デプロイ後、すべての応答が 500 で、`x-request-id` ヘッダーが無い | 関数が初期化で失敗している。`vp run api:logs` で `Invalid environment` や import のエラーを探す |
| `{"message":"Not Found"}` が返る | API Gateway の応答。stack に無い path を呼んでいる。この本のエラーの形（`error.code`）ではない点で見分けられる |
| 一部の応答だけが、`x-request-id` ヘッダーの無いエラーになる | 関数が timeout したか、途中で異常終了した。ログの `REPORT` 行で実行時間を見る |
| ブラウザから呼ぶと CORS のエラーになる | デプロイ時の `allowedOrigin` が、呼び出し元の origin（scheme とポートを含む）と完全に一致しているか |
| 作ったノートが `GET /notes` に出ない | 別の実行環境が応答した。「状態はどこにあるか」の節のとおり、この章の仕様 |
| 新しいアカウントで同時実行のエラーが出る | 新しいアカウントは Lambda の同時実行数の上限が低く設定されている。Service Quotas で確かめる |

エラーの応答が API Gateway のものか、あなたのアプリのものかを最初に見分けると、探す場所が半分になります。`x-request-id` ヘッダーがあればアプリまで届いています。

## 本番に進めるなら

- **認証と認可を足す。** いまは誰でも呼べます（06章の予定）。
- **データを永続化する。** いまは消えます（05章の予定）。
- **流量を制限する。** HTTP API の stage には throttling の設定があります。この章では既定のままです。上限のない公開 API は、料金の上限もありません。
- **アラームを設定する。** エラー率と実行時間を監視します（19章の予定）。
- **ログの保持期間を決める。** 7 日は学習用の値です。必要な期間と保存料金を比べて決めます。
- **反映の経路を AWS CDK CLI と CloudFormation にする。** 02章で述べたとおりです。
- **同時実行数の上限を確かめる。** 既定の上限はリージョンごとに 1,000 で、アカウント内の全関数で共有されます。新しいアカウントは、それより低い値から始まります。

## 片付け

<!-- section: 04.cleanup -->

```bash
vp run api:infra:destroy
```

関数、role、API、log group が消えます。log group は `removalPolicy` を `DESTROY` にしてあるので、ログも一緒に消えます。

残るのは、cdkd の bootstrap で作った保存場所（02章）と、そこに置かれたデプロイ用のファイルだけです。

## この章の検証状況

- アプリ、client、インフラのユニットテスト、型検査、synth（esbuild による bundle を含む）、`dev:api` での起動と上記の `curl` は、**ローカル検証済み**です。
- `dev:api:cdkd`、`api:infra:deploy`、`api:smoke`、`api:logs`、`api:infra:drift`、`api:infra:destroy` は実行していません。**未検証**です。
- とくに次の点は、実環境で確かめる必要があります。Node.js 24 の Lambda runtime で bundle が動くこと。API Gateway が返すエラーの状態コードと本文（上の表の `Not Found` など）。関数が timeout したときに呼び出し側へ返る応答。実行環境が複数になったときの `api:smoke` の表示。

## この章のソース対応

| 節 | 対応するファイル | タスク |
| --- | --- | --- |
| 契約を 1 か所に書く | `examples/04-http-api/src/contract.ts` | `test:unit` |
| アプリを書く | `examples/04-http-api/src/app.ts`、`src/notes.ts`、`src/compose.ts`、`src/log.ts` | `test:unit` |
| 設定を検証する | `examples/04-http-api/src/env.ts`、`test/env.test.ts`、`.env.example` | `test:unit` |
| 手元で動かす | `examples/04-http-api/src/dev.ts` | `dev:api`、`dev:api:cdkd` |
| テストする | `examples/04-http-api/test/app.test.ts`、`test/client.test.ts`、`src/client.ts` | `test:unit` |
| 状態はどこにあるか | `examples/04-http-api/src/lambda.ts`、`src/notes.ts`、`scripts/smoke.ts` | `api:smoke` |
| インフラを定義する | `examples/04-http-api/infra/lib/http-api-stack.ts`、`infra/bin/app.ts`、`infra/test/http-api-stack.test.ts`、`cdk.json` | `api:infra:synth`、`test:unit` |
| デプロイして呼ぶ | `tools/src/infra/`、`examples/04-http-api/scripts/smoke.ts` | `api:infra:diff`、`api:infra:deploy`、`api:smoke`、`api:infra:drift` |
| ログを見る | `examples/04-http-api/src/log.ts`、`scripts/logs.ts` | `api:logs` |
| 片付け | `tools/src/infra/` | `api:infra:destroy` |
| 料金 | `data/pricing/`、`tools/src/pricing/calc.test.ts` | `test:unit` |

## 一次情報

- [Choose between REST APIs and HTTP APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vs-rest.html)（確認日 2026-10-11）
- [Quotas for HTTP APIs in API Gateway](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-quotas.html)（確認日 2026-10-11）
- [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)（確認日 2026-10-11）
- [AWS Lambda pricing](https://aws.amazon.com/lambda/pricing/)（確認日 2026-10-11）
- AWS Price List bulk API: [Lambda](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/ap-northeast-1/index.json)、[API Gateway](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonApiGateway/current/ap-northeast-1/index.json)、[CloudWatch](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/ap-northeast-1/index.json)（確認日 2026-10-11）
- [Cloudflare Workers: Local development](https://developers.cloudflare.com/workers/local-development/)（確認日 2026-10-11）
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)（確認日 2026-10-11）
