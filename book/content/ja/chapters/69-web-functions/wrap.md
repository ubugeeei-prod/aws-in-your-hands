---
title: "69 Web Functions: 費用、注意点、片付け"
---

# 69 Web Functions: 費用、注意点、片付け

[最初のページ](/ja/chapters/69-web-functions.md)から[デプロイのページ](/ja/chapters/69-web-functions/deploy.md)までで作った構成について、費用、つまずきやすい点、本番にするときに足すもの、Cloudflare と Vercel にある同じ形の機能との違い、片付けの手順をまとめます。

## 費用

<!-- section: 69.costs -->

金額は USD、東京リージョンの定価、税別です。1 か月は 730 時間（2,628,000 秒）として計算しています。計算の入力と単価は[料金の計算](/ja/reference/pricing.md)にあります。単価は、2026-10-12 に公開された AWS Price List のものです。

課金されるものは 4 つあります。

- **リクエスト。** 100 万件あたり 0.30 です。Event Function は 0.20 なので、ここだけを見ると高くなります
- **CPU 時間。** コードが実際に CPU を使っていた時間に、1 vCPU 秒あたり 0.0000322421 がかかります。データベースの応答を待っている時間は入りません
- **メモリ。** 実行環境が使っているメモリに、1 GB 秒あたり 0.0000042688 がかかります。リクエストを処理していない時間も、実行環境が存在するあいだは続きます
- **データ転送。** AWS のふつうのデータ転送の料金です

このほかに、ログの書き込みと保存の料金（CloudWatch Logs）と、パッケージを置く S3 の料金がかかります。ログは 2 つのロググループに入りますが、書き込みの料金は 1 回分で、保存の料金が 2 か所分です。Lambda が出すメトリクスは無料です。

**このスタックを置いたまま、1 件も呼ばれない月は 0.00 です。** エンドポイントは実行環境を 0 まで減らすので、リクエスト、CPU 時間、メモリのどれも 0 になります。残るのは 8.3 KiB のパッケージの保存料で、0.0000002 にしかなりません。[35章](/ja/chapters/35-lambda-managed-instances.md)の Lambda Managed Instances や [12章](/ja/chapters/12-containers.md)の Fargate と違って、置いてあるだけの料金はありません。

使ったときの金額を、04章の「月 100 万リクエスト、1 件 50 ミリ秒」と同じ通信量で比べます。

| | リクエスト | 計算 | メモリ | ログ | 合計 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 04章: Event Function（256 MB）と HTTP API | 1.49 | 0.17 | | 0.37 | 2.02 |
| Web Function: CPU 時間が 12 ミリ秒 | 0.30 | 0.39 | 1.68 | 0.37 | 2.74 |
| Web Function: CPU 時間が 50 ミリ秒 | 0.30 | 1.61 | 1.68 | 0.37 | 3.96 |

04章の行のリクエストは、HTTP API の 1.29 と Lambda の 0.20 を足したものです。合計は、四捨五入する前の値を足しているので、行の数字の和と 0.01 ずれることがあります。

Web Function の 2 行は、次の仮定に立っています。どれも計測した値ではありません。

- 実行環境が 1 つ、1 か月動き続ける。AWS の料金ページの計算例も同じ置き方をしています。リクエストが途切れたあと実行環境がどれだけ残るかは、公式ドキュメントに書かれていません
- 実行環境が使うメモリは 0.15 GB。料金ページのいちばん軽い例が 0.14 GB です
- CPU 時間は、1 行目が 50 ミリ秒のうち 12 ミリ秒（料金ページの計算例の割合）、2 行目が 50 ミリ秒すべて

この表からわかるのは、通信量の少ない API では、Web Function のほうが高くなりうる、ということです。リクエストの料金は 1.19 安くなりますが、実行環境が残っているあいだのメモリの料金がそれを上回ります。実行環境が 1 か月のうち 1 割の時間しか存在しないなら、メモリは 0.17 で済み、CPU 時間が 12 ミリ秒の行の合計は 1.23 になって、04章より安くなります。どちらに近いかは、デプロイして実行環境の数のメトリクスを見るまでわかりません。

無料利用枠を引いた後の金額は、04章が 1.29、Web Function が 2.37 と 3.59 です。Event Function には毎月 100 万リクエストと 40 万 GB 秒の枠があります。Web Function に枠があるかどうかは確認できませんでした。料金ページの計算例は「無料利用枠を除く」と書くだけで、枠の内容を示していません。この章では、枠が無いものとして計算しています。

計算の料金だけを取り出すと、境目がはっきりします。Event Function は、メモリの設定に実行時間を掛けた量に課金します。Web Function は、CPU を使った時間に課金します。1 vCPU 秒の単価は 1 GB 秒の単価のおよそ 2.4 倍なので、実行時間のうち CPU を使っている割合が次の値より小さければ、Web Function の計算の料金のほうが安くなります。

- 256 MB の Event Function と比べて、およそ 10%
- 1 GB の Event Function と比べて、およそ 41%
- 2 GB の Event Function と比べて、およそ 83%

データベースや外部の API を待つ時間が長いリクエストほど、Web Function に向きます。逆に、04章のように 256 MB で足りる軽い関数は、待ち時間が 9 割を占めないかぎり、計算の料金では Event Function のほうが安いままです。ただし、256 MB の Event Function に割り当てられる CPU は 1 vCPU の何分の 1 かで、Web Function の実行環境は 2 vCPU です。同じ処理が同じ時間で終わるわけではないので、この比較は目安です。

上限の側も見ておきます。このスタックのブレーキは、`rateLimit` が 100、`maxEnvironments` が 2 です。1 か月のあいだ毎秒 100 件が届き続け、2 つの実行環境が 2 vCPU と 2 GB を使い切った場合、リクエストが 78.84、CPU 時間が 338.93、メモリが 44.87 で、合計 462.64 になります。ログとデータ転送は含めていません。ブレーキは請求の上限を小さくしますが、0 にはしません。予算の通知（[01章](/ja/chapters/01-account.md)）は別に必要です。

## つまずきやすい点

<!-- section: 69.pitfalls -->

**Active は、動いているという意味ではありません。** リビジョンとエンドポイントの状態は、Lambda がリソースを用意できたことを表します。サーバーが起動するかどうかは、最初のリクエストまでわかりません。デプロイのあとには、必ずリクエストを送ります。

**新しいリビジョンは、何も引き継ぎません。** API や CLI でリビジョンを作るときに環境変数を書き忘れると、環境変数の無いリビジョンができます。この章のスタックは毎回すべての設定を書くので起きませんが、コンソールや `aws lambda-web` で手を入れるときは同じ注意が要ります。

**S3 のオブジェクトのバージョンを消すと、リビジョンが壊れます。** リビジョンが指しているバージョンを消すと、リビジョンは Failed になり、元に戻りません。Lambda は、Failed になったリビジョンからリクエストを逃がしてもくれません。エンドポイントがそのリビジョンに流した分は 409 になります。バケットに、古いバージョンを消すライフサイクルルールを足すときは、ロールバックに使うリビジョンのことを先に考えます。

**リビジョンは 50 個を目安に、古いものから消されます。** どのエンドポイントからも使われていないリビジョンが対象です。この章のスタックでは、使わなくなったリビジョンを CloudFormation が先に消すので、この掃除に出会うことはまずありません。

**断られたリクエストは、待たされずに 429 になります。** `rateLimit` を超えたときも、実行環境がすべて埋まったときも同じです。呼び出す側は、間隔を広げながら再試行します。再試行してよいのは、同じリクエストを 2 回処理しても結果が変わらない操作だけです（[08章](/ja/chapters/08-async.md)）。`lambda-web-error-type` の無い 503 も、同じように再試行します。

**`maxEnvironments` は、一時的に超えることがあります。** 重みの変更や Lambda の内部の入れ替えのあいだ、Lambda は可用性を優先して上限を超える数の実行環境を動かすことがある、と公式ドキュメントに書かれています。

**ノートは実行環境ごとに別です。** 04章と同じく、メモリ上の `Map` は実行環境の数だけあります。2 つのリビジョンに振り分けているあいだは、少なくとも 2 つです。[05章](/ja/chapters/05-dynamodb.md)のテーブルに置き換えると、この問題は消え、かわりに実行ロールへ権限を足すことになります。

**ログのロググループは、放っておくと期限なしで作られます。** リビジョンにロググループを指定しないと、Lambda は最初のリクエストのときに既定の名前のロググループを 2 つ作り、どちらにも保持期間を設定しません。このスタックが先に 2 つ作っているのは、そのためです。

**`X-Forwarded-For` は、最後の値だけが信用できます。** それより前の値と `X-Forwarded-Host` は、呼び出す側が書いたものがそのまま届きます。CloudFront を前に置くと、最後の値は CloudFront のアドレスになります。

**重みを CloudFormation の外で変えると、ドリフトになります。** コンソールや CLI でエンドポイントの重みを動かすと、次のデプロイがテンプレートの重みに戻します。この章では、重みは必ずデプロイで動かします。

**大きなアップロードは、ボディを読み終えてから断ります。** [しくみと実装](/ja/chapters/69-web-functions/build.md)で書いたとおり、長さを宣言したボディは読み捨ててから 413 を返します。チャンクで送られたボディが途中で上限を超えた場合のふるまいは、確かめていません。

## 本番にするなら

<!-- section: 69.production -->

このスタックは、署名できる呼び出し元だけが使える、練習用の API です。本番にするときに足すものを、順に挙げます。

ブラウザーから呼ぶなら、入口の形を変えます。`IamAuth` のエンドポイントは、ブラウザーの利用者が直接呼ぶ相手ではありません。エンドポイントの前に CloudFront を置き、origin access control で CloudFront に署名させると、利用者は署名なしで CloudFront を呼び、エンドポイントは署名のないリクエストを断ったままにできます。独自ドメイン、AWS WAF、キャッシュも CloudFront に付きます。このとき、利用者が送った `Host` ヘッダーをオリジンに転送してはいけません。Lambda は `Host` でエンドポイントを選ぶので、404 になります。利用者の認証は、[06章](/ja/chapters/06-auth.md)のように、アプリが `Authorization` ヘッダーのトークンを検証します。Lambda は、AWS の署名ではない `Authorization` ヘッダーをそのままサーバーに渡します。

`ApplicationManaged` のエンドポイントは、CloudFront を前に置いても、自分のドメイン名で誰からでも呼べるままです。組織で Web Function を使うなら、`lambda:Request/WebFunctionAuthType` という条件キーで、`ApplicationManaged` のエンドポイントを作れないようにするポリシーを書けます。

リビジョンの切り替えは、戻す基準を先に決めます。どのメトリクスが、どの値を、何分超えたら戻すのかを決め、ログの `release` の欄で、リビジョンごとの 5xx を数えられるようにしておきます。アラームは、ホームリージョンの `AWS/Lambda/Web` の `HTTPResponseStatusClass5XX` と、`AWS/Lambda/Web/Usage` のスロットリングのメトリクスに付けます。どちらも、値が 0 の期間にはデータ点が無いメトリクスなので、アラームではデータが無い期間を「問題なし」として扱います（[19章](/ja/chapters/19-observability.md)）。

`maxEnvironments` と `rateLimit` は、計測してから決めます。この章の値は、エンドポイントが受け付けるいちばん小さい値です。データベースを後ろに置くなら、実行環境の数とプールの大きさの積が、データベースの接続数の上限に収まるようにします。CPU を使う処理があるなら、`maxConcurrencyPerEnvironment` を下げます。

VPC の中のリソースに届かせるなら、egress network connector を作ります。connector を使うリビジョンは、1 つのリージョンのエンドポイントからしか使えません。

複数のリージョンで動かす `MultiRegion` のエンドポイントは、この章では扱っていません。Lambda はコードと設定を各リージョンに複製し、遅延の小さいリージョンにリクエストを送りますが、リージョンの障害を見て切り替えることはしません。データをどのリージョンに置くかという問題は、[28章](/ja/chapters/28-multi-region.md)のまま残ります。

デプロイの道具は、cdkd が Web Function に対応したら戻します。cdkd の公式ドキュメントは cdkd を開発とテスト向けとし、本番には AWS CDK CLI を勧めているので、本番ではこの章の経路がそのまま使えます。

## Cloudflare Workers、Vercel との違い

<!-- section: 69.elsewhere -->

「HTTP を直接受けるコードを、1 つの実行単位で同時に複数のリクエストを処理させ、CPU を使った時間に課金する」という形は、Cloudflare Workers と Vercel の Fluid compute が先に持っていました。2026-10-13 に公式ドキュメントで確かめた範囲で並べます。

| | Lambda Web Functions | Cloudflare Workers | Vercel（Fluid compute） |
| --- | --- | --- | --- |
| コードの形 | ポートで待ち受ける Node.js のサーバー | `fetch` ハンドラー。`node:http` のサーバーも載せられる | 関数の export か、ポートで待ち受けるサーバー |
| 1 つの実行単位 | 2 vCPU、2 GB | isolate、128 MB | プランと設定で決まる |
| リクエストあたりの時間 | 最長 900 秒 | CPU 時間で最長 5 分。経過時間に上限なし | 既定 300 秒、Pro で最長 800 秒 |
| リクエストの料金 | 100 万件 0.30 | 100 万件 0.30 | 100 万件 0.60（Pro） |
| CPU の料金（1 時間あたり） | 0.116 | 0.072 | 0.202（東京） |
| メモリの料金（1 GB 時間あたり） | 0.0154、使った分 | なし | 0.0167、確保した分（東京） |
| 月額の最低料金 | なし | 5（Workers Paid） | プランによる |

CPU とメモリの列は、それぞれの単価を 1 時間あたりに直したものです。Workers Paid には毎月 1,000 万リクエストと 3,000 万ミリ秒の CPU 時間が含まれ、Vercel の Hobby には 4 時間の CPU 時間、360 GB 時間のメモリ、100 万回の呼び出しが含まれます。Workers には、実行時間とデータ転送の料金がありません。

単価だけを比べると、Workers がいちばん安く、メモリの料金もありません。Workers は 2025-09-01 以降の compatibility date で `http.createServer` を使えるようになっていて、04章のアプリのような `Request` を受けて `Response` を返す関数は、もともと Workers の `fetch` ハンドラーと同じ形です。128 MB に収まり、Workers のランタイムで動くライブラリだけで書けている API は、Workers に置いたままでかまいません。Web Function に移す理由になるのは、Node.js そのものが必要なこと、2 GB のメモリ、15 分までのリクエスト、そして IAM や VPC の中のリソースとの近さです。

Vercel の Fluid compute は、Web Function といちばん似ています。Express のアプリを `app.listen` のまま置けて、1 つのインスタンスが複数のリクエストを処理し、CPU 時間とメモリとリクエストに課金します。フレームワークのビルドからプレビューまでを Vercel に任せているなら、同じ形のために AWS へ移る理由は、料金表からは出てきません。移す理由になるのは、ほかの AWS のリソースと同じアカウント、同じ IAM、同じ VPC で動かしたい場合です。

3 つに共通しているのが、この章の不変条件です。Cloudflare のドキュメントも、1 つのインスタンスが複数のリクエストを同時に処理することがあるので、グローバルな状態を変更しないように書いています。モジュールの変数に置いたリクエスト単位の値は、どこへ持っていっても壊れます。

## 片付け

<!-- section: 69.cleanup -->

リクエストが来なければ料金はほぼかかりませんが、エンドポイントはインターネットから届く場所に残ります。試し終えたら消します。

```bash
vp run webfn:empty
vp run webfn:empty --yes
vp run webfn:cfn:destroy
```

1 行目は、コードのバケットにあるオブジェクトのバージョンを数えるだけです。2 行目で、すべてのバージョンを消します。バージョニングを有効にしたバケットは、すべてのバージョンと削除マーカーを消すまで空にならず、空でないバケットは CloudFormation が消せません。バージョンを消した時点でリビジョンは使えなくなるので、この操作は、スタックを消す直前にだけ行います。

3 行目で、エンドポイント、リビジョン、Web Function、ロググループ、ロール、バケットが消えます。エンドポイントのドメイン名は、消すと二度と使われません。もう一度デプロイすると、別のドメイン名になります。

残るものは 2 つです。20章の bootstrap で作った `CDKToolkit` スタックは、この章のスタックを消しても残ります。20章のスタックと共有しているものなので、この章のタスクは触りません。手元には、`examples/69-web-functions/reports/webfn-outputs.json` と `dist/function.zip` が残ります。どちらも Git の管理の外です。

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト（9 ファイル、68 件）。実際のソケットで待ち受けるサーバーに 2 つのリクエストを重ねて、リクエスト単位の値が混ざらないことと、モジュールの変数に置いた版では混ざること。`AWS_LAMBDA_HTTP_ENDPOINT` の読み取り、Lambda が付けたリクエスト ID の採用、プリフライト、宣言された長さが上限を超えるアップロードに、ボディを最後まで受け取ってから 413 を返すこと（読み捨てを外すと、このテストが落ちることも確かめました）。SIGTERM のあとの停止を、開いているリクエストを待つ場合と時間切れで切る場合の両方で。zip の書き出しと読み戻し、アーカイブだけを展開した空のディレクトリからサーバーが起動し、SIGTERM から 1 秒以内に終了コード 0 で終わること。リリースの指定と重みの計算、エンドポイントの上限の検証、CDK CLI に渡す引数、SigV4 の署名に `x-amz-content-sha256` が入ること、スタックのアサーション。型検査。`webfn:demo`、`webfn:package`、`webfn:cfn:synth`（リリースなし、`-c stable=v1`、canary つきの 3 通り）。

**まだ確かめていないこと。** AWS に対しては、何も実行していません。`ship:cfn:bootstrap`、`webfn:cfn:deploy`、`webfn:upload`、`webfn:cfn:diff`、`webfn:smoke`、`webfn:empty`、`webfn:cfn:destroy` のどれもです。したがって、次はすべて実機での確認待ちです。CloudFormation がこのテンプレートから 3 種類の Web Function のリソースを作れること（AWS CDK CLI 2.1145.0 に同梱の検証は、この種類を知らないと警告します）。バンドルした `index.js` が `nodejs24.x` で ES モジュールとして読み込まれ、10 秒以内に待ち受けが始まること。`IamAuth` のエンドポイントが署名のないリクエストを 403 で断り、この章の署名を受け付けること。`console` に渡したオブジェクトが JSON で入ること。SIGTERM が届くこと。canary の追加、昇格、ロールバックが CloudFormation 経由でこの章の説明どおりに進むこと、とくに昇格のとき、エンドポイントの重みが先に更新されてから古いリビジョンが消されること。バケットを空にしてからスタックを消す順序で、削除が最後まで進むこと。

**一次情報で確かめられなかったこと。** リクエストが途切れたあと実行環境がどれだけ残るか。Web Function に無料利用枠があるか。リクエストとレスポンスのボディの大きさの上限。CloudFormation がエンドポイントの更新の完了（`updateStatus`）を待つかどうか。Web Function が CodeDeploy で使えるか。実行環境の分離に何が使われているか。暗号化のページは概要だけを読み、鍵ポリシーの手順は読んでいません。ログのページは、CloudWatch Logs の機能との組み合わせとシステムログのスキーマの節を読んでいません。

**cdkd（0.296.28）が扱うリソースの種類。** `AWS::S3::Bucket`、`AWS::S3::BucketPolicy`、`AWS::IAM::Role`、`AWS::IAM::Policy`、`AWS::Logs::LogGroup` は、`src/provisioning/register-providers.ts` に専用の実装があります。`AWS::Lambda::WebFunction`、`AWS::Lambda::WebFunctionRevision`、`AWS::Lambda::WebFunctionEndpoint` は登録が無く、Cloud Control API の対応リソースの一覧にも 2026-10-13 の時点でありませんでした。一覧は読んだだけで、Cloud Control API を呼んで確かめてはいません。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| Web Function とは | `examples/69-web-functions/src/index.ts` | `dev:webfn` |
| サーバーを起動して、止める | `examples/69-web-functions/src/listen.ts`、`src/serve.ts`、`src/index.ts`、`test/listen.test.ts`、`test/shutdown.test.ts` | `dev:webfn`、`webfn:demo`、`test:unit` |
| 1 つの実行環境で、複数のリクエスト | `examples/69-web-functions/src/app.ts`、`test/server.test.ts`、`test/harness.ts`、`examples/35-lambda-managed-instances/src/scope.ts`、`src/audit.ts` | `webfn:demo`、`test:unit` |
| HTTP の決まり | `examples/69-web-functions/src/app.ts`、`src/log.ts`、`test/app.test.ts`、`test/server.test.ts` | `test:unit` |
| スタック | `examples/69-web-functions/infra/lib/web-functions-stack.ts`、`infra/bin/app.ts`、`infra/test/web-functions-stack.test.ts`、`src/names.ts`、`src/release.ts` | `webfn:cfn:synth`、`test:unit` |
| 手元で動かす | `examples/69-web-functions/scripts/demo.ts`、`scripts/build.ts`、`scripts/package.ts`、`src/zip.ts`、`test/package.test.ts`、`.env.example` | `dev:webfn`、`webfn:demo`、`webfn:package`、`webfn:cfn:synth` |
| cdkd ではなく CloudFormation を使う理由 | `examples/69-web-functions/scripts/cdk.ts`、`src/cdk-args.ts`、`test/cdk-args.test.ts`、`examples/20-shipping/src/cdk-args.ts` | `webfn:cfn:synth`、`webfn:cfn:diff`、`webfn:cfn:deploy` |
| 最初のデプロイ | `examples/69-web-functions/scripts/upload.ts`、`scripts/smoke.ts`、`src/sign.ts`、`test/sign.test.ts` | `webfn:upload`、`webfn:cfn:deploy`、`webfn:smoke` |
| リビジョンを切り替える | `examples/69-web-functions/src/release.ts`、`test/release.test.ts`、`infra/test/web-functions-stack.test.ts` | `webfn:cfn:diff`、`webfn:cfn:deploy`、`webfn:smoke` |
| 費用 | `data/pricing/` | `test:unit` |
| 片付け | `examples/69-web-functions/scripts/empty.ts` | `webfn:empty`、`webfn:cfn:destroy` |

**一次情報**（確認日はすべて 2026-10-13）

- 発表: [AWS Lambda announces Lambda Web Functions](https://aws.amazon.com/about-aws/whats-new/2026/10/aws-lambda-web-functions/)（2026-10-12）、[AWS News Blog](https://aws.amazon.com/blogs/aws/announcing-aws-lambda-web-functions-for-fast-consistent-web-app-performance-anywhere/)
- Lambda Developer Guide: [Web Functions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html)、[Core concepts](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-how-it-works.html)、[Creating](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-create.html)、[Revisions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-revisions.html)、[Deployment patterns](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-deployment.html)、[Endpoints](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-endpoints.html)、[Code from Amazon S3](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-code-s3.html)、[HTTP requests and responses](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-http.html)、[Networking](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-networking.html)、[Scaling](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-scaling.html)、[Execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-env-lifecycle.html)、[Runtimes](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-runtimes.html)、[Environment variables](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-revisions-env-vars.html)、[Request timeout](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-revisions-timeout.html)、[Architecture](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-configuration-architecture.html)、[Permissions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-permissions.html)、[Endpoint access control](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-endpoint-access-control.html)、[Encryption](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-encryption.html)、[Monitoring](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-monitoring.html)、[Metrics](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-monitoring-metrics.html)、[Logs](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-logging.html)、[Samples](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-samples.html)、[Best practices](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-best-practices.html)、[Testing](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-testing.html)、[Troubleshooting](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-troubleshooting.html)、[Quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)
- CloudFormation: [AWS::Lambda::WebFunction](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-lambda-webfunction.html)、[AWS::Lambda::WebFunctionRevision](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-lambda-webfunctionrevision.html)、[AWS::Lambda::WebFunctionEndpoint](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-lambda-webfunctionendpoint.html)、[Cloud Control API の対応リソース](https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/supported-resources.html)
- 料金: [AWS Lambda Pricing](https://aws.amazon.com/lambda/pricing/)、AWS Price List bulk API: [Lambda](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/ap-northeast-1/index.json)（2026-10-12 公開の版）。HTTP API、Event Function、CloudWatch Logs、S3 の単価は、04章で読んだものを使い、この章では読み直していません
- 固定した版のパッケージとソース: [aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0)（`aws-lambda/lib/lambda.generated.d.ts`）、[cdkd v0.296.28 の register-providers.ts](https://raw.githubusercontent.com/go-to-k/cdkd/v0.296.28/src/provisioning/register-providers.ts)、[@aws-sdk/client-lambda-web](https://www.npmjs.com/package/@aws-sdk/client-lambda-web)（3.1149.0 はインストールしたもの、3.1150.0 は tarball のファイル一覧）、[cdkd v0.296.28 の README](https://raw.githubusercontent.com/go-to-k/cdkd/v0.296.28/README.md)、AWS CDK CLI 2.1145.0 の `--help`
- Cloudflare: [node:http](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/)、[Pricing](https://developers.cloudflare.com/workers/platform/pricing/)、[Limits](https://developers.cloudflare.com/workers/platform/limits/)、[How Workers works](https://developers.cloudflare.com/workers/reference/how-workers-works/)
- Vercel: [Fluid compute](https://vercel.com/docs/fluid-compute)、[Fluid compute pricing](https://vercel.com/docs/functions/usage-and-pricing)、[Express on Vercel](https://vercel.com/docs/frameworks/backend/express)

:::
