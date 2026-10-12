---
title: "21 Security: しくみと実装"
---

# 21 Security: しくみと実装

## wildcard を見つける assertion

<!-- section: 21.iam-lint -->

「`*` を使わない」は、言うのは簡単で、守り続けるのが難しいルールです。動かなくて困ったとき、`Resource: "*"` にすると動いてしまうので。

なので、テストに見張らせます。synth した template を読んで、広すぎる Allow を報告する関数です。

<<< @/examples/21-security/src/iam-lint.ts{lint}

見ているのは次の 6 つです。

- action の wildcard（`s3:*`、`s3:Get*`、`*`）
- resource が `"*"` そのもの
- `Allow` と `NotAction` の組み合わせ（「これ以外ぜんぶ許可」）
- `Allow` と `NotResource` の組み合わせ
- 広い AWS 管理 policy（`AdministratorAccess`、`PowerUserAccess`、`〜FullAccess`）
- 条件なしで誰でも assume できる trust policy

そして 7 つ目。読めなかった policy は、合格にせず `unreadable` として報告します。知らない形のものを「問題なし」と言わないためです。

`Deny` の statement は見ません。`Deny` の `*` は、たいてい意図どおりです。

### 理由つきの例外

ところが、`Resource: "*"` を避けられない action があります。20章の DriftRole にあった `logs:DescribeLogGroups` がそうでした。一覧を取る操作には、絞る対象の ARN がそもそもありません。

「じゃあ lint を切ろう」となると、振り出しに戻ります。なので例外を、理由と一緒にファイルに書きます。

<<< @/examples/21-security/src/iam-lint.ts{exception}

例外は「この action は `Resource: "*"` でよい」という 1 行で、理由が必須です。20 文字未満の理由は通りません。action に wildcard は書けないので、`logs:Describe*` をまとめて見逃すこともできません。

もう 1 つ仕掛けがあります。使われていない例外も、エラーです。policy を直して `*` が要らなくなったのに、例外だけが残っている。それは、次に誰かが足す `*` を黙って通す穴になります。

CDK のテストからは、こう呼びます。

<<< @/examples/21-security/src/iam-lint.ts{assert}

### 本全体に当ててみる

この lint はタスクにもなっています。`cdk.out` を渡すと、中の template を全部読みます。

```bash
vp run infra:synth
vp run sec:iam:lint examples/20-shipping/cdk.out examples/19-observability/cdk.out
```

これは手元だけで完結します。AWS には触りません。

この本のすべての章の `cdk.out` を渡した結果は、21 個の template のうち 19 個が例外なしで合格でした（2026-10-12、手元で実行）。残りの 2 つが、例外を必要とします。

- `AihShipCi`（20章の CI の role）: 5 つ。20章が「対象を ARN で絞る書き方を持たない」と書いていた action です
- `AihObservability`（19章）: 2 つ。`xray:PutTraceSegments` と `xray:PutTelemetryRecords`。CDK が `lambda.Tracing.ACTIVE` のときに足す権限です

どちらも、AWS が公開している service reference で、resource type が 1 つも定義されていないことを確かめてから、例外のファイルに入れました。

<<< @/examples/21-security/policies/iam-lint-exceptions.json

19章も 20章も、自分のテストの中で「`*` はこの action だけ」と固定していました。やっていることは同じです。違いは、理由がテストのコメントではなく、レビューできるデータになったことです。

この lint が見ないものも書いておきます。`arn:aws:logs:...:log-group:AihShipApi*` のような、途中まで絞った pattern は通します。それが十分に狭いかどうかは、人が読んで決めることです。S3 の bucket policy や KMS の key policy のような、resource 側の policy も見ていません。合格は「見た範囲に、広すぎる Allow が無かった」という意味です。

## secret を環境変数に置かない

<!-- section: 21.secret -->

04章で、こう書きました。Lambda の環境変数は、関数の設定を見られる人なら誰でも読める。だから秘密は、実行時に取ってくる。Lambda のドキュメントも、認証情報や API キーには、環境変数ではなく Secrets Manager を使うよう勧めています。

まず、secret を作ります。

<<< @/examples/21-security/infra/lib/security-stack.ts{secret}

値はどこにも書いていません。`generateSecretString` は「64 文字の値を作って、JSON の `key` に入れて」という指示です。template に入るのは、この指示だけ。

ここで cdkd の話を 1 つ。CloudFormation は、この値を AWS の側で生成します。固定した版の cdkd（0.296.28）は、ソースを読むと、値を cdkd のプロセスの中で生成して、`CreateSecret` に渡しています。つまり値は一瞬、デプロイしているマシンのメモリを通ります。ログには出さない作りになっていますが、「どこにも存在しなかった」とは言えません。気になるなら、デプロイのあとで一度 rotation してください。手順はこのあとにあります。

関数に渡すのは、secret の ARN だけです。

<<< @/examples/21-security/src/env.ts{env}

値そのものを環境変数に入れる方法も、CloudFormation にはあります。`{{resolve:secretsmanager:...}}` という dynamic reference です。でもそれをやると、解決された値が関数の設定に入って、04章の話に戻ってしまいます。テストは、template にこの文字列が無いことを見ています。

### 読む側

アプリは Secrets Manager を直接は知りません。知っているのは、この 1 行だけです。

<<< @/examples/21-security/src/secret-source.ts{source}

`read` に渡すのは staging label です。Secrets Manager は secret の値を version として持っていて、そのうち 3 つに名札を付けています。`AWSCURRENT`（いまの値）、`AWSPREVIOUS`（1 つ前）、`AWSPENDING`（rotation の途中）。何も指定しないで読むと、`AWSCURRENT` が返ります。

本物につなぐ adapter は、これだけです。

<<< @/examples/21-security/src/secrets-manager-source.ts{adapter}

細かいところを 3 つ。

1 つ目。応答は Zod の schema に通します。SDK の型は `SecretString?: string` と言っているだけで、中身が JSON なのか、`key` があるのかは保証しません。

<<< @/examples/21-security/src/secret-source.ts{payload}

エラーメッセージに値を入れていないのに注目してください。「値が JSON じゃない: `<値>`」と書くと、その行がログに残ります。テストは、形の違う値を読ませて、エラーの文字列に値が含まれないことを見ています。

2 つ目。一度も rotation していない secret には、`AWSPREVIOUS` がありません。そのときは `null` を返します。エラー名が `ResourceNotFoundException` だというのは、API リファレンスと SDK の型からの想定で、実機では確かめていません。違っていた場合、例外がそのまま上がって、鍵の読み込みが失敗します。黙って進むことはありません。

3 つ目。権限が無いときは、専用のエラーにします。「Secrets Manager が落ちている」と「読む権限が無い」は、対処が違うからです。これは後半の IAM の話につながります。

### 手元では

```bash
vp run dev:sec
```

手元の server は、起動のたびに鍵を作ってメモリに持ちます。AWS は呼びません。`.env` に入れる秘密もありません。

<<< @/examples/21-security/src/compose.ts{compose}

本物の Secrets Manager を手元から読む設定も、あえて用意していません。開発者の端末に本番の鍵が降りてくる経路は、無いほうがいいので。

## cache と rotation のあいだ

<!-- section: 21.keyring -->

毎回のリクエストで Secrets Manager を呼ぶのは、遅くて、お金がかかります（API 呼び出し 1 万回で USD 0.05）。AWS も、値を手元に cache するよう勧めています。

ただ、公式の cache 用の部品は Java、Python、.NET、Go、Rust 用で、JavaScript 用は挙がっていません。Lambda 向けには、Parameters and Secrets Lambda Extension と、Powertools for AWS Lambda という選択肢があります。この章では、何が起きるかを見たいので、小さな cache を自分で書きました。本番で自作を勧めているわけではありません。

<<< @/examples/21-security/src/keyring.ts{keyring}

cache すると、分散システムの問題が 1 つ生まれます。Lambda の実行環境は、それぞれ自分の cache を持っています。読み込んだ時刻もばらばらです。そこで secret を入れ替えると、どうなるでしょう。

```figure
caption: secret を入れ替えると、cache を読み込んだ時刻が違う 2 つの実行環境が、しばらく別々の鍵で署名する
type: sequence
actor sm: Secrets Manager
actor a: 実行環境 A
actor b: 実行環境 B
note sm: t0: v1 = AWSCURRENT
note a: v1 を cache
note b: v1 を cache
step sm -> sm: t1: rotate, v2 = AWSCURRENT
note sm: v1 = AWSPREVIOUS
note a: まだ v1 で署名
note b: まだ v1 で署名
step a -> sm: t2: cache が切れて読み直す
note a: v2 で署名
step a -> b: t3: v2 で署名した token
step b -> sm: cache に v2 がないので読み直す
note b: 受け入れる
step b -> a: t4: v1 で署名した token
note a: v1 = AWSPREVIOUS なので受け入れる
step b -> sm: t5: cache が切れて読み直す
note b: v2 で署名
```

t1 から t5 のあいだ、2 つの鍵が同時に使われています。どちらで署名した token も、どちらの実行環境でも通らないといけません。守りたいことを 1 文にします。

**期限内の token は、どの実行環境でも検証を通る。rotation の前に発行されたものも、後に発行されたものも。**

そのための仕掛けは 3 つです。

まず、token に「どの version の鍵で署名したか」を入れます。

<<< @/examples/21-security/src/token.ts{sign}

次に、検証する側は `AWSCURRENT` と `AWSPREVIOUS` の両方を持ちます。t4 の A が、古い鍵の token を通せるのはこのためです。

最後に、知らない version id を見たら、読み直します。t3 の B です。ここが少し怖いところで、version id は token の一部なので、誰でも好きな文字列を送れます。でたらめな id を送るたびに Secrets Manager を呼んでいたら、攻撃者に請求書を書かせることになります。なので、読み直しには最短の間隔（30 秒）を付けました。

<<< @/examples/21-security/src/app.ts{check}

「知らない version」と「署名が違う」には、同じ応答を返します。どの version が存在するかを、外から探れないように。

テストは、1 つの時計と 1 つの secret を、複数の実行環境で共有する形で書いてあります。図の t3 と t4 は、そのままテストになっています。ほかに、こういう順序も再現します。

- でたらめな version id を 1000 回送っても、Secrets Manager への読み取りは増えない。30 秒たつと、1 回だけ読み直す
- 50 個のリクエストが同時に来ても、読み込みは 1 回
- Secrets Manager が応答しなくなっても、持っている鍵で検証を続ける。失敗した読み込みを、リクエストのたびに繰り返さない
- 一度も鍵を読めていない実行環境は、エラーにする。このとき API は 503 を返します

そして、わざと invariant を壊すテストも 1 つあります。rotation を 2 回続けると、最初の鍵は `AWSPREVIOUS` からも外れて、その鍵で署名した token は、期限内でも通らなくなります。これは cache の側では防げません。次の節の、rotation の手順で防ぎます。

## rotation の手順

<!-- section: 21.rotation -->

この secret は、データベースのパスワードのように「相手側の設定も変える」必要がありません。自分で決めて、自分で使う鍵です。だから rotation は、新しい値を書くだけで済みます。

`PutSecretValue` は、staging label を指定しないで呼ぶと、新しい version に `AWSCURRENT` を付け、それまでの `AWSCURRENT` に `AWSPREVIOUS` を付け直してくれます。さっきの図の t1 が、API 1 回で起きます。

<<< @/examples/21-security/src/secrets-manager-source.ts{rotation-adapter}

`ClientRequestToken` が要です。API リファレンスによると、この値が新しい version の id になり、同じ token と同じ値でもう一度呼んでも、何も起きずに成功します。値が違えば失敗します。

これを使って、手順を「途中で止まっても、もう一度実行すればいい」形にします。

<<< @/examples/21-security/src/rotation.ts{rotate}

順に見ていきましょう。

最初に、いまの label を読みます。`AWSCURRENT` がもう今回の version id なら、前回の実行は成功していて、応答だけが失われたということです。何もしません。ここで素直に書き込みに行くと、新しい id で 2 回目の rotation が走って、さっきの「2 回続けると壊れる」を自分で踏みます。

次に、前回の rotation からの時間を見ます。token の有効期間（5 分）と cache の期間（5 分）を足した 10 分が過ぎるまでは、次の rotation を断ります。鍵が漏れたときは待っていられないので、`--force` で越えられます。そのときは、期限内の token が一部通らなくなることを承知のうえで。

書いたあと、もう一度 label を読みます。呼び出しが成功を返したことではなく、label が期待した位置にあることを確かめます。検証する側が見るのは label だからです。

```bash
vp run sec:secret:versions
vp run sec:secret:rotate
```

`rotate` は、最初に今回の version id を表示します。応答が失われて失敗したら、`--version-id <表示された id>` を付けて再実行します。新しい鍵はスクリプトの中で作って、そのまま Secrets Manager に送ります。画面にも、ファイルにも出しません。

テストは、応答の喪失を決まった順序で再現します。書き込みは成功させて、そのあとで例外を投げる。同じ version id で再実行する。書き込みが 1 回で、version が 2 つのままであることを確かめます。

rotation の頻度にも上限があります。API リファレンスは、`PutSecretValue` を 10 分に 1 回より速いペースで呼び続けないよう書いています。Secrets Manager が残す version は直近 100 個ですが、24 時間以内に作られたものは消さないので、速く呼びすぎると version の数が上限に届きます。

### 自動の rotation

Secrets Manager には、決まった間隔で自動的に rotation する仕組みもあります。Lambda 関数が、新しい version を作る、相手のサービスに設定する、試す、label を付け替える、という 4 段階を実行します。データベースのパスワードなら、これが本筋です。

この章では実装していません。入れ替える相手のサービスが無いので、4 段階のうち 2 つは空になります。そして rotation 用の関数も、secret を書ける権限を持った、守るべきものの 1 つになります。

## 鍵は誰のものか

<!-- section: 21.kms -->

Secrets Manager は、secret を AWS KMS の鍵で暗号化して保存します。どの鍵を使うかは選べます。

何も指定しなければ、`aws/secretsmanager` という AWS managed key です。AWS があなたのアカウントの中に作って、管理する鍵。月額はかかりません。KMS のドキュメントも、「鍵を自分で管理する必要が無いなら、AWS managed key は良い選択」と書いています。

`-c cmk=on` を付けると、自分で作る鍵（customer managed key）に変わります。

<<< @/examples/21-security/infra/lib/security-stack.ts{key}

得られるのは、鍵に対する決定権です。誰がこの鍵を使えるかを key policy で決められる。鍵を無効にすれば、secret を読む権限を持つ人も、読めなくなる。別のアカウントに使わせることもできる。

失うのは、月 USD 1 です。時間割りで、鍵を消すまで。しかも、自動の rotation を有効にしていると、1 回目と 2 回目の rotation のたびに月 USD 1 ずつ増えて、3 年目からは月 USD 3 で止まります。

関数の権限も 1 つ増えます。customer managed key で暗号化した secret を読むには、その鍵で復号する権限が要るからです。role の節のコードを見返してください。`kms:Decrypt` には `kms:ViaService` という条件が付いています。「Secrets Manager 経由でだけ使える」という意味で、関数がこの鍵を直接呼んで、別のものを復号することはできません。

もう 1 つ、customer managed key の意外な副作用があります。Inspector のドキュメントによると、Inspector は、customer managed key で暗号化された Lambda 関数を検査しません。この章の関数は、環境変数を暗号化する鍵を指定していないので当てはまりませんが、「鍵は全部自分で持つ」という方針にすると、別の守りが 1 つ外れることがあります。

消すときも、ふつうのリソースと違います。KMS の鍵は、すぐには消えません。7 日から 30 日の待機期間があって、その間は使えず、取り消せば戻ります。この鍵で暗号化したデータは、鍵が消えたら二度と読めないからです。固定した版の cdkd は、template に指定した日数（この章は 7 日）で削除を予約します。

個人のアカウントなら、AWS managed key で十分です。customer managed key が要るのは、「誰が復号できるか」を secret の権限とは別に管理したいとき、監査で鍵の管理を求められるとき、アカウントをまたいで共有するときです。
