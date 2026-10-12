---
title: "48 SDK: 費用、注意点、片付け"
---

# 48 SDK: 費用、注意点、片付け

## 料金

<!-- section: 48.cost -->

この章は AWS のリソースを 1 つも作りません。スタックがなく、タスクも手元のサーバーにしか届かないので、料金はかかりません。片付けるものもありません。

SDK そのものにも料金はありません。料金がかかるのは、SDK が送ったリクエストを受けたサービスの側です。その点で、再試行は費用にも関係します。3 回試行した呼び出しは、サービスから見れば 3 件のリクエストです。断られたリクエストや失敗したリクエストに料金がかかるかどうかはサービスごとに違い、この章では確かめていません。

試行ごとのログも、費用を増やします。この章のミドルウェアは試行 1 回につき 1 行を書くので、ふだんは呼び出し 1 回につき 1 行、障害のときはその 3 倍です。CloudWatch Logs の料金は [19章](/ja/chapters/19-observability/wrap.md)にあります。量が気になるなら、成功した 1 回目の試行は書かず、再試行と失敗だけを残します。

## 注意点

<!-- section: 48.pitfalls -->

この章で確かめたことのうち、知らないと困るものを並べます。どれも、固定している版でテストが固定している挙動です。

| 起きること | 理由と対処 |
| --- | --- |
| 答えないエンドポイントで、呼び出しが関数のタイムアウトまで戻らない | 既定のクライアントにはタイムアウトがありません。`requestHandler` に数字を書きます |
| `requestTimeout` を設定したのに、時間を過ぎても戻らない | 警告が出るだけです。`throwOnRequestTimeout: true` を一緒に指定します |
| `AbortSignal` で打ち切ったのに、戻るまで時間がかかる | 再試行の前の待ち時間は、打ち切りでは短くなりません |
| 手元では動くのに、`Region is missing` になる | SDK は `AWS_DEFAULT_REGION` を読みません。`AWS_REGION` か、コードで渡します |
| 思っていたのと違う認証情報で動く | `AWS_PROFILE` があると、環境変数のキーより優先されます。`vp run sdk:credentials` で確かめます |
| ウェイターが、権限がないのに時間切れで終わる | 例外をすべて「まだ」と解釈します。同じ操作を 1 回、直接呼んで例外を見ます |
| 更新したはずの属性が消える | アイテム直下の `undefined` は、例外にならず送られません。Put は丸ごと置き換えます |
| API が `bigint` を JSON にできず 500 になる | 大きな整数の `N` は `bigint` で返ります。`wrapNumbers` を検討します |
| ストリームを渡したアップロードが、1 回の失敗で諦める | ストリームの本文は再試行されません。再試行させたいなら、バイト列で渡します |
| 接続が足りなくなる | `Body` を読み切るか破棄するまで、接続は空きません |
| 署名付き URL が、指定した期限より早く切れる | 署名に使った認証情報が先に切れています |
| 環境変数 1 つで、クライアントが別の場所と話す | `AWS_ENDPOINT_URL` と、サービスごとの `AWS_ENDPOINT_URL_…` です |

## 本番にするなら

<!-- section: 48.production -->

クライアントの設定は、既定に任せず、書きます。試行回数、モード、接続と応答のタイムアウトです。書いておけば、最悪の所要時間を計算でき、SDK の既定が変わった日に挙動が変わりません。[しくみと実装](/ja/chapters/48-sdk/build.md)の方針は DynamoDB への短い呼び出しのためのもので、サービスによって数字は変わります。応答に時間のかかる操作に 2 秒は短すぎます。呼び出しの種類ごとに方針を持ち、クライアントを分けます。

呼び出し全体の期限は、呼んだ側の残り時間から作ります。API Gateway の統合のタイムアウトや、Lambda の残り時間を超えて待っても、答えを受け取る相手はもういません。関数の残り時間から期限を作る話は [29章](/ja/chapters/29-lambda-tuning.md)にあります。

2026 年の再試行の動作は、既定になるのを待たずに、自分で決めて切り替えます。まず検証用の環境で `AWS_NEW_RETRIES_2026=true` を設定し、ログの試行回数と所要時間を見ます。スロットリングのあとの待ちが 2 倍になるので、タイムアウトの計算もやり直します。試行回数を書いてあれば、DynamoDB の 4 回目は入りません。

SDK の版は固定し、関数と一緒にバンドルします。SDK の README によると、Lambda のランタイムに入っている SDK は特定の版で、最新とは限りません。ランタイムの更新で SDK の版が変われば、この章で固定した既定値も変わりえます。自分でバンドルしていれば、変わるのは自分が上げたときだけで、そのときはテストが知らせます。

SDK が使い切った失敗は、呼び出し元にそのまま 500 で返さず、分類して返します。待てば通る失敗は 503 と `Retry-After` にします。そうしないと、呼び出し元の再試行が、不具合に対しても行われます。

長期のアクセスキーは使いません。実行ロール、タスクロール、インスタンスプロファイルは、どれもチェーンの中で自動的に見つかり、期限が来れば取り直されます。コードにも環境変数にも、キーを書く必要がありません。

## 分散システムとして

<!-- section: 48.distributed -->

SDK の再試行は、同じリクエストをもう一度送ることです。1 回目が届かなかったのか、届いて実行されたあとで応答だけが失われたのかを、SDK は区別できません。区別できないまま、もう一度送ります。この章の不変条件は、これを言い直したものです。

**1 回の `send` は、サービスの側で 1 回以上実行されうる。**

壊すテストは、応答が失われる順序を決めて再現します。台本は、届いたリクエストを数えて 1 を足し、1 件目には答えず、2 件目に答えます。クライアントは 50 ミリ秒で時間切れにして再試行するので、`ADD noteCount :one` を 1 回 `send` しただけで、数は 2 になりました。アプリのコードには再試行が 1 行もありません。足しているのは SDK です。

足されるのは台本の中の変数で、DynamoDB ではありません。本物の DynamoDB で確かめてはいませんが、`UpdateItem` の `ADD` は、届くたびに足す操作です。05章のノートの件数は、この形で数えています。応答を失った再試行があれば、件数は実際より 1 多くなるはずです。05章が「ずれるとしたら、入る件数が少なくなる側だけ」と書いたのと同じ向きなので、100 件を超えないという約束は破れません。

守り方は、05章と 08章で見たとおりです。同じリクエストが 2 度届いても結果が変わらない形にします。条件付き書き込みで版を比べる、冪等性キーを持つ、のどちらかです。05章の更新は版を比べているので、SDK が黙って再試行しても、2 度目は条件で断られます。

再試行を止める、という選択もあります。`maxAttempts: 1` にすると、同じ台本で数は 1 のままで、呼び出し元には時間切れが返りました。ただし、呼び出し元がわかるのは「わからない」ということだけです。書き込みが済んだかどうかは、読み直して確かめるしかありません。

状態の持ち主についても、1 つ書いておきます。再試行の予算、開いている接続、覚えている認証情報は、どれもクライアントの中、つまり 1 つのプロセスの中にあります。Lambda の実行環境が 100 あれば、予算も 100 あります。SDK の予算は、1 つのプロセスが障害のときに無駄な再試行を続けないためのもので、全体の再試行の量を抑えるものではありません。全体を抑えるのは、32章で置いた入口のスロットリングです。

::: details この章の検証メモ

**手元で確かめたこと。** 固定している版の SDK の既定値（`standard`、3 回、基準 100 ミリ秒と 500 ミリ秒、予算 500、タイムアウトなし、keep-alive、50 本）を、別のプロセスで設定を切り離して読み、定数と比べました。`AWS_NEW_RETRIES_2026=true` と `SMITHY_NEW_RETRIES_2026=true` で値が変わること、`1` や `TRUE` では変わらないこと、`AWS_MAX_ATTEMPTS` が優先されること。再試行されるエラーとされないエラー、試行ごとのヘッダーと署名、待ち時間の合計、`x-amz-retry-after`、予算が尽きて戻ること、予算がクライアントごとであること。答えないエンドポイントに対する 4 通りの設定、`AbortSignal`、接続の再利用と上限。例外のクラスとフィールド、分類。ページネーターとその打ち切り、ウェイターの成功、時間切れ、権限エラー、打ち切り。`Body` の読み方、上限つきの読み取り、ストリームの本文が再試行されないこと、`Upload` の 3 つの場合。署名付き URL が通信なしで作られること、期限、セッショントークン、`PutObject` のチェックサム。ドキュメントクライアントの変換。試行ごとのログとその位置。認証情報のチェーンの順序、`AWS_PROFILE` の優先、リージョンとエンドポイントの環境変数。応答を失った書き込みが 2 度送られること（11 ファイル、104 件）。型検査。`vp run sdk:tour`、`vp run sdk:defaults`（環境変数なしと `AWS_NEW_RETRIES_2026=true`）、偽のキーを環境変数に入れた `vp run sdk:credentials`。どれも Node.js 24.21.0 で、相手は手元のサーバーです。

**まだ確かめていないこと。** AWS は 1 度も呼んでいません。次は、ソースかドキュメントで読んだだけです。

- 本物のサービスが返すエラーの形、ステータス、リクエスト ID、`x-amz-retry-after` の有無
- HTTPS のエンドポイントでの接続の挙動と、`connectionTimeout`。手元のサーバーは平文の HTTP です
- `adaptive` モード。ソースを読んだだけで、動かしていません
- 2026 年の動作で DynamoDB Streams のクライアントも 4 回になること。DynamoDB の基準が 25 ミリ秒であることは、クライアントが持つ値を読みましたが、その値で待つところは計っていません
- 新しい再試行の動作が、いつ既定になるか。読んだページには書かれていませんでした
- Lambda、ECS、EC2 の中での認証情報の取得。IAM Identity Center、`aws login`、ロールの引き受け、`credential_process`、Web identity の取得元。テストが通したのは、環境変数とプロファイルの静的なキーだけです
- Lambda の実行ロールの認証情報に、関数が受け取った時点で残りがどれだけあるか。署名付き URL が認証情報の失効で切れるところ
- `PutObject` の署名付き URL に入る空の本文のチェックサムが、実際のアップロードに何をするか
- ブラウザでの SDK。リクエストハンドラーが `fetch` になり、この章のタイムアウトと接続の話は当てはまりません
- `aws-sdk-client-mock` が、固定している版の SDK と動くか。導入していません
- Cloudflare の binding が、再試行とタイムアウトをどこまで受け持つか
- 断られたリクエストや失敗したリクエストに、各サービスが料金をかけるか
- DynamoDB の `UpdateItem` が、同じ `ADD` を 2 度受け取って 2 度足すところ。台本の変数で再現しただけです

**ドキュメントとソースの食い違い。** 開発者ガイドの認証情報の表は `fromLoginCredentials` を独立した段として載せていますが、`@aws-sdk/credential-provider-node` 3.972.85 のチェーンにその段はありません。リファレンスの再試行のページは 2026 年の動作だけを説明していて、オプトインしないときの数字（100 ミリ秒、500 ミリ秒、費用 10 と 5）は載っていません。この章の数字は導入済みのパッケージのものです。`x-amz-retry-after` は、同じページでは新しい動作の一部として書かれていますが、導入済みの版はオプトインなしで従います。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 全体像、クライアントとコマンド、手元のエンドポイント | `examples/48-sdk/src/local-endpoint.ts`、`scripts/tour.ts` | `test:unit` |
| ミドルウェア | `examples/48-sdk/src/attempt-log.ts`、`test/attempt-log.test.ts`、`scripts/tour.ts` | `test:unit`、`sdk:tour` |
| 認証情報、リージョンとエンドポイント | `examples/48-sdk/src/credentials.ts`、`test/credentials.test.ts`、`scripts/credentials.ts` | `test:unit`、`sdk:credentials` |
| 再試行 | `examples/48-sdk/src/defaults.ts`、`test/defaults.test.ts`、`test/retry.test.ts`、`scripts/defaults.ts` | `test:unit`、`sdk:defaults` |
| タイムアウトと中断 | `examples/48-sdk/src/call-policy.ts`、`test/timeouts.test.ts` | `test:unit` |
| エラー | `examples/48-sdk/src/errors.ts`、`test/errors.test.ts` | `test:unit` |
| ページネーターとウェイター | `examples/48-sdk/src/pages.ts`、`test/pages-waiters.test.ts` | `test:unit` |
| ストリーム | `examples/48-sdk/src/body.ts`、`test/streams.test.ts` | `test:unit` |
| 署名付き URL | `examples/48-sdk/test/presign.test.ts` | `test:unit` |
| DynamoDB の値の変換 | `examples/48-sdk/src/document.ts`、`test/document.test.ts` | `test:unit` |
| テスト | `examples/48-sdk/test/support.ts` | `test:unit` |
| 分散システムとして | `examples/48-sdk/test/lost-response.test.ts` | `test:unit` |

**cdkd での扱い。** この章にスタックはありません。

**一次情報**（確認日は 2026-10-13）

- 導入済みのパッケージのソース: [@smithy/core 3.35.2](https://www.npmjs.com/package/@smithy/core/v/3.35.2)、[@aws-sdk/core 3.978.2](https://www.npmjs.com/package/@aws-sdk/core/v/3.978.2)、[@aws-sdk/client-dynamodb 3.1149.0](https://www.npmjs.com/package/@aws-sdk/client-dynamodb/v/3.1149.0)、[@smithy/node-http-handler 4.12.1](https://www.npmjs.com/package/@smithy/node-http-handler/v/4.12.1)、[@aws-sdk/credential-provider-node 3.972.85](https://www.npmjs.com/package/@aws-sdk/credential-provider-node/v/3.972.85)
- [Retry behavior](https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html)、[Login credentials provider](https://docs.aws.amazon.com/sdkref/latest/guide/feature-login-credentials.html)、[Dual-stack and FIPS endpoints](https://docs.aws.amazon.com/sdkref/latest/guide/feature-endpoints.html)（AWS SDKs and Tools Reference Guide）
- [Set credentials in Node.js](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html)、[Load credentials for a Node.js Lambda function](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/loading-node-credentials-lambda.html)、[Reuse connections with keep-alive in Node.js](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/node-reusing-connections.html)、[Configure maxSockets in Node.js](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/node-configuring-maxsockets.html)（AWS SDK for JavaScript v3 Developer Guide）
- aws-sdk-js-v3 のリポジトリ、タグ v3.1149.0: [README](https://github.com/aws/aws-sdk-js-v3/blob/v3.1149.0/README.md)、[SDK Clients](https://github.com/aws/aws-sdk-js-v3/blob/v3.1149.0/supplemental-docs/CLIENTS.md)、[Error Handling](https://github.com/aws/aws-sdk-js-v3/blob/v3.1149.0/supplemental-docs/ERROR_HANDLING.md)、[lib-storage](https://github.com/aws/aws-sdk-js-v3/blob/v3.1149.0/lib/lib-storage/README.md)、[lib-dynamodb](https://github.com/aws/aws-sdk-js-v3/blob/v3.1149.0/lib/lib-dynamodb/README.md)、[s3-request-presigner](https://github.com/aws/aws-sdk-js-v3/blob/v3.1149.0/packages/s3-request-presigner/README.md)
- [Working with Lambda environment variables](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html)、[Download and upload objects with presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)
- [aws-sdk-client-mock（npm のレジストリ）](https://registry.npmjs.org/aws-sdk-client-mock)
- [Cloudflare Workers: Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/)

:::
