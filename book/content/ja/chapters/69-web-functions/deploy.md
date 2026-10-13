---
title: "69 Web Functions: デプロイ"
---

# 69 Web Functions: デプロイ

[手元で動かす](/ja/chapters/69-web-functions/local.md)までで、サーバーとパッケージは確かめました。このページでは、スタックを AWS に置き、署名したリクエストで確かめ、新しいリビジョンに少しずつ切り替える手順を書きます。**このページの手順は、どれも実行していません。** 用意したのはタスクとその中身のテストまでで、AWS での結果は書いていません。

## cdkd ではなく CloudFormation を使う理由

<!-- section: 69.tool -->

この本のスタックは cdkd でデプロイしてきました。この章のスタックだけ、[20章](/ja/chapters/20-shipping.md)と同じ AWS CDK CLI と CloudFormation を使います。2026-10-13 に確かめたのは、次の 4 点です。

- 固定している `aws-cdk-lib` 2.273.0 には、`lambda.CfnWebFunction`、`lambda.CfnWebFunctionRevision`、`lambda.CfnWebFunctionEndpoint` の 3 つの L1 コンストラクトがあります。L2 コンストラクトは見つかりませんでした
- CloudFormation のテンプレートリファレンスには、`AWS::Lambda::WebFunction`、`AWS::Lambda::WebFunctionRevision`、`AWS::Lambda::WebFunctionEndpoint` のページがあります
- cdkd 0.296.28 の `src/provisioning/register-providers.ts` には、この 3 種類のプロバイダーがありません。cdkd はプロバイダーの無い種類を Cloud Control API に任せますが、Cloud Control API が対応するリソースの一覧にも、この 3 種類は載っていませんでした
- 固定している `@aws-sdk/client-lambda-web` 3.1149.0 にある操作は `GetWebAccountSettings` だけです。リビジョンを作る操作は、発表の日に公開された 3.1150.0 で入りました

つまり、この本が固定している道具のうち、Web Function を作れるのは CloudFormation だけです。バケット、ロール、ロググループは cdkd でも作れますが、1 つのスタックを 2 つの道具で分けて管理することはしません。cdkd が Web Function に対応したら、このスタックは cdkd に戻します。

タスクは `webfn:cfn:` で始まり、CLI に渡す引数は 1 つの関数が組み立てます。

<<< @/examples/69-web-functions/src/cdk-args.ts{invocation}

`deploy` には、この章だけの確認が 1 つ入っています。どのアップロードを動かすかは `-c stable=<バージョン ID>` で渡しますが、`-c` はその回の実行にしか効きません。付け忘れてデプロイすると、テンプレートからリビジョンとエンドポイントが消え、CloudFormation はそれを実物からも消しにいきます。消したエンドポイントのドメイン名は、二度と割り当てられません。そこで、`-c stable` の無いデプロイは、`--foundation` と明示したときだけ通します。

<<< @/examples/69-web-functions/test/cdk-args.test.ts{foundation}

## 最初のデプロイ

<!-- section: 69.deploy -->

前提は、[01章](/ja/chapters/01-account.md)のアカウントの準備と、`.env` の `AIH_AWS_ACCOUNT_ID` です。CloudFormation を使うので、20章の bootstrap も要ります。まだなら、一度だけ実行します。

```bash
vp run ship:cfn:bootstrap
```

デプロイは 3 段階です。リビジョンは S3 のオブジェクトのバージョンを指すので、バケットを先に作り、パッケージを置き、そのバージョン ID を渡してもう一度デプロイします。

```bash
vp run webfn:cfn:deploy --foundation
vp run webfn:upload
vp run webfn:cfn:diff -c stable=<version>
vp run webfn:cfn:deploy -c stable=<version>
```

1 行目が作るのは、バケット、バケットポリシー、実行ロール、2 つのロググループ、名前だけの Web Function です。この時点では、リクエストを受ける場所はまだありません。

2 行目は、パッケージを組み立ててバケットに置き、S3 が返したバージョン ID とチェックサムを表示します。`<version>` には、この ID を入れます。

4 行目が、リビジョンとエンドポイントを作ります。CloudFormation は、リビジョンが Active になるのを待ってから、エンドポイントを作るはずです。スタックの出力の `EndpointUrl` が、エンドポイントの URL です。CLI は出力を `examples/69-web-functions/reports/webfn-outputs.json` にも書きます。

リビジョンもエンドポイントも Active になった、というだけでは、サーバーが起動したことになりません。確かめるには、リクエストを送ります。

```bash
vp run webfn:smoke
```

エンドポイントは `IamAuth` なので、リクエストには SigV4 の署名が要ります。サービス名は `lambda` です。ふつうの AWS の API と違う点が 1 つあり、ボディが無いリクエストにも `x-amz-content-sha256` ヘッダーを付けます。Lambda は署名を確かめるときにボディを読まず、このヘッダーの値をボディのハッシュとして使うからです。

<<< @/examples/69-web-functions/src/sign.ts{sign}

`webfn:smoke` は、次の順に確かめます。署名のないリクエストが断られること。署名した `GET /health` に答えること。ノートを作り、読み、消せること。そして `GET /health` を 20 回送り、レスポンスの `x-aih-release` ごとに数を数えます。リビジョンが 1 つなら、20 回とも同じ値になるはずです。

うまくいかないときは、レスポンスの状態コードとヘッダーから読みます。403 は署名か権限の問題です。502 で `lambda-web-error-type` が `Application.TimeoutListenError` なら、サーバーが待ち受けを始めていません。`/aih/web-notes.local` のログで、起動のときのエラーを探します。409 は、リビジョンかエンドポイントが Active ではありません。

## リビジョンを切り替える

<!-- section: 69.rollout -->

コードを変えたら、もう一度アップロードします。同じキーに置くので、バケットには新しいバージョンができ、古いリビジョンが指しているバージョンはそのまま残ります。

```bash
vp run webfn:upload
vp run webfn:cfn:deploy -c stable=<v1> -c canary=<v2> -c canaryWeight=10
vp run webfn:smoke --count 100
```

`-c` の 3 つの値は、1 つのスキーマで検査してから重みに直します。エンドポイントが受け付ける重みは、1 から 100 までの整数で、合計がちょうど 100、リビジョンは 2 つまでです。

<<< @/examples/69-web-functions/src/release.ts{release}

<<< @/examples/69-web-functions/src/release.ts{weights}

スタックは、アップロードごとに別のリソースとしてリビジョンを作ります。CloudFormation では、リビジョンのプロパティを書き換えると置き換えになり、古いほうは消されます。2 つのリビジョンを同時に動かすには、古いリビジョンのリソースに触れずに、新しいリビジョンを隣に足す必要があります。論理 ID をバージョン ID から作っているのは、そのためです。

<<< @/examples/69-web-functions/infra/test/web-functions-stack.test.ts{two-revisions}

canary の様子は、`webfn:smoke --count 100` の出力と、ログの `release` の欄で見ます。メトリクスの `HTTPResponseStatusClass5XX` にはリビジョンの次元が無いので、5xx が増えても、どちらのリビジョンが出したのかはメトリクスからはわかりません。メモリ上のノートは実行環境ごとに別なので、2 つのリビジョンに振り分けているあいだ、作ったノートが読めないことも増えます。

問題がなければ、新しいアップロードを `stable` にします。問題があれば、`canary` を外してもう一度デプロイします。

```bash
vp run webfn:cfn:deploy -c stable=<v2>
vp run webfn:cfn:deploy -c stable=<v1>
```

1 行目が昇格、2 行目が canary の最中のロールバックです。ロールバックは、canary を足す前と同じ引数でデプロイするだけです。

<<< @/examples/69-web-functions/test/release.test.ts{canary}

[31章](/ja/chapters/31-progressive-delivery.md)では、エイリアスの重みを動かすスクリプトを自分で書き、アラームを見て戻す処理まで持ちました。Web Function では、重みはエンドポイントのプロパティで、2 つのリビジョンに振り分ける仕組みは最初からあります。ただし、この章の手順には、31章にあったものが 2 つ欠けています。

1 つは、自動で戻す仕組みです。重みを進めるのも戻すのも、人がデプロイを実行します。Web Function と CodeDeploy の組み合わせについては、公式ドキュメントに記述を見つけられませんでした。

もう 1 つは、戻す先です。昇格すると、古いリビジョンはテンプレートから消え、CloudFormation が実物も消します。そのあとで `-c stable=<v1>` に戻すと、同じオブジェクトのバージョンから新しいリビジョンが作られます。エイリアスの重みを戻すのと違って、リビジョンが Active になるまでの時間がかかり、新しい実行環境の起動も待つことになります。昇格の直後に戻せるようにしておきたいなら、`-c stable=<v2> -c canary=<v1> -c canaryWeight=1` のように、古いリビジョンに 1 だけ重みを残す方法があります。

重みの変更は、エンドポイントの非同期の更新です。API を直接呼ぶなら `updateStatus` が `Successful` になるのを待ちますが、CloudFormation がそこまで待ってからデプロイを完了にするのかは、確かめていません。デプロイが終わった直後の `webfn:smoke` の割合が期待と違っていたら、少し置いてからもう一度実行します。

アップロードを変えずに設定だけを変える場合、たとえば `-c allowedOrigin=...` を足す場合は、同じ論理 ID のリビジョンが置き換えられます。すべてのリクエストが一度に新しいリビジョンへ移り、canary にはなりません。

次の[費用、注意点、片付け](/ja/chapters/69-web-functions/wrap.md)で、料金と片付けを見ます。
