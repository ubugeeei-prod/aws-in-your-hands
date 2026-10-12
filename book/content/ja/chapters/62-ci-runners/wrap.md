---
title: "62 CI Runner: 費用、注意点、片付け"
---

# 62 CI Runner: 費用、注意点、片付け

## 料金

<!-- section: 62.cost -->

AWS の金額は USD、東京リージョン、従量課金、税別で、1 か月を 730 時間として計算しています。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。GitHub の単価は、2026-10-13 に GitHub のドキュメントで読んだ値です。

ジョブが 1 件も無い月にかかる料金は、次のとおりです。

| 対象 | 数量 | 単価 | 月額 |
| --- | --- | --- | --- |
| Secrets Manager のシークレット | 2 つ | 0.40／月 | 0.80 |
| 見回りの Lambda | 2,920 回 × 1 秒（仮定）× 256 MB | 無料枠に収まる | 0.01 |
| EventBridge Scheduler | 2,920 回 | 無料枠に収まる | 0.00 |
| 小計 | | | **0.81** |

Lambda の毎月の無料枠を引くと USD 0.80 です。クラスター、タスク定義、function URL、セキュリティグループ、空の DynamoDB のテーブルには、置いてあるだけでかかる料金がありません。時間課金のリソースは 1 つもありません。

ジョブが動くと、タスクの時間に対して料金がかかります。

<<< @/examples/62-ci-runners/src/cost.ts{job}

2 vCPU、8 GB、arm64 のタスク 1 つは、1 分およそ USD 0.0020 です。内訳は、vCPU が 2 × 0.04045、メモリが 8 × 0.00442、パブリック IPv4 アドレスが 0.005 で、合わせて 1 時間 USD 0.12126 になります。Fargate は、イメージの取得を始めた時点からタスクが止まるまでを、1 秒単位、最低 1 分で課金します。ジョブが受け取られる前の起動の時間にも、料金がかかります。

比べる相手は、GitHub のランナーの定価です。

<<< @/examples/62-ci-runners/src/cost.ts{hosted}

5 分のジョブを月に 1,000 件動かすとして、3 つの方法を比べます。自分のランナーは、ジョブの 5 分に、イメージの取得と登録で 1 分かかるとして、6 分で計算しました。この 1 分は計った値ではなく、仮定です。

| 方法 | 計算 | 月額 |
| --- | --- | --- |
| GitHub のランナー（Linux 2 コア、arm64） | 5,000 分 × 0.005 | 25.00 |
| GitHub のランナー（Linux 2 コア、x64） | 5,000 分 × 0.006 | 30.00 |
| この章の構成（Fargate） | 6,000 分ぶんのタスク | 12.13 |
| CodeBuild のランナー（arm1.small） | 6,000 分 × 0.00425 | 25.50 |

Fargate の 12.13 は、vCPU の 8.09、メモリの 3.54、パブリック IPv4 アドレスの 0.50 の合計です。受信の Lambda、DynamoDB の書き込み、Secrets Manager の呼び出しを足すと 12.16 になり、Lambda の無料枠を引くと 12.15 です。CodeBuild は、毎月 100 分の無料枠を引くと 25.08 です。arm1.small の大きさは、この章のタスクと同じではありません。CodeBuild の起動にかかる時間も、計っていません。

この表は定価どうしの比較で、実際の請求とは違います。GitHub のプランには、毎月の分数が含まれています（Free で 2,000 分、Team で 3,000 分）。Team のプランで 5,000 分を使った場合、請求されるのは 2,000 分ぶんの USD 10.00 で、この章の構成より安くなります。含まれる分数がランナーの種類によってどう数えられるかは、確かめていません。

含まれる分数を考えに入れた境目は、計算できます。

<<< @/examples/62-ci-runners/src/cost.ts{break-even}

3,000 分が含まれるプランで、arm64 の Linux ランナーと比べると、境目は月 5,826 分です。5 分のジョブなら、およそ 1,165 件にあたります。これより少ないなら、料金のうえでは、自分で持つ理由がありません。量が多くなると差は開きます。月 20,000 件（100,000 分）なら、GitHub の定価で USD 500.00、この章の構成で USD 242.52 です。

料金について、知っておくべきことがもう 2 つあります。

1 つは、GitHub の側の料金が変わる可能性です。GitHub は 2025 年 12 月に、セルフホストランナーの利用にも 1 分 USD 0.002 を課金すると発表し、2026-03-01 に始める予定でした。その後、この変更は延期されています。GitHub の発表のページには、進め方を見直すために延期するとあり、新しい日付は書かれていません。2026-10-13 時点の料金のドキュメントは、セルフホストランナーの利用は無料だと書いています。仮にこの課金が加わると、この章の構成の 1 分あたりの費用は 0.0044 ほどになり、arm64 のランナーの定価との差は、1 分 USD 0.0006 弱しか残りません。

もう 1 つは、この比較に入っていない費用です。ログ、データ転送、キャッシュが効かないことで延びるジョブの時間、そして、この構成を保守する人の時間です。ランナーのイメージの更新、GitHub App の鍵の管理、失敗した配送の再送は、自分で行います。

暴走したときの上限も、計算できます。見回りがタスクを止めるのは 6 時間後なので、来ないジョブを待つタスク 1 つは、最大で USD 0.73（6 時間 × 0.12126）かかります。同時に起動できるタスクの数に、この章のコードは上限を付けていません。上限になるのは、アカウントの Fargate の vCPU のクォータです（[32章](/ja/chapters/32-limits.md)）。

## Cloudflare や Vercel から来た人へ

<!-- section: 62.platforms -->

Cloudflare と Vercel には、この章に対応するものが、ほぼありません。どちらも、リポジトリとつなぐと、プラットフォームが用意したマシンでビルドしてデプロイします。ビルドのマシンを自分で用意する方法は、2026-10-13 に読んだページには見つかりませんでした（Cloudflare は Workers Builds の制限と料金のページ、Vercel はビルドの管理のページだけを読んでいます）。

| | Cloudflare Workers Builds | Vercel |
| --- | --- | --- |
| ビルドのマシン | Free で 2 vCPU、Paid で 4 vCPU。どちらも 8 GB | Basic（2 vCPU、8 GB）から Turbo（30 vCPU、60 GB）まで |
| 含まれる量と単価 | Free で月 3,000 分。Paid で月 6,000 分、超えると 1 分 USD 0.005 | 有料のチームは Basic で 1 分 USD 0.007 |
| ビルドの時間の上限 | 20 分 | 確かめていません |

どちらのプラットフォームでも、ビルドの環境がほかのビルドとどう分かれているか、イメージをどう更新するかは、利用者が考える対象になっていません。アプリのビルドとデプロイだけが CI の仕事なら、そこに留まるほうが単純です。

GitHub Actions からデプロイしている場合も、同じことが言えます。ランナーを自分で持つ理由になるのは、デプロイ先がどこであるかではなく、ジョブが自分のネットワークの中のものに届く必要があるか、量が多いかです。

## 分散システムとして見る

この章で状態を持っているものは 4 つあります。ジョブがキューにあるかどうかと、ランナーの登録は、GitHub が持ちます。どのジョブのために起動したかは、DynamoDB のテーブルが持ちます。タスクが動いているかどうかは、ECS が持ちます。4 つは、互いの状態を知りません。受信の Lambda が、そのあいだを、失敗しうる呼び出しでつないでいます。

不変条件は、次のとおりです。

- あるジョブが書き込んだものは、次のジョブから見えない。守っているのは、タスクがジョブ 1 件で終わることと、Fargate のタスクどうしの境界です。前者は JIT ランナーの性質、後者は AWS のドキュメントの記述で、どちらもこの章のテストでは確かめられません
- 1 件のジョブのために起動するタスクは、多くても 1 つ。`test/receive.test.ts` が、再送、同時の配送、起動の失敗、途中で止まった受信で確かめています
- ジョブは、空のタスクロールと、OIDC で引き受けたロール以外の権限を持たない。スタックのアサーションが、タスクロールに権限が無いことを確かめています

守れていないことも、はっきりしています。GitHub の配送は、届かないことがあり、自動では再送されません。届かなかったジョブは、誰かが再送するまでキューで待ち、24 時間でキャンセルされます。この章の構成には、取りこぼした配送を見つける仕組みがありません。GitHub のドキュメントは、失敗した配送を API で調べて再送するスクリプトを、定期的に動かす方法を紹介しています。runner scale set のように、GitHub に問い合わせる側が接続を張る方式なら、この問題は起きません。

ジョブとランナーが 1 対 1 でないことも、残る性質です。起動したランナーの数とキューにあるジョブの数は、最後には合うはずですが、ずれているあいだは、余ったランナーが待ち続けるか、ジョブが待ち続けます。前者は見回りが 6 時間で止め、後者は 24 時間で GitHub がキャンセルします。

## つまずきやすいところ

| こうなったら | ここを見る |
| --- | --- |
| 配送の履歴がすべて 401 | webhook のシークレットが、Secrets Manager の値と違う。App の設定に入れ直す |
| 200 で `labels_not_ours` | ワークフローの `runs-on` が `aih-fargate` だけになっているか。配列で別のラベルを足していないか |
| 200 で `repository_not_allowed` | デプロイのときの `-c repositories` が、`owner/repo` と完全に一致しているか。大文字と小文字も区別する |
| 200 で `not_from_app` | リポジトリの webhook として登録している。GitHub App の webhook にする |
| 200 で `fork` や `event_not_trusted` | 仕様どおり。そのジョブは GitHub のランナーで動かす |
| 500 で、ログに `GitHub answered 401` や `404` | App のクライアント ID、秘密鍵、インストール先、権限（Administration の書き込み）を確かめる |
| 500 で、ログに `the overrides are ... characters` | JIT の設定が RunTask の上限より長い。検証メモの代わりの渡し方に変える |
| 500 で、ログに `RunTask started nothing` | 理由が続けて出ている。サブネットのアドレス、vCPU のクォータ |
| タスクは起動したのに、ジョブが始まらない | ランナーのロググループを見る。イメージを取得できているか、GitHub に届いているか（出る通信は 443 だけ） |
| ジョブが `docker` で失敗する | Fargate ではデーモンを動かせない。[実装のつづき](/ja/chapters/62-ci-runners/more.md)を参照 |
| ジョブが `aws` コマンドで失敗する | イメージに AWS CLI は無い。ワークフローで入れるか、イメージを作る |
| ジョブが 6 時間で止まる | 見回りが止めている。`RUNNER.maxTaskSeconds` |
| しばらくしてからジョブを受け取らなくなった | ランナーの版が古い。GitHub は 30 日以内の更新を求めている。`RUNNER.image` を更新する |

この表の内容は、コードとドキュメントから組み立てたもので、実際に起こして確かめてはいません。

## 本番にするなら

- **リポジトリではなく、組織とランナーグループで分ける。** GitHub のドキュメントは、ランナーグループで、どのリポジトリがどのランナーを使えるかを区切るよう勧めています。信頼の度合いが違うリポジトリに、同じ App と同じクラスターを使わないでください
- **ランナーを置くアカウントを、本番と分ける。** ジョブが届くネットワークとクォータが、本番と別になります
- **出る通信を、ドメイン名で絞る。** [63章](/ja/chapters/63-agent-sandbox.md)の選択肢を使います
- **取りこぼした配送を拾う。** 失敗した配送を API で調べて再送する処理を、定期的に動かします
- **受信を、キューで受ける。** 配送が集中したとき、Lambda の同時実行数や GitHub の API の制限に当たります。受信は署名を確かめてキューに入れるだけにし、起動をワーカーに回します（08章）。同時に動かすタスクの数の上限も、そこで付けられます
- **App の秘密鍵を、定期的に作り直す。** 手順を決め、古い鍵を GitHub の側で消します（21章）
- **イメージの更新を、自動にする。** 新しい版が出たことに気づく仕組みと、ダイジェストを更新するプルリクエストを用意します。pull through cache を通せば、ghcr.io が止まっているときにも起動できます（52章）
- **失敗を通知にする。** 受信の Lambda のエラーと、見回りが止めたタスクの数を、アラームにつなぎます（19章）
- **ジョブのログの保持を決める。** ランナーのロググループには、ランナー自身の出力が入ります。ジョブのログは GitHub の側にあります
- **反映の経路を AWS CDK CLI と CloudFormation にする。** cdkd の公式ドキュメントは、cdkd を開発・テスト用途向けとし、本番には AWS CDK CLI を勧めています（02章）

## 片付け

<!-- section: 62.cleanup -->

先に、GitHub の側を止めます。GitHub App をリポジトリからアンインストールするか、App を削除します。そうしないと、スタックを消したあとも、消えた URL へ配送が送られ続けます。App の秘密鍵も、GitHub の側で削除しておきます。

動いているタスクが無いことを確かめてから、スタックを消します。タスクはスタックのリソースではないので、destroy では止まりません。動いているタスクがあるときにクラスターを削除できるかどうかは、確かめていません。

```bash
aws ecs list-tasks --cluster <ClusterName> --region ap-northeast-1
vp run runners:infra:destroy
```

2 つのシークレット、テーブル、ロググループは、スタックと一緒に消える設定にしてあり、テストも、残す設定がどのリソースにも付いていないことを確かめています。Secrets Manager のシークレットは、ふつうは削除までに待機期間があります。cdkd が待機期間なしで消すかどうかは、確かめていません。消したあとで、次のコマンドで残っていないことを確かめてください。

```bash
aws secretsmanager list-secrets --include-planned-deletion --region ap-northeast-1
```

GitHub の側には、接続しなかったランナーの登録が残っていることがあります。エフェメラルなランナーの登録は、1 日で自動的に消えます。リポジトリの設定のランナーの一覧で確かめられます。

11章の VPC は、この章のスタックを消したあとで消せます。

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト 95 件（署名、判定、受信の処理の失敗の順序、GitHub の API に送るリクエストの形、RunTask の入力、見回り、設定、ワークフロー、料金、スタックのアサーション）。型検査。`runners:infra:synth`（コンテキストなしと、`-c repositories=example-org/notes -c appClientId=Iv23example` つき。`-c repositories='example-org/*'` が拒否されることも）。`runners:decide`（[デプロイ](/ja/chapters/62-ci-runners/deploy.md)の出力は、このコマンドの実際の出力です）。ランナーのイメージのマニフェストは、ghcr.io から匿名で読みました。本文の AWS の金額は、Price List の単価から `tools/src/pricing/calc.ts` が計算した値で、`examples/62-ci-runners/test/pricing.test.ts` が照合しています。

**まだ確かめていないこと。** AWS に対しては、何も実行していません。GitHub と GitLab の API は、認証つきでは一度も呼んでいません。GitHub App は作っておらず、ランナーは登録しておらず、ジョブは 1 件も動かしていません。したがって、次のことは実物で確かめていません。cdkd 0.296.28 がこのスタックを作って消せること。function URL が GitHub の配送を受けられること。GitHub の配送の実際の形（テストのペイロードは手で書いたものです）。`encoded_jit_config` の長さが RunTask の上書きの上限（8,192 文字）に収まること。ランナーのイメージが Fargate で起動し、ジョブを 1 件実行して終了すること。起動にかかる時間（料金の 1 分は仮定です）。受信の処理が 9 秒に収まること。フォークからのプルリクエストで `head_repository` がフォークを指すこと。DynamoDB の条件式。見回りが古いタスクを止めること。「つまずきやすいところ」の症状。

一次情報で確かめられなかったこと。`generate-jitconfig` が 409 を返す条件。JIT で登録したランナーに `self-hosted` などの既定のラベルが付くかどうか。既定のランナーグループの ID が 1 であること（API の例から読んだだけです）。使われた JIT の設定で、もう一度登録できるかどうか。セルフホストランナーのジョブが OIDC のトークンを求められると明記した文（`runner_environment` の値から読み取りました）。組織単位でランナーを登録するときの権限。セルフホストランナーから使ったキャッシュの保存先。GitHub のプランに含まれる分数の、ランナーの種類ごとの数え方。セルフホストランナーへの課金の新しい開始日。Fargate のタスクから、基盤のインスタンスメタデータに届かないと明記した文。単発のタスクの最長の実行時間の設定。CodeBuild のランナーで、ジョブからサービスロールの認証情報がどう見えるか、フォークのジョブを断る設定があるか。rootless の BuildKit と Buildah が Fargate で動くか（BuildKit のドキュメントは seccomp の制限を外す手順を、GitLab のドキュメントは外さない手順を書いていて、食い違っています）。GitLab に、ジョブごとにランナーを起動するための webhook の使い方があるかどうか（見つからなかっただけで、無いことを確かめたわけではありません）。Cloudflare と Vercel に、ビルドのマシンを自分で用意する方法があるかどうか（読んだのは 1 ページずつです）。function URL に追加の料金が無いこと（料金のページには記述が見つからず、2022 年の発表のブログにだけあります）。

GitLab、CodeBuild、ARC、runner scale set、Cloudflare、Vercel は、ドキュメントを読んだだけです。GitLab と about.gitlab.com、Cloudflare のページからの引用は、要約を通して読んだもので、原文の一字一句までは照合していません。

cdkd が扱うリソースの種類。`@go-to-k/cdkd` 0.296.28 のパッケージの中の登録（`register("AWS::...")`）を調べ、このスタックが使う 12 種類（`AWS::DynamoDB::Table`、`AWS::EC2::SecurityGroup`、`AWS::ECS::Cluster`、`AWS::ECS::TaskDefinition`、`AWS::IAM::Policy`、`AWS::IAM::Role`、`AWS::Lambda::Function`、`AWS::Lambda::Permission`、`AWS::Lambda::Url`、`AWS::Logs::LogGroup`、`AWS::Scheduler::Schedule`、`AWS::SecretsManager::Secret`）が、すべて専用の実装に登録されていることを確かめました。Cloud Control API を経由する種類はありません。それぞれの実装が、このスタックの使うプロパティ（`AWS::Lambda::Permission` の `InvokedViaFunctionUrl`、Schedule の Lambda のターゲットなど）を扱えるかどうかまでは、読んでいません。

aws-cdk-lib 2.273.0 について、synth して観察したこと。`addFunctionUrl` に `authType: NONE` を渡すと、`lambda:InvokeFunctionUrl` と、`InvokedViaFunctionUrl` の付いた `lambda:InvokeFunction` の、2 つの `AWS::Lambda::Permission` が作られる。セキュリティグループの出る通信の規則は、グループのプロパティに入り、別のリソースにはならない。

この章が 04章の部品に足したもの。署名の検証にはボディのバイト列が要るので、`readJson` の代わりに、上限つきでバイト列を読む `readBytes` を `src/receive.ts` に書きました。

**コードの場所。**

| 節 | ファイル | `vp run` のタスク |
| --- | --- | --- |
| ランナーは何でも実行する | `examples/62-ci-runners/src/decide.ts`、`infra/test/runner-stack.test.ts` | `test:unit` |
| 全体像 | `examples/62-ci-runners/infra/lib/runner-stack.ts`、`src/config.ts` | `runners:infra:synth` |
| ランナーの登録 | `examples/62-ci-runners/src/github.ts`、`test/github.test.ts` | `test:unit` |
| 配送を受け取る | `examples/62-ci-runners/src/receive.ts`、`src/signature.ts`、`src/events.ts`、`src/app.ts`、`src/lambda.ts`、`test/signature.test.ts`、`test/receive.test.ts` | `test:unit`、`runners:decide` |
| 起動するかどうかを決める | `examples/62-ci-runners/src/decide.ts`、`test/decide.test.ts` | `test:unit`、`runners:decide` |
| 1 件のジョブに 1 つのタスク | `examples/62-ci-runners/src/claims.ts`、`src/dynamodb-claims.ts`、`src/launcher.ts`、`src/sweep.ts`、`src/sweeper.ts`、`src/sweeper-lambda.ts`、`test/launcher.test.ts`、`test/sweep.test.ts` | `test:unit` |
| スタック | `examples/62-ci-runners/infra/lib/runner-stack.ts`、`infra/bin/app.ts`、`infra/test/runner-stack.test.ts`、`workflows/ci.yml` | `runners:infra:synth`、`test:unit` |
| 手元で確かめる | `examples/62-ci-runners/scripts/decide.ts`、`fixtures/workflow-job-queued.json`、`test/` | `runners:decide`、`test:unit` |
| デプロイする | `examples/62-ci-runners/infra/bin/app.ts`、`tools/src/infra/` | `runners:infra:diff`、`runners:infra:deploy`、`runners:infra:drift` |
| 料金 | `examples/62-ci-runners/src/cost.ts`、`test/pricing.test.ts`、`data/pricing/` | `test:unit` |
| 片付け | `tools/src/infra/` | `runners:infra:destroy` |

**一次情報**（確認日はすべて 2026-10-13。20章、21章、41章で確認した出典は、それぞれの章に確認日があります）

- ランナーの登録: [REST API endpoints for self-hosted runners](https://docs.github.com/en/rest/actions/self-hosted-runners?apiVersion=2022-11-28)、[Removing self-hosted runners](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/remove-runners)、[Self-hosted runners reference](https://docs.github.com/en/actions/reference/runners/self-hosted-runners)
- GitHub App: [Generating a JSON Web Token (JWT) for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app)、[REST API endpoints for GitHub Apps](https://docs.github.com/en/rest/apps/apps?apiVersion=2022-11-28)、[Permissions required for GitHub Apps](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps?apiVersion=2022-11-28)
- webhook: [Webhook events and payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads)、[Validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)、[Handling failed webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries)、[Best practices for using webhooks](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks)、[github/rest-api-description](https://github.com/github/rest-api-description/blob/main/descriptions/api.github.com/api.github.com.yaml)（`webhook-workflow-job-queued`、`workflow-run`）
- 安全: [Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)、[Managing GitHub Actions settings for a repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)、[OpenID Connect reference](https://docs.github.com/en/actions/reference/security/oidc)
- 自動スケール: [Actions Runner Controller](https://docs.github.com/en/actions/concepts/runners/actions-runner-controller)、[actions/scaleset](https://github.com/actions/scaleset)
- ランナーのイメージ: [actions/runner v2.338.0 の images/Dockerfile](https://github.com/actions/runner/blob/v2.338.0/images/Dockerfile) と `src/Runner.Listener/CommandSettings.cs`、ghcr.io の `actions/actions-runner:2.338.0` のマニフェスト
- 上限と料金（GitHub）: [Actions limits](https://docs.github.com/en/actions/reference/limits)、[GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)、[Actions runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing)、[GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)、[Update to GitHub Actions pricing](https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/)、[Dependency caching reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)
- GitLab: [Migrating to the new runner registration workflow](https://docs.gitlab.com/ci/runners/new_creation_workflow/)、[Registering runners](https://docs.gitlab.com/runner/register/)、[GitLab token overview](https://docs.gitlab.com/security/tokens/)、[Executors](https://docs.gitlab.com/runner/executors/)、[Instance executor](https://docs.gitlab.com/runner/executors/instance/)、[Docker Autoscaler executor](https://docs.gitlab.com/runner/executors/docker_autoscaler/)、[fleeting-plugin-aws](https://gitlab.com/gitlab-org/fleeting/plugins/aws)、[Advanced configuration](https://docs.gitlab.com/runner/configuration/advanced-configuration/)、[Long polling](https://docs.gitlab.com/ci/runners/long_polling/)、[Autoscaling GitLab CI on AWS Fargate](https://docs.gitlab.com/runner/configuration/runner_autoscale_aws_fargate/)、[Security for self-managed runners](https://docs.gitlab.com/runner/security/)、[Merge request pipelines](https://docs.gitlab.com/ci/pipelines/merge_request_pipelines/)、[Configure OpenID Connect in AWS](https://docs.gitlab.com/ci/cloud_services/aws/)、[GitLab pricing](https://about.gitlab.com/pricing/)、[Compute minutes FAQ](https://about.gitlab.com/pricing/faq-compute-minutes/)
- イメージのビルドとキャッシュ: [Use Docker to build Docker images](https://docs.gitlab.com/ci/docker/using_docker_build/)、[Build Docker images with BuildKit](https://docs.gitlab.com/ci/docker/using_buildkit/)、[Use kaniko to build Docker images (removed)](https://docs.gitlab.com/ci/docker/using_kaniko/)、[GoogleContainerTools/kaniko](https://github.com/GoogleContainerTools/kaniko)、[BuildKit rootless mode](https://github.com/moby/buildkit/blob/master/docs/rootless.md)、[Docker Machine Executor autoscaling configuration](https://docs.gitlab.com/runner/configuration/autoscale/)
- CodeBuild: [Configure a CodeBuild-hosted GitHub Actions runner](https://docs.aws.amazon.com/codebuild/latest/userguide/action-runner.html)、[About CodeBuild-hosted GitHub Actions runners](https://docs.aws.amazon.com/codebuild/latest/userguide/action-runner-questions.html)、[Configure a CodeBuild-hosted GitLab runner](https://docs.aws.amazon.com/codebuild/latest/userguide/sample-gitlab-runners.html)、[About CodeBuild-hosted GitLab runners](https://docs.aws.amazon.com/codebuild/latest/userguide/gitlab-runner-questions.html)、[ProjectEnvironment](https://docs.aws.amazon.com/codebuild/latest/APIReference/API_ProjectEnvironment.html)、[Run builds on AWS Lambda compute](https://docs.aws.amazon.com/codebuild/latest/userguide/lambda.html)、[AWS CodeBuild Pricing](https://aws.amazon.com/codebuild/pricing/)
- ECS と Fargate: [RunTask](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_RunTask.html)、[Ensuring idempotency](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/ECS_Idempotency.html)、[ContainerOverride](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_ContainerOverride.html)、[StopTask](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_StopTask.html)、[Fargate security considerations](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-security-considerations.html)、[Amazon ECS task IAM role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html)、[IAM roles best practices for Amazon ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/security-iam-roles.html)、[AWS Fargate Pricing](https://aws.amazon.com/fargate/pricing/)
- Lambda と EC2: [Control access to Lambda function URLs](https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html)、[Invoking Lambda function URLs](https://docs.aws.amazon.com/lambda/latest/dg/urls-invocation.html)、[Retrieve security credentials from instance metadata](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instance-metadata-security-credentials.html)
- 料金（AWS）: AWS Price List bulk API の [CodeBuild](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/CodeBuild/current/ap-northeast-1/index.json)。Fargate、Lambda、DynamoDB、Secrets Manager、Scheduler、パブリック IPv4 アドレスの単価は、それぞれの章で取得したもの
- Cloudflare と Vercel: [Workers Builds: limits and pricing](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/)、[Managing builds](https://vercel.com/docs/builds/managing-builds)
- cdkd v0.296.28: [src/provisioning/register-providers.ts](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts)（導入したパッケージの中の登録を確認）
- [aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0)（synth を実行して観察）

:::
