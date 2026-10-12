---
title: "20 CI/CD: しくみと実装"
---

# 20 CI/CD: しくみと実装

## CloudFormation に渡す

<!-- section: 20.cfn-deploy -->

手元から、dev の stack で流れを見ておきましょう。

```bash
vp run ship:cfn:synth
vp run ship:cfn:diff
vp run ship:cfn:deploy
vp run ship:smoke
```

`synth` は手元だけで完結します。`examples/20-shipping/cdk.out/` に、`AihShipApi` と `AihShipCi` の 2 つの template が出ます。

`diff` は何と何を比べているんでしょう。02章の cdkd の diff は、template と cdkd の state でした。`cdk diff` が比べるのは、いま synth した template と、CloudFormation が覚えている「前回デプロイした template」です。どちらも実物は見ません。だから、ここでも「diff が空でも drift が無いとは言えない」は同じです。

`cdk diff` には比べ方が 2 つあります。このタスクの既定は `--method template`。template どうしを見比べるだけで、読み取り専用の lookup role で動きます。もう 1 つの `--method change-set` は、CloudFormation に change set を実際に作らせて、「この変更でリソースが置き換わるか」まで聞きます。正確ですが、deploy role が要ります。pull request で動かす diff に、デプロイできる権限は渡したくないので、既定は前者にしました。

`deploy` は、change set を作って実行します。途中でリソースの作成や更新が 1 つでも失敗すると、CloudFormation は既定で、それまでに変えたものを前の設定に戻します。新しく作った stack なら、作ったものを消します。これが「自動の rollback」です。何が戻って、何が戻らないのかは、あとの節で詳しく見ます。

change set は予告であって、保証ではありません。公式ドキュメントも、change set が通っても更新が成功するとは限らない、とはっきり書いています。

人が手元から実行するときは、権限が広がる変更の前に CLI が確認を求めます（`--require-approval broadening`）。CI では誰も答えられないので `never` にしています。その代わりの確認が、pull request の diff と、あとで出てくる GitHub の environment です。

`ship:smoke` は、デプロイした API を 04章の型付き client で呼びます。`/health` が返す stage が、デプロイしたものと一致するかも見ます。

stack policy という歯止めもあります。stack の更新のときに「このリソースは置き換えさせない」と宣言する JSON です。固定した版の `aws-cdk-lib` の `StackProps` には、これを設定する項目がありません。この章では使っていません。

## 鍵を置かずに AWS に入る

<!-- section: 20.oidc -->

CI から AWS に入る、いちばん素朴な方法は、IAM user のアクセスキーを GitHub の secret に置くことです。動きます。でも、その鍵には期限がなく、漏れたら、誰かが気づいて消すまで使えます。どの workflow のどの job が使ったのかも、鍵からは分かりません。

OIDC（OpenID Connect）を使うと、鍵を置かずに済みます。

```figure
caption: job は GitHub が署名した token を STS に見せ、1 時間だけ使える認証情報を受け取る
type: sequence
actor job: GitHub Actions job | id-token: write
actor issuer: GitHub OIDC issuer
actor sts: AWS STS
actor role: IAM role | trust policy
step job -> issuer: token を要求 (aud=sts)
step issuer --> job: 署名つき JWT: iss, aud, sub
step job -> sts: AssumeRoleWithWebIdentity
note job: role ARN と JWT を渡す
step sts -> sts: 署名は正しいか
step sts -> sts: aud == sts.amazonaws.com?
step sts -> role: sub はこの値と同じか
step sts --> job: 1 時間有効な認証情報
note job: access key, secret key
note job: session token
```

job は GitHub に「自分が誰か」を書いた署名つきの token を発行してもらい、それを AWS の STS に見せます。STS は署名を確かめ、role の trust policy と照らして、合っていれば 1 時間だけ使える認証情報を返します。GitHub に保存するものは、role の ARN とアカウント ID だけ。どちらも秘密ではありません。

準備は 2 つです。まず、アカウントに「GitHub が発行した token を信用する」と登録します。

<<< @/examples/20-shipping/infra/lib/ci-stack.ts{provider}

OIDC provider は、同じ URL のものをアカウントに 1 つしか作れません。もう登録してあるアカウントでは、`-c existingOidcProviderArn=...` で既存のものを使います。

次に、role の trust policy（誰がこの role を使えるか）です。provider を登録しただけだと、GitHub 上のすべての repository が候補になってしまいます。絞るのは token の中の `sub` という項目で、GitHub は job の種類ごとに違う文字列を入れます。

<<< @/examples/20-shipping/infra/lib/ci-stack.ts{subjects}

見落としやすいのが 2 行目です。job が environment を指定していると、`sub` には branch の名前が入らず、environment の名前が入ります。「main からだけデプロイできる」つもりで branch の条件を書いても、job が `environment: production` を持っていたら、その条件には一度も一致しません。逆に、environment の名前で信用するなら、「その environment を使えるのは main だけ」という制限を、GitHub 側の environment の設定に入れておく必要があります。AWS のドキュメントも、ここに保護のルールを付けるよう強く勧めています。

<<< @/examples/20-shipping/infra/lib/ci-stack.ts{trust}

条件は `StringEquals` だけです。`StringLike` と `*` を使えば「この repository のどの branch でも」と書けますが、それは「誰かが作った作業用の branch からでも本番にデプロイできる」という意味になります。role ごとに、ちょうど 1 つの文字列だけを許しています。

repository の名前は、CDK の context で渡します。ここは型の外から来る値で、しかも trust policy にそのまま入る値です。

<<< @/examples/20-shipping/infra/lib/config.ts{ci-config}

`*` や `?` を含む値は、synth で止まります。テストには、`octo-org/*` や、branch に `*` を渡す例を入れてあります。

もう 1 つ、最近の変更があります。GitHub のドキュメントによると、2026 年 7 月 15 日より後に作られた repository は、`sub` の形が `repo:owner@123456/repo@456789:...` のように、ID 入りに変わりました。名前を使い回されても同じ `sub` にならないようにするためです。それより前からある repository は、切り替えるか、名前を変えるまで、元の形のままです。あなたの repository がどちらなのかで、`githubRepository` に渡す値が変わります。この schema は両方の形を通します。

この stack は、人が一度だけデプロイします。CI に、自分の role を書き換えさせないためです。

```bash
vp run ship:ci:deploy -c githubRepository=<owner>/<repo>
```

出力される 4 つの role の ARN と、アカウント ID を、GitHub の repository の variables に入れます（`AIH_PLAN_ROLE_ARN`、`AIH_DEPLOY_ROLE_ARN`、`AIH_PREVIEW_ROLE_ARN`、`AIH_DRIFT_ROLE_ARN`、`AIH_AWS_ACCOUNT_ID`）。secret ではなく variables で構いません。

## role に何を持たせるか

<!-- section: 20.roles -->

trust policy は「誰が使えるか」。こんどは「使って何ができるか」です。やり方は 2 つあります。

1 つは、CDK の bootstrap が作った role を assume（引き受ける）させること。bootstrap の role は、同じアカウントの中から assume できるように作られています。GitHub 用の role には `sts:AssumeRole` だけを持たせ、実際の仕事は bootstrap の role にやらせます。

もう 1 つは、必要な操作を、GitHub 用の role に直接書くことです。

この章では両方を使い分けました。CDK CLI が動く job は 1 つ目です。CLI は、最初から bootstrap の role を assume するように作られているので、それに乗ります。

<<< @/examples/20-shipping/infra/lib/ci-stack.ts{bootstrap-roles}

pull request 用の PlanRole が assume できるのは、lookup role だけ。デプロイ用の role は、deploy role と file-publishing role です。テストは、この組み合わせがちょうどこれだけであることを見ています。

drift の検出は CDK CLI を通さず、SDK で CloudFormation を直接呼びます。なので 2 つ目のやり方です。

<<< @/examples/20-shipping/infra/lib/ci-stack.ts{drift-role}

少し長いのには理由があります。CloudFormation の drift 検出は、呼んだ人の権限で、stack の中のリソースを 1 つずつ読みに行きます。CloudFormation の操作の権限だけでは足りず、Lambda や IAM や API Gateway を読む権限も要るんです。どの操作が要るかは、各 resource type が公開している schema の「read に必要な権限」から拾いました。正直に言うと、これで足りるかどうかは、実際に動かして確かめてはいません。足りなければ、検出は「読めなかった」という結果になり、gate は合格にしません。そのとき report に出る理由を見て、ここに足すことになります。

最後の statement だけ、対象が `*` です。この 5 つの操作は、対象を ARN で絞る書き方を持っていません。`*` を使っているのがこの 5 つだけであることも、テストで固定しています。

そして、もう 1 つ正直な話を。pull request の `plan` job では、レビュー前のコードが、lookup role の権限で動きます。lookup role は読み取り専用ですが、中身は AWS 管理の `ReadOnlyAccess` です（KMS での復号だけ拒否）。アカウントの中の多くのものが読めます。だからこの job は、同じ repository の branch からの pull request に限っています。fork からの pull request で OIDC の token が出るのかどうかは、確かめていません。出ても出なくても困らないように、job の側で止めています。

## workflow

<!-- section: 20.workflows -->

workflow の実物は `examples/20-shipping/workflows/` にあります。`.github/workflows/` には置いていません。置いた時点で GitHub が実行を始めてしまうからです。使うときは、自分の repository の `.github/workflows/` にコピーします。

まず pull request。

<<< @/examples/20-shipping/workflows/pr.yml

`check` job には、AWS に入る手段がありません。`id-token: write` も、認証情報の step も持っていない。fork からの pull request も含めて、すべての pull request で動くのはこの job です。

`plan` job が、本番の stack に対する `cdk diff` を出します。「この pull request を merge したら、本番で何が変わるか」が、レビューの材料になります。

次に、main への push。

<<< @/examples/20-shipping/workflows/deploy.yml

順番に意味があります。`check:all` が通るまで、認証情報は取りに行きません。デプロイの前に `ship:cfn:status` で、stack が「いま更新を始めていい状態か」を確かめます。デプロイのあとに API を呼びます。どこかで失敗したら、最後の step が、stack がどの状態で止まったかを表示します。

`concurrency` の `cancel-in-progress: false` も大事です。新しい push が来たからといって、デプロイ中の job を止めると、CLI だけが消えて、CloudFormation の更新は途中のまま走り続けます。

どの workflow にも共通することを、テストで固定しました。

- action は、tag ではなく commit の SHA で固定している。tag は付け替えられるので、GitHub のドキュメントも、不変にできるのは SHA だけだと書いています
- アクセスキー、secret の参照、アカウント ID、ARN の直書きが無い
- `id-token: write` を持つのは、role を assume する job だけ
- `run` はすべて `nix develop --command vp ...` で、呼んでいるタスクが `vite.config.ts` に実在する
- それぞれの role を、trust policy が想定した種類の job が使っている（DeployRole を使う job は `environment: production` を持つ、など）
- pull request の番号のような外から来る値を、shell のコマンドに直接埋め込んでいない

`aws-actions/configure-aws-credentials` は、確認した日（2026-10-12）の最新が v6.3.0 でした。`docs/examples/` にある例も、同じ版にそろえてあります。使っている入力は 3 つ。`role-to-assume`、`aws-region`、そして `allowed-account-ids`。最後のは、受け取った認証情報が想定と違うアカウントのものだったら、その場で止めるためのものです。01章の `AIH_AWS_ACCOUNT_ID` と同じ考え方ですね。

## pull request ごとの preview

<!-- section: 20.preview -->

pull request ごとに stack を 1 つ作って、動く API をレビューできるようにします。

<<< @/examples/20-shipping/workflows/preview.yml

pull request が開いたとき、push されたときに `AihShipApiPr<番号>` をデプロイし、閉じたときに消します。

便利です。でも、有効にする前に、これが何を許すのかをはっきりさせておきましょう。

**この repository に branch を push できる人は誰でも、pull request を開くだけで、自分のコードを AWS アカウントの管理者に近い権限で動かせます。** レビューも merge も要りません。道筋はこうです。pull request の中身（CDK のコードも、workflow のファイルそのものも）が job の中で動く。job は PreviewRole になる。PreviewRole は deploy role を assume できる。deploy role は CloudFormation に何でも頼めて、CloudFormation は cfn-exec role、つまり既定では `AdministratorAccess` で実行する。template に IAM の user を 1 つ書けば、それが作られます。stack の名前が `AihShipApiPr12` でも、prod を書き換える template は書けます。

job の `if` は、fork からの pull request を止めています。止めているのは、それだけです。workflow のファイルは pull request の側のものが使われるので、`if` や手順を書き換えた pull request は、書き換えたとおりに動きます。AWS の側が信用しているのは `environment:preview` という名前だけなので、壁になるのは GitHub の environment の設定と、AWS の権限の 2 か所です。

狭める手段は、効く順にこうです。

- **preview を別のアカウントに置く。** 壊されても preview だけ、にできる唯一の方法です
- **cfn-exec role を絞り、permissions boundary を付ける。** bootstrap の `--cloudformation-execution-policies` と `--custom-permissions-boundary` です。どちらも固定した版の CLI にありますが、この章では試していません。API と Lambda と log group が作れれば、preview には足ります
- **`preview` environment に保護を付ける。** 承認を必須にするか、デプロイできる branch を信用できるものに限ります。workflow が `environment: preview` を指定しているのは、そのためです。ただし、GitHub のドキュメントによると、Free、Pro、Team のプランでは、承認の必須化は public repository でしか使えません。branch の制限がどのプランで使えるかは、確かめていません

どれも付けられないなら、preview は有効にしないでください。この章の workflow は `.github/workflows/` ではなく `examples/` に置いてあるので、あなたが自分で移すまでは動きません。

preview がもう 1 つ増やすのは、公開の URL です。pull request 1 つにつき、認証なしの API が 1 つ。流量制限は stack ごとなので、1 つあたりの料金の天井は「お金の話」のとおりで、開いている pull request の数だけ並びます。

もう 1 つの問題は、片付け忘れです。「閉じたら消す」job は、失敗することがあります。workflow が無効になっていた、承認待ちのまま放置された、削除が途中で失敗した。AWS の側は、pull request が閉じたことを知りません。stack は、誰かが消すまで残ります。

<<< @/examples/20-shipping/src/previews.ts{previews}

```bash
vp run ship:preview:list
vp run ship:preview:list --open 12,15
```

preview の stack を、作られてからの日数と一緒に並べます。`--open` に、いま開いている pull request の番号を渡すと、それ以外を `leftover` と表示します。このタスクは消しません。消すのは `vp run ship:cfn:destroy -c stage=pr-<番号>` です。

この章の preview は、置いてあるだけでは料金がかかりません。HTTP API と Lambda だからです。でも、これは題材がたまたまそうなだけ。11章の NAT Gateway や、13章の常時稼働の DB を含む stack で同じことをすると、pull request の数だけ時間課金が並びます。preview を作るなら、「1 つあたり、置いておくといくらか」を先に計算してください。
