---
title: "10 Edge: デプロイ"
---

# 10 Edge: デプロイ

[前のページ](/ja/chapters/10-edge/local.md)までで、エッジの関数と、KVS を書き換える同期のスクリプトが手元で動きました。このページでは、両方を AWS にデプロイする手順を書き、後半で Lambda@Edge を 1 つ足します。

## AWS にのせる準備

<!-- section: 10.infra -->

CDK のスタックは、03章のスタックに KVS を足したものです。

<<< @/examples/10-edge/infra/lib/edge-stack.ts{store}

KVS は空で作ります。CDK には、作成時にファイルからキーと値を取り込む指定（import source）もありますが、使いませんでした。取り込めるのは KVS を最初に作るときだけで、あとから `edge-data.json` を直しても反映されず、反映させようとすると KVS の作り直しになるからです。そこで、KVS そのものはスタックが管理し、中身は `edge-data.json` と同期のスクリプトが管理するように、持ち主を分けました。

作った直後の KVS は空ですが、問題はありません。関数は、キーが無ければ何もせずにリクエストを通すように書いてあります。

<<< @/examples/10-edge/infra/lib/edge-stack.ts{router}

`keyValueStore` を渡すと、CDK は関数と KVS を関連付けます。ランタイムには 2.0 を明示しています。

テスト（`infra/test/edge-stack.test.ts`）は、次のことを確かめます。バケットが非公開で、読めるのがこのディストリビューションだけであること。関数がランタイム 2.0 で、KVS がちょうど 1 つ付いていること。KVS が空で作られ、スタックと一緒に消えること。そして、使っているリソースの種類の一覧です。

### cdkd でのリソースの扱い

固定した版の cdkd（0.296.28）のソースを読んで、リソースの種類ごとの扱いを調べました。

| リソースの種類 | cdkd での扱い |
| --- | --- |
| `AWS::S3::Bucket`、`AWS::S3::BucketPolicy` | 専用の実装 |
| `AWS::CloudFront::Distribution`、`AWS::CloudFront::OriginAccessControl` | 専用の実装 |
| `AWS::CloudFront::Function` | Cloud Control API 経由 |
| `AWS::CloudFront::KeyValueStore` | Cloud Control API 経由。stateful 扱い |

「stateful 扱い」とは、消えるとデータが失われる種類の一覧に、cdkd が KVS を入れているという意味です。名前の変更のように KVS の置き換えが必要な変更をしようとすると、cdkd は止まり、`--force-stateful-recreation` を付けて実行し直すよう求めます。中身は同期のスクリプトでいつでも入れ直せるので、この章の KVS なら付けて構いません。ただし、作り直した直後の KVS は空です。関数は空でも動きますが、リダイレクトとフラグは、もう一度同期するまで効きません。

以上はソースから読み取ったことで、実際の AWS で cdkd がこれらのリソースを作れるかは、まだ確かめていません。

## デプロイと切り替え

<!-- section: 10.deploy -->

```bash
vp run edge:infra:diff
vp run edge:infra:deploy
vp run edge:publish
```

この 3 つのコマンドで、差分を確認してからスタックをデプロイし、`site/` の 3 つの HTML をバケットに置きます。この時点では KVS が空なので、`/` は `index.html` を返し、`/plans` は 404 になります。

次に、表を KVS に入れます。先に差分を確認し、それから書き込みます。

```bash
vp run edge:kvs:plan
vp run edge:kvs:sync
```

`edge:kvs:plan` は KVS を読むだけで、何も変えません。`edge:kvs:sync` は、送った計画と新しい ETag を表示します。

```bash
curl -sI https://dxxxxxxxxxxxx.cloudfront.net/plans | head -n 3
```

301 と `location: /pricing/` が返れば、表が届いています。同期の直後に試して 404 だったら、少し待ってからもう一度試してください。[前のページの図](/ja/chapters/10-edge/local.md)でいう t0 と t2 のあいだで、値がまだそのエッジロケーションに届いていないだけかもしれません。

メンテナンスのスイッチも試します。`edge-data.json` の `maintenance` を `true` にして同期し、状態コードを何度か確認します。

```bash
vp run edge:kvs:sync
curl -s -o /dev/null -w '%{http_code}\n' https://dxxxxxxxxxxxx.cloudfront.net/
```

200 と 503 が混ざる時間があるかもしれません。結果整合とは、この状態のことです。確認が終わったら `false` に戻して、もう一度同期してください。

ドリフトの検査は、これまでの章と同じです。

```bash
vp run edge:infra:drift
```

KVS の中身（キーと値）はテンプレートに無いので、ドリフトの検査の対象外です。中身のずれは `edge:kvs:plan` で確認します。コンソールなど、同期のスクリプト以外の手段で誰かが書き換えていれば、差分として表示されます。

この節の手順は、まだ実際の AWS で通せていません。

## Lambda@Edge でボディを読む

<!-- section: 10.lambda-edge -->

CloudFront Functions では足りなくなる場面は決まっています。外部の API やデータベースを呼びたいとき、リクエストボディを見たいとき、ミリ秒では終わらない処理をしたいとき、オリジンの手前や直後で動かしたいとき、npm のライブラリを使いたいときです。

そのときの選択肢の 1 つが Lambda@Edge です。通常の Lambda 関数（[04章](/ja/chapters/04-http-api.md)）を CloudFront が各地に複製し、リクエストの途中で呼びます。ネットワークに出られますし、ボディも読めます。その代わり、Lambda としては制約が多くなります。

- 関数は `us-east-1` に作ります。東京には作れません
- 番号つきのバージョンを指定します。`$LATEST` もエイリアスも使えないので、コードを直すたびに新しいバージョンを作り、ディストリビューションを更新します
- 予約済みのものを除いて、環境変数が使えません。設定はコードに埋め込むか、実行時にどこかから取得します
- VPC に入れられません。レイヤー、X-Ray、デッドレターキュー、provisioned concurrency、コンテナイメージも使えません
- arm64 が使えません。x86_64 だけです
- 実行ロールは、`lambda.amazonaws.com` と `edgelambda.amazonaws.com` の両方が引き受けられる必要があります
- タイムアウトは 30 秒までです
- 関数が作る応答の大きさは、viewer 側のイベントで 40 KB、origin 側で 1 MB までです
- ボディは、viewer request で 40 KB、origin request で 1 MB に切り詰められます。それより長いボディは、先頭の部分だけが渡されます

関数の組み合わせにも決まりがあります。1 つのビヘイビア（cache behavior）の 1 つのイベントに付けられる関数は 1 つだけです。また、viewer 側のイベント（viewer request と viewer response）では、CloudFront Functions と Lambda@Edge を混ぜられません。viewer request に CloudFront Function、origin request に Lambda@Edge という組み合わせは許されていて、この章はその構成をとります。

### 最小の例として、ボディのダイジェストを返す

CloudFront Functions には決してできないことを、小さな例で 1 つ試します。POST されたボディの大きさと SHA-256 を返す関数です。

<<< @/examples/10-edge/src/lambda-edge/body-digest.ts{digest}

この関数は origin request で動き、オリジンには問い合わせずに自分で応答を返します。応答に `truncated` を入れているのは、1 MB を超えたボディでは、関数に渡されるのが先頭の部分だけだからです。先頭だけのダイジェストを、全体のダイジェストであるかのように返すわけにはいきません。

この関数は、動くことを確かめるための例です。実際の用途で近いのは、webhook の署名の検証でしょう。ボディ全体の HMAC を計算し、合わなければオリジンに届く前に断ります。ただし、検証には秘密の鍵が要ります。環境変数は使えないので、Secrets Manager などへネットワーク越しに取りに行くことになり、遅延と料金と権限を考える必要が出てきます。エッジで処理することの代償は、多くの場合こうした形で現れます。

イベントは型の外から来る値なので、使う部分だけをスキーマで確かめます。

<<< @/examples/10-edge/src/lambda-edge/body-digest.ts{event}

### 東京の外にあるスタック

<<< @/examples/10-edge/infra/bin/app.ts{stacks}

Lambda@Edge の関数は `us-east-1` にしか作れないので、このスタックだけリージョンが違います。ディストリビューションのあるスタックとは別にし、バージョンの ARN を手で渡してつなぐ形にしました。CDK には、リージョンをまたいで自動でつなぐ仕組み（`EdgeFunction`）もあります。ただ、この仕組みを使うと、裏でカスタムリソースと別のスタックが増え、cdkd がそれをどう扱うかを追いきれませんでした。そのため、何が作られるかがすべて見える形を選んでいます。

<<< @/examples/10-edge/infra/lib/body-digest-stack.ts{role}

ログの権限では、リージョンに `*` を使っています。この本では `*` を使わない方針を守ってきましたが、ここでは避けられません。Lambda@Edge の関数は、実行された場所に近いリージョンにログを書き、どのリージョンで動くかは読者の居場所で決まるからです。ロググループの名前は、どのリージョンでも `/aws/lambda/us-east-1.<関数名>` になるので、名前のほうは固定してあります。

<<< @/examples/10-edge/infra/lib/body-digest-stack.ts{function}

`awsSdkConnectionReuse: false` は見落としやすい設定です。CDK の `NodejsFunction` は、何も指定しなければ環境変数を 1 つ足します。Lambda@Edge は環境変数を持つ関数を受け付けないので、足さないようにしています。テストは、テンプレートに環境変数、VPC、レイヤーの設定が無いことを確かめています。

ディストリビューションの側では、バージョンの ARN を受け取ったときだけビヘイビアを足します。

<<< @/examples/10-edge/infra/lib/edge-stack.ts{digest}

このビヘイビアはキャッシュを無効にしていて、すべてのメソッドを受け付けます。通したいのは POST だけですが、CloudFront で選べるのは「GET と HEAD」「それに OPTIONS を加えたもの」「全部」の 3 つで、POST は「全部」にしか入っていません。このままでは、GET でも DELETE でも、1 リクエストごとに Lambda@Edge が動いて料金がかかります。

そこで、手前の CloudFront Function で POST 以外を断ります。

<<< @/examples/10-edge/infra/functions/edge-router.js{digest}

[最初のページ](/ja/chapters/10-edge.md)で読んだ `handler` の先頭の 3 行が、この `methodNotAllowed` を呼んでいます。KVS を読む前に返すので、断るのにかかるのは CloudFront のリクエスト料金と、関数の実行 1 回だけです。

POST は止めません。POST が来れば、そのたびに Lambda@Edge が動きます。回数に上限を付ける部品は、この構成には入っていません。数字は[費用のページ](/ja/chapters/10-edge/wrap.md)の「叩かれたら」に書きます。試し終わったら、`-c bodyDigestVersionArn` なしでデプロイし直し、このビヘイビアごと外しておくのがいちばん確実です。

ARN の形は、スタックに渡す時点で検査しています。

<<< @/examples/10-edge/infra/lib/edge-stack.ts{props}

`$LATEST`、エイリアス、別のリージョンの ARN は、synth の段階でエラーになります。デプロイの途中で CloudFront に断られるより、ずっと早く気づけます。

### デプロイの手順

```bash
AIH_AWS_REGION=us-east-1 vp run infra:bootstrap
vp run edge:body:infra:deploy
vp run edge:infra:deploy -c bodyDigestVersionArn=arn:aws:lambda:us-east-1:123456789012:function:aih-edge-body-digest:1
curl -s -X POST --data 'hello edge' https://dxxxxxxxxxxxx.cloudfront.net/digest
```

2 行目の出力に `BodyDigestVersionArn` が出るので、その値を 3 行目に渡します。

この手順は、この章の中でいちばん確かめられていない部分です。cdkd のソースを読むかぎり、スタックにリージョンが書いてあれば、cdkd はそのリージョンを使います。ビルドした関数のコードを置く場所も `us-east-1` に要りそうなので、1 行目で用意しています。ただし、どのコマンドも実行していません。cdkd は `AWS::Lambda::Version` を Cloud Control API 経由で扱います（`AWS::Lambda::Function`、`AWS::IAM::Role`、`AWS::IAM::Policy` は専用の実装です）。Node.js 24 が Lambda@Edge で使えることも、個別には確認していません。ドキュメントには「最新の Node.js に対応」としか書かれていないからです。
