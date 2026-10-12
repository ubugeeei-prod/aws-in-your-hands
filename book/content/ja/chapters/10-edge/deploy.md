---
title: "10 Edge: デプロイ"
---

# 10 Edge: デプロイ

## AWS にのせる準備

<!-- section: 10.infra -->

CDK の stack は、03章のものに KVS を足した形です。

<<< @/examples/10-edge/infra/lib/edge-stack.ts{store}

KVS は空で作ります。CDK には、作成時にファイルからキーと値を取り込む指定（import source）もあるのですが、使いませんでした。取り込みができるのは、KVS を最初に作るときだけです。あとから `edge-data.json` を直しても反映されず、反映させようとすると KVS の作り直しになります。「入れ物は stack のもの、中身は `edge-data.json` と sync のもの」と、持ち主を分けました。

作りたての KVS は空っぽですが、それで構いません。関数は、キーが無ければ何もせずに通すように書いてあります。

<<< @/examples/10-edge/infra/lib/edge-stack.ts{router}

`keyValueStore` を渡すと、CDK は関数と KVS を関連付けます。runtime は 2.0 を明示しています。

テスト（`infra/test/edge-stack.test.ts`）が見ているのは、bucket が非公開で、読めるのがこの distribution だけであること。関数が runtime 2.0 で、KVS がちょうど 1 つ付いていること。KVS が空で作られ、stack と一緒に消えること。そして、使っているリソースの種類の一覧です。

### cdkd はこのリソースをどう扱うか

固定した版の cdkd（0.296.28）のソースを読みました。

| リソースの種類 | cdkd での扱い |
| --- | --- |
| `AWS::S3::Bucket`、`AWS::S3::BucketPolicy` | 専用の実装 |
| `AWS::CloudFront::Distribution`、`AWS::CloudFront::OriginAccessControl` | 専用の実装 |
| `AWS::CloudFront::Function` | Cloud Control API 経由 |
| `AWS::CloudFront::KeyValueStore` | Cloud Control API 経由。stateful 扱い |

「stateful 扱い」というのは、cdkd が「消えるとデータが失われる種類」の一覧に KVS を入れている、という意味です。KVS の置き換えが必要な変更（名前を変える、など）をしようとすると、cdkd は止まって、`--force-stateful-recreation` を付けて実行し直すよう求めます。中身は sync でいつでも入れ直せるので、この章の KVS なら付けて構いません。ただし、作り直した直後の KVS は空です。関数は空でも動きますが、redirect と flag は、もう一度 sync するまで効きません。

ここまではソースから読み取ったことで、実際の AWS で cdkd がこれらを作れるかは、まだ確かめていません。

## デプロイして、切り替えてみる

<!-- section: 10.deploy -->

```bash
vp run edge:infra:diff
vp run edge:infra:deploy
vp run edge:publish
```

`site/` の 3 つの HTML を bucket に置くところまでです。この時点で KVS は空なので、`/` は `index.html` を返し、`/plans` は 404 になります。

次に、表を入れます。まず差分を見て、それから書きます。

```bash
vp run edge:kvs:plan
vp run edge:kvs:sync
```

`edge:kvs:plan` は KVS を読むだけで、何も変えません。`edge:kvs:sync` は、送った計画と、新しい ETag を表示します。

```bash
curl -sI https://dxxxxxxxxxxxx.cloudfront.net/plans | head -n 3
```

301 と `location: /pricing/` が返れば、表が届いています。sync の直後に試して 404 だったら、少し待ってもう一度。さっきの t0 と t2 のあいだにいるだけかもしれません。

メンテナンスのスイッチも試しましょう。`edge-data.json` の `maintenance` を `true` にして sync し、状態コードを何度か見ます。

```bash
vp run edge:kvs:sync
curl -s -o /dev/null -w '%{http_code}\n' https://dxxxxxxxxxxxx.cloudfront.net/
```

200 と 503 が混ざる時間があるかもしれません。それが結果整合です。終わったら `false` に戻して、もう一度 sync してください。

drift の検査は、これまでの章と同じです。

```bash
vp run edge:infra:drift
```

KVS の中身（キーと値）は template に無いので、drift の検査の対象外です。中身のずれは `edge:kvs:plan` で見ます。sync 以外の手段（コンソールなど）で誰かが書き換えていれば、ここに差分として出ます。

正直に言うと、この節の手順は、まだ実際の AWS で通せていません。

## body を読みたくなったら: Lambda@Edge

<!-- section: 10.lambda-edge -->

CloudFront Functions で足りなくなる場面は、はっきりしています。外部の API や DB を呼びたい。リクエストの body を見たい。ミリ秒では終わらない処理をしたい。origin の手前や直後で動かしたい。npm のライブラリを使いたい。

そのときの選択肢の 1 つが Lambda@Edge です。ふつうの Lambda 関数（[04章](/ja/chapters/04-http-api.md)）を CloudFront が各地に複製して、リクエストの途中で呼んでくれます。ネットワークにも出られるし、body も読めます。そのかわり、Lambda としては窮屈な決まりがたくさんあります。

- **関数は `us-east-1` に作る。** 東京ではだめです
- **番号つきの version を指定する。** `$LATEST` も alias も使えません。コードを直すたびに新しい version を作って、distribution を更新します
- **環境変数が使えない。** 予約済みのものを除きます。設定はコードに焼き込むか、実行時にどこかから取ってきます
- **VPC に入れない。** layer、X-Ray、dead letter queue、provisioned concurrency、コンテナイメージも使えません
- **arm64 が使えない。** x86_64 だけです
- **実行 role は、`lambda.amazonaws.com` と `edgelambda.amazonaws.com` の両方が引き受けられること**
- **timeout は 30 秒まで**
- **関数が作る応答の大きさ**: viewer 側のイベントで 40 KB、origin 側で 1 MB まで
- **body を読むときの切り詰め**: viewer request で 40 KB、origin request で 1 MB。それより長い body は、頭の部分だけが渡されます

もう 1 つ、組み合わせの決まりがあります。1 つの cache behavior の、1 つのイベントに付けられる関数は 1 つだけ。そして viewer 側のイベント（viewer request と viewer response）では、CloudFront Functions と Lambda@Edge を混ぜられません。viewer request に CloudFront Function、origin request に Lambda@Edge、という組み合わせは許されています。この章の構成がそれです。

### 最小の例: body の digest を返す

CloudFront Functions に絶対できないことを 1 つ、小さくやってみます。POST された body の大きさと SHA-256 を返す関数です。

<<< @/examples/10-edge/src/lambda-edge/body-digest.ts{digest}

origin request で動いて、origin には聞かずに自分で応答を返します。`truncated` を応答に入れているのは、1 MB を超えた body では、関数が見ているのが頭の部分だけだからです。頭だけの digest を、全体の digest のような顔で返すわけにはいきません。

これ自体は、動くことを見るための例です。現実の使い道で近いのは、webhook の署名の検証でしょう。body 全体の HMAC を計算して、合わなければ origin に届く前に断る。ただ、それには秘密の鍵が要ります。環境変数は使えないので、Secrets Manager などへネットワーク越しに取りに行くことになり、今度は遅延と料金と権限の話が始まります。「edge でやる」ことの値段は、たいていこういう形で出てきます。

イベントは、型の外から来る値です。使う部分だけを schema で確かめます。

<<< @/examples/10-edge/src/lambda-edge/body-digest.ts{event}

### 東京の外にある stack

<<< @/examples/10-edge/infra/bin/app.ts{stacks}

Lambda@Edge の関数は `us-east-1` に作るしかないので、この stack だけリージョンが違います。distribution のある stack とは別にして、つなぎは version の ARN を手で渡す形にしました。CDK には、リージョンをまたいで自動でつないでくれる仕組み（`EdgeFunction`）もあります。ただ、裏で custom resource と別の stack が増えて、cdkd がそれをどう扱うかを追いきれませんでした。ここでは、何が作られるかが全部見える形を選んでいます。

<<< @/examples/10-edge/infra/lib/body-digest-stack.ts{role}

ログの権限に、リージョンの `*` が入っています。この本では「`*` を使わない」を守ってきましたが、ここは避けられません。Lambda@Edge の関数は、実行された場所に近いリージョンにログを書きます。log group の名前はどのリージョンでも `/aws/lambda/us-east-1.<関数名>` で、どのリージョンで動くかは読者の居場所で決まるからです。log group の名前のほうは固定してあります。

<<< @/examples/10-edge/infra/lib/body-digest-stack.ts{function}

`awsSdkConnectionReuse: false` は見落としやすいところです。CDK の `NodejsFunction` は、何も言わなければ環境変数を 1 つ足します。Lambda@Edge は環境変数を持つ関数を受け付けないので、止めておきます。テストは、template に環境変数、VPC、layer の設定が無いことを見ています。

distribution の側は、version の ARN をもらったときだけ behavior を足します。

<<< @/examples/10-edge/infra/lib/edge-stack.ts{digest}

ARN の形は、stack に渡す時点で検査しています。

<<< @/examples/10-edge/infra/lib/edge-stack.ts{props}

`$LATEST`、alias、別のリージョンの ARN は、synth の段階でエラーになります。デプロイの途中で CloudFront に断られるより、ずっと早く気づけます。

### デプロイの手順

```bash
AIH_AWS_REGION=us-east-1 vp run infra:bootstrap
vp run edge:body:infra:deploy
vp run edge:infra:deploy -c bodyDigestVersionArn=arn:aws:lambda:us-east-1:123456789012:function:aih-edge-body-digest:1
curl -s -X POST --data 'hello edge' https://dxxxxxxxxxxxx.cloudfront.net/digest
```

2 行目の出力に `BodyDigestVersionArn` が出るので、3 行目に渡します。

ここは、この章でいちばん確かめられていない部分です。cdkd のソースを読むかぎり、stack にリージョンが書いてあれば、cdkd はそのリージョンを使います。ビルドした関数のコードを置く場所も `us-east-1` に要りそうなので、1 行目で用意しています。ただ、どれも実行していません。cdkd は `AWS::Lambda::Version` を Cloud Control API 経由で扱います（`AWS::Lambda::Function`、`AWS::IAM::Role`、`AWS::IAM::Policy` は専用の実装）。Node.js 24 が Lambda@Edge で使えることも、個別には確認していません。ドキュメントは「最新の Node.js に対応」としか書いていないからです。
