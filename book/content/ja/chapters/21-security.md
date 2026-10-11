---
title: "21 守り、統制する: WAF、Inspector、GuardDuty、secret、KMS、CloudTrail、Config、Organizations"
revision: 1
---

# 21 守り、統制する: WAF、Inspector、GuardDuty、secret、KMS、CloudTrail、Config、Organizations

ここまで、いくつも「それは 21章で」と先送りにしてきました。01章の `AdministratorAccess` を絞る話。03章の WAF。04章の「秘密は環境変数に置かない」。この章で、まとめて引き受けます。

ただ、AWS の「セキュリティ」と名の付くサービスを全部入れよう、という章ではありません。逆です。1 人で使っているアカウントに要るものと、人やアカウントが増えてから要るものを分けて、前者だけを手を動かして入れます。後者は、何のためのものかと、いくらかかるかを押さえます。

先にお金の話を。この章の stack は、何も指定しなければ、月額がかかるのは secret 1 つだけです（月 USD 0.40、時間割り）。**KMS の鍵と web ACL は、置いてあるだけで毎月かかるので、明示的に頼んだときにしか作りません**。GuardDuty、Inspector、AWS Config は、この章の stack には入れていません。理由はあとで話します。

正直に言うと、この章の AWS 側の手順は、まだ一度も実際には動かしていません。手元で確かめたのは、テスト、型検査、synth、手元の server までです。内訳は章末にあります。

前提は [06章](/ja/chapters/06-auth.md)と [20章](/ja/chapters/20-shipping.md)です。CloudFront と function URL の組み合わせは [09章](/ja/chapters/09-ssr.md)で出てきました。コードは `examples/21-security/` にあります。

## 何から入れるか

<!-- section: 21.tiers -->

AWS のコンソールで「Security」を開くと、サービスがずらっと並びます。全部を有効にすると、毎月の請求が増えて、読まない通知が増えます。何もしないと、鍵が漏れても気づけません。

この本は、3 段に分けて考えます。

```text
tier            what                          what it costs                     how this chapter handles it
everyone        root MFA, no root access keys free                              sec:posture fails without them
                CloudTrail event history      free, always on, 90 days          sec:trail:iam reads it
                least-privilege roles         free                              wildcard lint in tests
                secrets out of env vars       per secret per month              default stack
with-data       GuardDuty (threat detection)  per event and GB, after a trial   console; sec:posture reports it
                Inspector (vulnerabilities)   per function, image, instance     console; sec:posture reports it
                AWS WAF on CloudFront         per web ACL and rule per month    opt-in stack AihSecurityWaf
                customer managed KMS key      per key per month                 opt-in: -c cmk=on
organization    CloudTrail trail              S3 storage                        explained, not created
                AWS Config                    per configuration item            explained, not created
                Organizations and SCPs        free                              policy JSON and tests only
```

1 段目は、アカウントを持った日からやることです。お金はほぼかかりません。2 段目は、漏れたら困るデータや、止まったら困るサービスを持ってから。3 段目は、関わる人やアカウントが 2 つ以上になってから。

この分け方は AWS の公式な分類ではなく、この本の判断です。あなたの事情で前後して構いません。大事なのは、「いま入れていないもの」を、忘れているのではなく選んで入れていない、と言えることです。

いまのアカウントがどの状態かは、タスクで見られます。

```bash
vp run sec:posture
```

読み取りだけで、何も変えません。6 つのサービスに聞いて、結果を 3 段に並べます。

<<< @/examples/21-security/src/posture.ts{assess}

[02章](/ja/chapters/02-toolchain.md)の drift で、「差が見つからなかった」と「全部比べて一致した」を分けましたよね。ここでも同じことをしています。権限が足りなくて読めなかった項目は、`off` ではなく `unknown` です。

<<< @/examples/21-security/src/posture.ts{snapshot}

タスクが失敗するのは、1 段目が `on` でないときだけです。

<<< @/examples/21-security/src/posture.ts{gate}

GuardDuty が無効でも、タスクは落ちません。それは選択だからです。root ユーザーに MFA が無いのは、選択ではありません。

## 全体像

<!-- section: 21.architecture -->

題材は、小さな token API です。`/token` が署名つきの token を発行し、`/verify` がそれを検証します。署名に使う鍵が、この章の「secret」です。

```text
viewer
  | HTTPS, GET and HEAD only
  v
CloudFront distribution  <---- web ACL (AihSecurityWaf, us-east-1)   only with -c webAclArn=...
  | origin access control signs each origin request (SigV4)
  v
Lambda function URL, AuthType AWS_IAM      unsigned requests get 403 before the function runs
  v
Lambda function (HandlerRole)
  | secretsmanager:GetSecretValue on one secret, about once per 5 minutes per execution environment
  v
Secrets Manager secret  <---- encrypted with aws/secretsmanager, or a customer managed key with -c cmk=on

CloudTrail event history records the management calls above (CreateRole, PutSecretValue, ...) for 90 days
```

上から順に、この章の話題が並んでいます。入口に WAF。関数の role。secret と、それを暗号化する鍵。そして、それらへの操作を記録する CloudTrail。

stack は 2 つです。

<<< @/examples/21-security/infra/bin/app.ts{stacks}

`AihSecurity` が既定の stack。`AihSecurityWaf` は、名前を指定してデプロイしたときにだけ作られます。月額がかかるものを足すスイッチは、CDK の context です。

<<< @/examples/21-security/infra/lib/config.ts{context}

[14章](/ja/chapters/14-kv-cache.md)の `-c store=valkey` と同じ考え方ですね。何も付けなければ安いほう。`-c cmk=true` のような書き間違いは、「off として扱う」のではなく synth で止めます。お金のかかるスイッチが、黙って別の意味になるのは困るので。

## 権限を絞る

<!-- section: 21.least-privilege -->

01章で `AdministratorAccess` を使ったとき、「絞る方法は 21章で」と書きました。答えは、絞る相手によって違います。

**動いているコードの権限**は、いますぐ絞れます。絞るべきなのも、まずここです。関数の role は、インターネットからのリクエストを処理するコードが使うものだからです。この章の関数が持つ権限は、これで全部です。

<<< @/examples/21-security/infra/lib/security-stack.ts{role}

自分の log group に書く。1 つの secret を読む。それだけ。`secretsmanager:*` でも、アカウントの全 secret でもありません。この関数のコードに穴があっても、攻撃者が手にするのは、この 3 つの action です。これが最小権限（least privilege）の実際の形です。

[20章](/ja/chapters/20-shipping.md)と同じく、権限は role の中に inline で書いています。AWS 管理の policy（`AWSLambdaBasicExecutionRole` など）は付けていません。04章で見たとおり、あれは「アカウントのどの log group にでも書ける」権限です。

**人の権限**は、もう少し難しい話です。この本のサンプルは、デプロイのたびに IAM の role を作ります。role を作れる人は、その role に何でも持たせられるので、実質的に管理者です。学習用のアカウントで、デプロイする人の権限だけを細かく絞っても、得るものは多くありません。

現実的な順番は、こうです。

1. 長期のアクセスキーを持たない。01章でやりました
2. ふだんの調べものには、読み取り専用の権限でサインインする。デプロイのときだけ、強い権限に切り替える
3. デプロイは人の手から CI の role に移す。20章でやりました。あの role は、決まった repository の決まった job からしか使えません
4. それでも人に強い権限が残るなら、使った実績から絞る

4 には道具があります。IAM Access Analyzer の policy generation は、CloudTrail の記録を最大 90 日ぶん読んで、その role や user が実際に使った action だけを並べた policy のひな形を作ってくれます。ただし、読む元として CloudTrail の trail が要ります。あとで出てくる「trail を作る理由」の 1 つです。この機能は、この本では試していません。

もう 1 つ、強い権限を持つ人にも効く歯止めがあります。Organizations の SCP です。章の後半で扱います。

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
- `AihObservability`（19章）: 2 つ。`xray:PutTraceSegments` と `xray:PutTelemetryRecords`。CDK が `Tracing.ACTIVE` のときに足す権限です

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

```text
time   Secrets Manager          environment A              environment B
t0     v1 = AWSCURRENT          caches v1                  caches v1
t1     rotate:
       v2 = AWSCURRENT
       v1 = AWSPREVIOUS         still signs with v1        still signs with v1
t2                              cache expires, reloads
                                signs with v2
t3                                                         gets a token signed with v2
                                                           v2 is not in its cache -> reload -> accepts
t4                              gets a token signed by B
                                with v1 = AWSPREVIOUS
                                -> accepts
t5                                                         cache expires, reloads, signs with v2
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

## WAF を付けられる入口、付けられない入口

<!-- section: 21.waf -->

AWS WAF は、リクエストがアプリに届く前に検査して、止めるものです。設定の単位を web ACL と呼びます。

どこにでも付けられるわけではありません。公式ドキュメントの一覧は、こうです（確認日 2026-10-12）。

- CloudFront の distribution
- API Gateway の REST API
- Application Load Balancer
- AppSync の GraphQL API、Cognito の user pool、App Runner の service、Bedrock AgentCore Gateway、Verified Access の instance、Amplify

この本で使ってきた入口のうち、API Gateway の HTTP API（04章）と、Lambda の function URL（09章、17章）は、この一覧にありません。付けたければ、手前に CloudFront を置いて、CloudFront に付けます。この章の構成が CloudFront から始まっているのは、そのためです。

ただし、CloudFront に付けただけでは足りません。裏の入口が開いていたら、そちらから入れます。

<<< @/examples/21-security/infra/lib/security-stack.ts{entry}

function URL の `AuthType` を `AWS_IAM` にして、CloudFront の origin access control に署名させる。09章と同じ形です。署名のないリクエストは、関数が動く前に Lambda が断ります。CloudFront を迂回する道が無いので、web ACL を迂回する道もありません。

HTTP API を CloudFront の裏に置く構成は、この本では実装も検証もしていません。やるなら、裏の入口をどう閉じるかを先に決めてからにしてください。

署名には制約もあります。CloudFront は、署名を `Authorization` ヘッダーに入れます。なので、この API は token を `x-aih-token` という別のヘッダーで受け取ります。そして 09章で話したとおり、POST や PUT は、呼ぶ側が本文の SHA-256 をヘッダーに入れる必要があります。この API は GET と HEAD だけにしました。

### web ACL

<<< @/examples/21-security/infra/lib/waf-stack.ts{web-acl}

CloudFront 用の web ACL は、us-east-1 に作ります。distribution や origin がどこにあっても、です。この stack は、ほかのリージョンを指定すると synth で止まります。

rule は 3 つです。

1 つ目は rate-based rule。1 つの IP アドレスから、5 分間に 300 回を超えたら block します。[14章](/ja/chapters/14-kv-cache.md)の rate limit との違いは、場所です。あちらはアプリの中で、公平に配るためのもの。こちらはアプリの手前で、Lambda を呼ばせないためのものです。

正確さは期待しないでください。ドキュメントによると、AWS WAF は約 10 秒ごとに率を見積もっていて、設定した上限の「近く」で制限しますが、ぴったりは保証しません。上限を超えてから block が始まるまで、ふつうは 30 秒未満、長いと数分かかります。その間のリクエストは通ります。

2 つ目と 3 つ目は、AWS が保守している managed rule group です。評判の悪い IP アドレスの一覧と、よくある攻撃の pattern を集めた core rule set。

core rule set は、最初は `count` にしてあります。止めずに、「止めていたはず」を数えるだけ。この rule group には、8 KB を超える本文を block する rule などが入っていて、正当なリクエストを止めることがあるからです。AWS も、本番のトラフィックに対して count で様子を見てから有効にするよう勧めています。block に切り替えるのは `-c wafCommonRules=block` です。

### 付ける手順

stack が 2 つのリージョンに分かれるので、2 段階です。

```bash
vp run sec:waf:infra:deploy
vp run sec:infra:deploy -c webAclArn=<WebAclArn の出力>
```

1 行目を実行した時点から、web ACL の月額が始まります。distribution に付けていなくても、です。

料金は、web ACL 1 つが月 USD 5、rule 1 つが月 USD 1（managed rule group は 1 つと数える）、検査したリクエスト 100 万件ごとに USD 0.60。この章の構成だと、リクエストが 0 でも月 USD 8.00、100 万件で USD 8.60 です。Bot Control のような追加の rule group は、別に月額とリクエスト料金がかかるので、入れていません。テストは、それらが入っていないことも固定しています。

外すときは、逆の順です。先に `webAclArn` なしで `sec:infra:deploy` して distribution から外し、それから `sec:waf:infra:destroy`。

## IAM の変更は、すぐには届かない

<!-- section: 21.iam-consistency -->

この章の分散システムの話は、IAM です。

IAM のドキュメントに、こういう一節があります。IAM は、世界中のデータセンターのコンピューターを通じて使われるサービスなので、eventual consistency（結果整合性）という分散の model を使っている。変更が、すべての endpoint から見えるようになるまでには時間がかかる。cache もあるので、古い情報が期限切れになるまで見えないこともある。

つまり、role に権限を足した直後の呼び出しは、拒否されることがあります。権限を消した直後の呼び出しは、通ることがあります。どのくらいの時間なのか、ドキュメントは数字を書いていません。この本でも計っていません。

AWS の勧めは 2 つです。IAM の変更を、止まっては困る処理の途中に入れないこと。そして、変更が行き渡ったことを確かめてから、それに頼ること。

### 許可したあと

デプロイは、role を作って、すぐにその role で関数を動かします。まさに「変更の直後」です。なので、動作確認のスクリプトは、拒否を一度で失敗にしません。

<<< @/examples/21-security/src/propagation.ts{until-allowed}

再試行するのは、拒否だけです。ほかのエラーは、待っても直らないので、すぐ上げます。そして回数に上限があります。上限まで拒否され続けたら、それはもう伝播の遅れではなく、policy の書き間違いです。「待てば直る」と「待っても直らない」を、どこかで切り分けないといけません。

関数の側は、secret を読む権限が無いとき、503 と `retry-after` を返します。

<<< @/examples/21-security/src/app.ts{unavailable}

<<< @/examples/21-security/scripts/smoke.ts{wait-for-iam}

正直に言うと、デプロイ直後に実際に 503 が返るのかどうかは、確かめていません。返らないかもしれません。返らなければ、この待ちは一度も使われず、害もありません。

### 取り消したあと

逆向きのほうが、危険です。鍵が漏れた、role を乗っ取られた、というとき、人は権限を消して、一度試して、拒否されたのを見て安心します。

<<< @/examples/21-security/src/propagation.ts{until-denied}

1 回の拒否は、その 1 回が、変更を知っている endpoint に届いたというだけです。この関数は、続けて何回か拒否されるまで、「止まった」と言いません。テストは、拒否、許可、拒否、拒否、拒否、という順序を再現して、最初の拒否で確認済みにしないことを見ています。

とはいえ、これも「数回続けて拒否された」以上のことは言えません。本当に急ぐときは、権限を消すのに加えて、守るもの自体を変えます。この章なら、secret を rotation する（`--force` で）。漏れた鍵が、もう正しい鍵ではなくなれば、IAM がどこまで行き渡ったかを気にしなくて済みます。

この関数は、この章のタスクからは呼んでいません。試す手順は、検証メモの再開手順に書いてあります。

### いつ変えたかは、CloudTrail が知っている

```bash
vp run sec:trail:iam
```

直近 24 時間の、IAM への変更を一覧にします。誰が、いつ、どの操作をしたか。デプロイしたあとなら、`CreateRole` や `PutRolePolicy` が並ぶはずです。

1 つ、ハマりどころがあります。IAM は global なサービスで、その event は us-east-1 に記録されます。東京リージョンの event history をいくら探しても、IAM の変更は出てきません。このタスクは、最初から us-east-1 を見に行きます。

そして、ここに出る時刻は、API が呼ばれた時刻です。その変更が、すべての endpoint で効き始めた時刻ではありません。

## 見張る道具は、それぞれ別のものを見ている

<!-- section: 21.detect -->

名前が似ているので混ざりやすい 4 つを、並べておきます。

```text
service      question it answers                          looks at                               result
Inspector    does my code have known vulnerabilities?     Lambda packages, ECR images, EC2       findings per CVE
GuardDuty    is someone acting like an attacker?          CloudTrail events, VPC flow, DNS logs  findings per suspicious activity
CloudTrail   who called which API, and when?              every management API call              events, 90 days free
AWS Config   what did this resource look like last week?  resource configurations over time      configuration items
```

Inspector と GuardDuty は、よく「どっちを入れればいい？」と聞かれますが、別物です。

**Inspector** は、脆弱性の検査です。あなたの Lambda 関数に入っているパッケージ、ECR のコンテナイメージ、EC2 のインスタンスを調べて、既知の脆弱性（CVE）が無いかを見ます。攻撃が起きているかどうかは見ません。関数をデプロイしたとき、そして新しい CVE が公開されたときに、検査し直します。この本のように、依存を bundle して Lambda に載せる構成だと、「デプロイしたあとで見つかった脆弱性」に気づく手段になります。

**GuardDuty** は、脅威の検出です。CloudTrail の event や、VPC の通信の記録を分析して、「漏れた認証情報が、知らない場所から使われている」「暗号通貨の採掘らしい通信がある」といった、怪しい動きを見つけます。コードに穴があるかどうかは見ません。

**CloudTrail** は記録です。判断はしません。event history は最初から有効で、management event を 90 日ぶん、リージョンごとに持っています。無料です。90 日より長く残したい、S3 に置いて検索したい、Access Analyzer に読ませたい、となったら trail を作ります。management event の 1 つ目のコピーを S3 に届けるぶんは無料で、かかるのは S3 の保存料金です。

**AWS Config** は、リソースの設定の履歴です。「この security group は、いつ、どう変わったか」に答えます。[02章](/ja/chapters/02-toolchain.md)の drift 検出は「いま、コードと違うか」でした。Config は「これまで、どう変わってきたか」です。記録する設定 1 件ごとに料金がかかります。

### なぜ stack に入れていないか

GuardDuty と Inspector は、2 段目に置きました。守るものができたら、入れる価値があります。でも、この章の CDK には入れていません。理由は 3 つです。

1 つ目。どちらも、アカウントとリージョンに 1 つの設定です。練習用の stack を消すときに、一緒に無効になっては困ります。

2 つ目。既定の範囲が広いんです。GuardDuty のドキュメントによると、初めて有効にすると、そのリージョンで使える protection plan が、既定ですべて有効になります。Inspector も、コンソールから有効にすると、すべての種類の検査が始まります。何が有効になったかを、画面で見ながら決めてほしい。

3 つ目。料金が、使ってみないと分かりません。どちらにも無料の試用期間があって（GuardDuty は 30 日、Inspector は 15 日）、その間にコンソールが「このままだと月いくら」を見積もってくれます。その数字を見てから決めるのが、いちばん確かです。

なので手順は、コンソールで有効にして、`vp run sec:posture` で確かめる、です。01章の root の MFA と同じ扱いですね。固定した版の cdkd が GuardDuty の detector に専用の実装を持っていない、という事情もあります。

正直に言うと、この節の内容は、ドキュメントを読んだだけです。どちらも有効にしていません。finding がどんな形で出るのかも、見ていません。

## 組織になったら

<!-- section: 21.organizations -->

1 人で 1 つのアカウントを使っているあいだは、ここまでで足ります。人が増えて、アカウントが増えると、別の問題が出てきます。「全員が正しく設定してくれる」ことに頼れなくなるんです。

AWS Organizations は、複数のアカウントを 1 つの organization にまとめるサービスです。追加料金はかかりません。organization を作ったアカウントが management account になり、請求をまとめ、ほかのアカウント（member account）に policy を付けられるようになります。

20章で、「dev と prod を同じアカウントに置くかぎり、名前でしか分かれていない」と書きました。その先にあるのが、これです。

### SCP は、権限を与えない

SCP（service control policy）は、member account の IAM user と role に「許せる権限の上限」を決める policy です。見た目は IAM の policy とそっくりですが、働きが違います。

SCP は、権限を与えません。上限を決めるだけです。

<<< @/examples/21-security/src/policy-model.ts{decide}

これは、IAM と SCP の組み合わせ方を、テスト用に小さく model にしたものです。本物の IAM の評価ではありません。でも、要点は 3 行に入っています。

- どこかに明示的な `Deny` があれば、拒否
- root から、途中の OU、アカウントまで、すべての階層の SCP が許していて
- かつ、本人の IAM policy も許しているときだけ、許可

2 行目が、SCP を初めて触る人が事故を起こすところです。SCP を有効にすると、Organizations は `FullAWSAccess` という「全部許可」の SCP を、すべての階層に付けます。これを外して、`Deny` だけの SCP に付け替えると、「許している SCP」が無くなって、そのアカウントでは何もできなくなります。テストに、その順序を入れてあります。

もう 1 つの注意。SCP は management account には効きません。service-linked role にも効きません。management account でふだんの作業をしないのは、このためです。

### 最初の guardrail

<<< @/examples/21-security/policies/scp-guardrails.json

4 つの statement は、どれも `Deny` です。`FullAWSAccess` を付けたまま、その上に重ねて使います。

1. organization から抜けさせない
2. 監査の記録を止めさせない。CloudTrail の trail、GuardDuty の detector、Config の recorder
3. この本が使わないリージョンでは、何もさせない。AWS のドキュメントの例と同じ形で、`NotAction` で global なサービスを除いています。除く一覧は、ドキュメントの例に合わせた 4 つだけです。AWS が公開している例の policy には、40 ほどのサービスが並んでいます。使うサービスに合わせて足してください
4. member account の root ユーザーには、何もさせない

1 つ目から 3 つ目は、管理者の権限を持っている人にも効きます。01章の `AdministratorAccess` を持ったままでも、trail は止められなくなります。「絞る方法」の、もう 1 つの答えです。

テストは、この JSON を model に通して確かめます。

- 管理者でも、`cloudtrail:StopLogging` や `organizations:LeaveOrganization` は拒否される
- 管理者でも、`eu-west-1` での `ec2:RunInstances` は拒否される。`ap-northeast-1` なら通る
- IAM policy を何も持たない人は、SCP が全部許可でも、何もできない
- `Principal` を含む statement は、読み込みで落ちる（SCP は `Principal` を持てません）
- 空白を除いた長さが、SCP の上限の 10,240 文字より短い
- model が知らない条件を含む policy は、評価を断る。知らない条件を「真」として扱わない

### これは CDK で作っていない

Organizations と SCP は、この章の stack に入っていません。タスクもありません。

organization を作る、アカウントを移す、SCP を付ける。どれも、実際のアカウントの構成を変える操作で、練習用の stack のように「消せば元どおり」にはなりません。SCP を root に付けて間違えると、全アカウントが止まります。AWS も、SCP は root にいきなり付けず、専用の OU を作って、アカウントを 1 つずつ入れて試すよう強く勧めています。

なのでこの章が渡すのは、policy の JSON と、それを付ける前に確かめるテストまでです。付けるのは、あなたの organization の、あなたが選んだ OU に、あなたの手で。

model には限界があります。知っている条件は `aws:RequestedRegion` と `aws:PrincipalArn` の 2 つだけ。resource の一致も見ていません。「テストが通った」は、「この model の範囲では、意図どおりに書けている」という意味です。実際の organization に付けて確かめてはいません。

## デプロイして確かめる

<!-- section: 21.deploy -->

既定の stack だけなら、流れはいつもどおりです。

```bash
vp run sec:infra:diff
vp run sec:infra:deploy
vp run sec:smoke
```

`sec:smoke` は、CloudFront の URL に対して、`/health`、token の発行、検証、署名を書き換えた token の拒否、POST の拒否を順に確かめます。token の発行は、Secrets Manager を 1 回読みます（課金対象の API 呼び出しです）。

function URL を直接呼べないことも、見ておいてください。Lambda のコンソールで関数の URL を調べて、`curl` で呼ぶと、403 が返るはずです。

```bash
vp run sec:infra:drift
```

この stack の resource type は、どれも固定した版の cdkd が専用の実装を持っているものです。drift で何がどこまで比べられるかは、実行していないので分かりません。1 つだけ予告しておくと、rotation は drift ではありません。secret の値は template に無いので、比べる対象になりません。

## Workers から来た人へ

<!-- section: 21.workers -->

Cloudflare の Workers から来ると、この章の長さに驚くと思います。

```text
                 Cloudflare Workers                           this chapter
secret           an encrypted binding on the Worker           a separate resource, read over the network at run time
who may read it  the Worker it is bound to                    whoever IAM allows, per secret
rotation         not examined in this chapter                 a new version; the previous one stays readable by label
web firewall     a free managed ruleset on all plans          a web ACL you create, attach, and pay for by the month;
                                                              only on some kinds of entry point
audit trail      not examined in this chapter                 CloudTrail event history, 90 days, always on
```

Workers の secret は、Worker に付く binding です。暗号化された値が Worker に結び付いていて、コードが取りに行く処理を書きません。だから、この章の cache も、cache と rotation のずれも、同じ形では出てきません。Workers で secret を入れ替えたときに何が起きるかは、この章では調べていません。

AWS のやり方が長いのは、secret が関数とは別のリソースだからです。別だから、権限を secret ごとに決められて、複数の関数や、Lambda ではないものからも読めて、version を label で持てます。そのかわり、読みに行くコードと、読みに行く権限と、読めなかったときの扱いを、自分で書くことになります。

WAF は、立ち位置が違います。Cloudflare では、無料の managed ruleset がすべてのプランで使えます。rate limiting の rule も、機能に差はありますが無料プランから使えます。AWS では、web ACL を作って、付けられる種類の入口に付けて、月額を払います。「まず無料で入っているもの」は、AWS にはありません。

Cloudflare 側の監査ログや、アカウントをまたぐ統制の仕組みは、この章では調べていません。

## お金の話

<!-- section: 21.cost -->

金額は USD、東京リージョン（CloudFront と WAF は global）、従量課金、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

置いてあるだけでかかるもの。

- 既定の stack: 月 USD 0.40。secret 1 つのぶんです。CloudFront、Lambda、IAM の role は、呼ばれなければ 0
- `-c cmk=on` を足すと: 月 USD 1.40。鍵が月 USD 1。1 年後の最初の自動 rotation から、さらに増えます
- web ACL（`AihSecurityWaf`）: 月 USD 8.00。既定の stack とは別に、distribution に付けていなくても

どれも時間割りです。既定の stack を午後のあいだだけ試して消すなら、1 セントに届きません。逆に、消し忘れた web ACL は、1 年で USD 96 です。

使ったとき。token の発行と検証を月 10 万回ずつ、という仮定で、定価の小計は月 USD 0.86、無料枠を引くと USD 0.49 でした。引いたあとに残るのは、secret の月額と、Secrets Manager の API 呼び出しです。実行環境 1 つが 5 分ごとに鍵を読み直すと、月に 17,520 回で USD 0.09。cache をやめて、リクエストのたびに 1 回読むと、20 万回で USD 1.00 になります。

GuardDuty、Inspector、Config は、使い方しだいで桁が変わるので、単価だけ書きます。

- GuardDuty: 分析した CloudTrail の event 100 万件あたり USD 4.72。ほかに、VPC flow log と DNS log の量、有効にした protection plan ごとの料金があります
- Inspector: Lambda standard scanning が、関数 1 つ 1 時間あたり USD 0.0005
- AWS Config: 連続記録で、configuration item 1 件あたり USD 0.003

桁をつかむための例を 1 つ。小さなアカウントで、event 10 万件、関数 1 つ、configuration item 500 件、と仮定すると、合わせて月 USD 2.34 です。この件数は仮定で、計った値ではありません。あなたのアカウントの数字は、試用期間中にコンソールが出す見積もりを見てください。

Organizations と SCP、CloudTrail の event history、IAM は、追加料金なしです。

確認できなかったこともあります。KMS の鍵が削除待ちの 7 日間に課金されるかどうか。CloudFront 用の web ACL が、請求のうえでどの usage type になるか。CloudFront の定額プランに WAF がどう含まれるか（この章は従量課金だけを見ています）。

## ハマりどころ

実行して出会ったものではなく、ドキュメントとコードから「ここで詰まりそう」と分かっているものです。

| こうなったら | ここを見る |
| --- | --- |
| `sec:waf:infra:deploy` が、スコープやリージョンのエラーで失敗する | CloudFront 用の web ACL は us-east-1 にしか作れません。stack の `env` を変えていませんか |
| `-c webAclArn=...` で synth が止まる | `arn:aws:wafv2:us-east-1:<アカウント>:global/webacl/<名前>/<id>` の形ですか。`regional` の ARN は CloudFront に付けられません |
| `/token` が 503 を返し続ける | 関数のログに `SecretAccessDenied` が出ていれば、role の権限です。`-c cmk=on` なら `kms:Decrypt` も要ります。デプロイ直後なら、少し待ってもう一度 |
| CloudFront 経由のリクエストが 403 になる | function URL の resource policy に、この distribution からの `lambda:InvokeFunctionUrl` と `lambda:InvokeFunction` の両方がありますか（09章） |
| `Authorization` ヘッダーで token を送ったら通らない | そのヘッダーは CloudFront が署名に使います。`x-aih-token` で送ります |
| rotation のあと、検証が 401 になる | 2 回続けて rotation していませんか。`vp run sec:secret:versions` で、token の `keyVersion` が `AWSCURRENT` か `AWSPREVIOUS` にあるか見ます |
| `sec:trail:iam` に、さっきの変更が出ない | IAM の event は us-east-1 に記録されます。記録されるまでに遅れがあるかどうかは、この本では確かめていません |
| `sec:iam:lint` が、例外が「何にも一致しない」と言う | policy のほうが直って、例外が要らなくなっています。`iam-lint-exceptions.json` から消します |
| 同じ名前の secret を作り直したら、関数が読めない | secret の ARN の末尾には、ランダムな 6 文字が付きます。作り直すと ARN が変わります。この stack は名前を固定していないので、再デプロイで追従します |

## 本番にするなら

- **GuardDuty を有効にする。** 守るものができたら、最初に足すのはこれです。試用期間の見積もりを見て、要らない protection plan は切ります
- **finding を、人が見る場所に流す。** 有効にしただけの検出は、誰も見ません。19章の通知の経路につなぎます
- **trail を作る。** 90 日より前のことを調べる必要は、だいたい 90 日を過ぎてから出てきます。Access Analyzer の policy generation にも要ります
- **web ACL のログを取る。** `count` の結果を見て、block に切り替えるかを決めます。この章の stack はログを設定していません
- **secret の削除に猶予を持たせる。** この章の secret は stack と一緒にすぐ消えます。本番では `RemovalPolicy.RETAIN` にして、消すときは Secrets Manager の復旧期間（7〜30 日）を使います
- **secret を読んだ記録を見る。** `GetSecretValue` は CloudTrail に残ります。想定していない role が読んでいないか
- **アカウントを分けて、SCP を付ける。** 練習用の OU で試してから
- **この lint を、すべての stack のテストに入れる。** いまは、この章の stack と、20章の CI の role にだけ当てています

## 片付け

<!-- section: 21.cleanup -->

web ACL を付けていたら、先に外します。

```bash
vp run sec:infra:deploy
vp run sec:waf:infra:destroy
vp run sec:infra:destroy
```

1 行目は、`-c webAclArn=...` を付けずにデプロイして、distribution から web ACL を外すためのものです。付けていなければ、3 行目だけで構いません。

secret は、stack と一緒に消えます。固定した版の cdkd は、復旧期間なしで削除します（ソースで確かめました）。Secrets Manager の「削除予定」の一覧にも残らないはずです。

`-c cmk=on` で作った鍵は、すぐには消えません。7 日間、削除待ちの状態で残ります。その間は使えません。7 日たつと消えます。

この章のタスクが作っていないものは、消えません。コンソールで有効にした GuardDuty や Inspector は、コンソールで無効にします。無効にするまで、試用期間のあとは料金がかかります。`vp run sec:posture` で、何が有効なまま残っているかを見てください。

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト（token の署名と検証、rotation をまたぐ鍵の cache、rotation の手順、SDK の client を差し替えた secret の読み取り、wildcard の lint と例外、SCP の JSON と評価の model、IAM の伝播待ち、posture の判定、2 つの stack の assertion）。型検査。固定した cdkd での synth（`-c cmk=on`、`-c webAclArn=...`、形の違う ARN も）。synth された関数の bundle を、テストランナーの外の Node.js で読み込んで `/health` を呼ぶこと。`vp run dev:sec` で起動した手元の server への `/health`、`/token`、`/verify`。`vp run sec:iam:lint` を、この本の全章の `cdk.out`（21 個の template）に対して実行。いずれも macOS（Apple silicon）です。

**まだ確かめていないこと。** AWS に触るものは、すべて未実行です。`sec:infra:diff`、`sec:infra:deploy`、`sec:smoke`、`sec:infra:drift`、`sec:infra:destroy`、`sec:waf:infra:*`、`sec:secret:versions`、`sec:secret:rotate`、`sec:posture`、`sec:trail:iam`。とくに次の点は、実環境での確認待ちです。

- CloudFront、署名つきの function URL、Secrets Manager を通した一連の動作。function URL を直接呼ぶと 403 になること
- デプロイ直後に、関数が secret を読めない時間があるのかどうか。権限を消したあと、いつまで読めるのか
- `PutSecretValue` のあとの staging label の動き。`AWSPREVIOUS` が無い secret を読んだときのエラー名
- web ACL の作成と関連付け。rate-based rule が block を始めるまでの時間。請求のうえでの usage type
- customer managed key を使った構成。削除待ちの 7 日間の課金
- `sec:posture` が呼ぶ 6 つの API の、実際の応答の形。権限が無いときのエラー名
- GuardDuty、Inspector、AWS Config、trail、Organizations、SCP。どれも有効にしていません。SCP の JSON は、Organizations に受け付けられることを確かめていません
- cdkd が生成した secret の値を、state やログに残さないこと。ソースを読んだ範囲では残していませんが、実行して確かめてはいません

**cdkd との関係。** 固定した版の cdkd（0.296.28）の npm の tarball を読んで確かめました。この章の 2 つの stack が使う resource type は、すべて専用の実装が登録されています。`AWS::CloudFront::Distribution`、`AWS::CloudFront::OriginAccessControl`、`AWS::IAM::Role`、`AWS::Lambda::Function`、`AWS::Lambda::Permission`、`AWS::Lambda::Url`、`AWS::Logs::LogGroup`、`AWS::SecretsManager::Secret`、`AWS::KMS::Key`（`-c cmk=on`）、`AWS::WAFv2::WebACL`。`AWS::GuardDuty::Detector` には登録がありません。secret は `GenerateSecretString` の値を cdkd の側で生成して `CreateSecret` に渡し、削除は `ForceDeleteWithoutRecovery` です。KMS の鍵の削除は `ScheduleKeyDeletion` で、日数は template の `PendingWindowInDays`（無ければ 7）です。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 何から入れるか | `examples/21-security/src/posture.ts`、`scripts/posture.ts`、`test/posture.test.ts` | `sec:posture`、`test:unit` |
| 全体像 | `examples/21-security/infra/bin/app.ts`、`infra/lib/config.ts` | `sec:infra:synth` |
| 権限を絞る | `examples/21-security/infra/lib/security-stack.ts`、`infra/test/security-stack.test.ts` | `test:unit` |
| wildcard を見つける assertion | `examples/21-security/src/iam-lint.ts`、`scripts/iam-lint.ts`、`policies/iam-lint-exceptions.json`、`test/iam-lint.test.ts` | `sec:iam:lint`、`test:unit` |
| secret を環境変数に置かない | `examples/21-security/src/secret-source.ts`、`src/secrets-manager-source.ts`、`src/env.ts`、`src/compose.ts`、`test/secrets-manager-source.test.ts` | `dev:sec`、`test:unit` |
| cache と rotation のあいだ | `examples/21-security/src/keyring.ts`、`src/token.ts`、`src/app.ts`、`test/keyring.test.ts`、`test/token.test.ts`、`test/app.test.ts` | `test:unit` |
| rotation の手順 | `examples/21-security/src/rotation.ts`、`scripts/rotate.ts`、`test/rotation.test.ts` | `sec:secret:versions`、`sec:secret:rotate` |
| 鍵は誰のものか | `examples/21-security/infra/lib/security-stack.ts`、`infra/test/security-stack.test.ts` | `sec:infra:synth`、`test:unit` |
| WAF を付けられる入口、付けられない入口 | `examples/21-security/infra/lib/waf-stack.ts`、`infra/lib/security-stack.ts`、`infra/test/waf-stack.test.ts` | `sec:waf:infra:deploy`、`sec:waf:infra:destroy` |
| IAM の変更は、すぐには届かない | `examples/21-security/src/propagation.ts`、`test/propagation.test.ts`、`scripts/smoke.ts`、`scripts/trail.ts` | `sec:smoke`、`sec:trail:iam` |
| 見張る道具は、それぞれ別のものを見ている | `examples/21-security/scripts/posture.ts`、`scripts/trail.ts` | `sec:posture`、`sec:trail:iam` |
| 組織になったら | `examples/21-security/policies/scp-guardrails.json`、`src/policy-model.ts`、`test/scp.test.ts` | `test:unit` |
| デプロイして確かめる | `examples/21-security/scripts/smoke.ts` | `sec:infra:deploy`、`sec:smoke`、`sec:infra:drift` |
| お金の話 | `data/pricing/`、`tools/src/pricing/calc.test.ts` | `test:unit` |
| 片付け | `examples/21-security/infra/lib/security-stack.ts` | `sec:infra:destroy`、`sec:waf:infra:destroy` |

**一次情報**（確認日はすべて 2026-10-12）

- IAM: [Troubleshoot IAM（eventual consistency）](https://docs.aws.amazon.com/IAM/latest/UserGuide/troubleshoot.html)、[Security best practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)、[Access Analyzer の policy generation](https://docs.aws.amazon.com/IAM/latest/UserGuide/access-analyzer-policy-generation.html)、[Policy evaluation logic](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html)、AWS service reference（[secretsmanager](https://servicereference.us-east-1.amazonaws.com/v1/secretsmanager/secretsmanager.json) ほか、action と resource type の確認）
- AWS WAF: [保護できるリソース](https://docs.aws.amazon.com/waf/latest/developerguide/how-aws-waf-works-resources.html)、[rate-based rule](https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based.html)、[その注意点](https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based-caveats.html)、[baseline rule groups](https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-baseline.html)、[IP reputation rule groups](https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-ip-rep.html)、[WCU](https://docs.aws.amazon.com/waf/latest/developerguide/aws-waf-capacity-units.html)、[テストと調整](https://docs.aws.amazon.com/waf/latest/developerguide/web-acl-testing.html)、[AWS::WAFv2::WebACL](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-wafv2-webacl.html)、[RateBasedStatement](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-wafv2-webacl-ratebasedstatement.html)
- CloudFront: [AWS WAF を使う](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/distribution-web-awswaf.html)、[function URL の origin へのアクセス制限](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html)
- Secrets Manager: [secret の中身と version](https://docs.aws.amazon.com/secretsmanager/latest/userguide/whats-in-a-secret.html)、[PutSecretValue](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_PutSecretValue.html)、[GetSecretValue](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html)、[DeleteSecret](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_DeleteSecret.html)、[best practices](https://docs.aws.amazon.com/secretsmanager/latest/userguide/best-practices.html)、[Lambda 関数による rotation](https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets_lambda-functions.html)、[AWS::SecretsManager::Secret](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-secretsmanager-secret.html)、[料金](https://aws.amazon.com/secrets-manager/pricing/)
- Lambda: [環境変数](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html)、[Lambda で Secrets Manager を使う](https://docs.aws.amazon.com/lambda/latest/dg/with-secrets-manager.html)
- AWS KMS: [KMS keys](https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html)、[rotation](https://docs.aws.amazon.com/kms/latest/developerguide/rotate-keys.html)、[鍵の削除](https://docs.aws.amazon.com/kms/latest/developerguide/deleting-keys.html)、[料金](https://aws.amazon.com/kms/pricing/)
- GuardDuty: [What is Amazon GuardDuty?](https://docs.aws.amazon.com/guardduty/latest/ug/what-is-guardduty.html)、[Getting started](https://docs.aws.amazon.com/guardduty/latest/ug/guardduty_settingup.html)、[使用量と費用の見積もり](https://docs.aws.amazon.com/guardduty/latest/ug/monitoring_costs.html)
- Inspector: [What is Amazon Inspector?](https://docs.aws.amazon.com/inspector/latest/user/what-is-inspector.html)、[Lambda 関数の検査](https://docs.aws.amazon.com/inspector/latest/user/scanning-lambda.html)、[Getting started](https://docs.aws.amazon.com/inspector/latest/user/getting_started_tutorial.html)、[料金](https://aws.amazon.com/inspector/pricing/)
- CloudTrail: [event history](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/view-cloudtrail-events.html)、[concepts（global service events）](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-concepts.html)、[LookupEvents](https://docs.aws.amazon.com/awscloudtrail/latest/APIReference/API_LookupEvents.html)、[料金](https://aws.amazon.com/cloudtrail/pricing/)
- AWS Config: [What is AWS Config?](https://docs.aws.amazon.com/config/latest/developerguide/WhatIsConfig.html)、[料金](https://aws.amazon.com/config/pricing/)
- Organizations: [SCP](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html)、[SCP の評価](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps_evaluation.html)、[SCP の構文](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps_syntax.html)、[quota](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_reference_limits.html)、[organization の作成](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_org_create.html)、[FAQs](https://aws.amazon.com/organizations/faqs/)、[aws-samples の SCP の例](https://github.com/aws-samples/service-control-policy-examples)
- AWS Price List: [Secrets Manager](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSSecretsManager/current/ap-northeast-1/index.json)、[KMS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/awskms/current/ap-northeast-1/index.json)、[WAF](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/awswaf/current/index.json)、[GuardDuty](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonGuardDuty/current/ap-northeast-1/index.json)、[Inspector](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonInspectorV2/current/ap-northeast-1/index.json)、[Config](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSConfig/current/ap-northeast-1/index.json)
- cdkd: [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)（tarball の `dist/`。provider の登録、secret と KMS の鍵の作成と削除）
- AWS SDK for JavaScript v3: [3.1149.0](https://www.npmjs.com/package/@aws-sdk/client-secrets-manager/v/3.1149.0)（7 つの client の型定義）
- Cloudflare: [Workers の secret](https://developers.cloudflare.com/workers/configuration/secrets/)、[WAF の managed rules](https://developers.cloudflare.com/waf/managed-rules/)、[rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)

:::
