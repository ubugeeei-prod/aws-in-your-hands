---
title: "20 CI/CD: しくみと実装"
---

# 20 CI/CD: しくみと実装

このページでは、[前のページ](/ja/chapters/20-shipping.md)で全体像を見た経路を、手元からのデプロイ、OIDC、ロール、ワークフロー、プレビューの順に組み立てます。

## CloudFormation に渡す

<!-- section: 20.cfn-deploy -->

まず、手元から dev のスタックをデプロイして、流れを確かめます。

```bash
vp run ship:cfn:synth
vp run ship:cfn:diff
vp run ship:cfn:deploy
vp run ship:smoke
```

`synth` は手元だけで完結し、`examples/20-shipping/cdk.out/` に `AihShipApi` と `AihShipCi` の 2 つのテンプレートを出力します。

`diff` が比べるものは、02章の cdkd とは違います。cdkd の diff は、テンプレートと cdkd の state を比べていました。`cdk diff` が比べるのは、いま synth したテンプレートと、CloudFormation が覚えている前回デプロイしたテンプレートです。どちらの diff も実物は見ないので、「diff が空でも、ドリフトが無いとは言えない」という点は変わりません。

`cdk diff` の比べ方は 2 つあります。このタスクの既定は `--method template` で、テンプレートどうしを見比べるだけなので、読み取り専用の lookup role で動きます。もう 1 つの `--method change-set` は、CloudFormation に変更セットを実際に作らせ、その変更でリソースが置き換わるかどうかまで調べます。こちらのほうが正確ですが、deploy role が必要です。プルリクエストで動かす diff にデプロイできる権限は渡したくないので、既定は `--method template` にしました。

`deploy` は、変更セットを作って実行します。途中でリソースの作成や更新が 1 つでも失敗すると、CloudFormation は既定で、それまでに変えたものを前の設定に戻します。新しく作ったスタックなら、作ったものを消します。これが自動のロールバックです。何が戻って何が戻らないのかは、[デプロイのページ](/ja/chapters/20-shipping/deploy.md)で詳しく見ます。

変更セットは予告であって、保証ではありません。公式ドキュメントも、変更セットを作れたからといって更新が成功するとは限らない、と明記しています。

人が手元から実行するときは、権限が広がる変更の前に CLI が確認を求めます（`--require-approval broadening`）。CI では答える人がいないので `never` にしてあり、その代わりに、プルリクエストの diff と、このページの後半に出てくる GitHub の environment で確認します。

`ship:smoke` は、デプロイした API を 04章の型付きクライアントで呼び、`/health` が返すステージがデプロイしたものと一致するかも確かめます。

歯止めには、スタックポリシーもあります。スタックを更新するときに「このリソースは置き換えさせない」と宣言する JSON です。ただ、固定した版の `aws-cdk-lib` の `StackProps` にはスタックポリシーを設定する項目がないので、この章では使っていません。

## 鍵を置かずに AWS に入る

<!-- section: 20.oidc -->

CI から AWS に入るいちばん単純な方法は、IAM ユーザーのアクセスキーを GitHub のシークレットに置くことです。これでも動きますが、アクセスキーには期限がないので、漏れると、誰かが気づいて消すまで使われ続けます。どのワークフローのどのジョブが使ったのかも、キーからは分かりません。

OIDC（OpenID Connect）を使うと、キーを置かずに済みます。

```figure
caption: ジョブは GitHub が署名したトークンを STS に見せ、1 時間だけ使える認証情報を受け取る
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

ジョブは、自分が何者かを記した署名つきのトークンを GitHub に発行してもらい、AWS の STS に見せます。STS は署名を確かめ、トークンの内容をロールの信頼ポリシーと照らし合わせて、合っていれば 1 時間だけ使える認証情報を返します。GitHub に保存するのはロールの ARN とアカウント ID だけで、どちらも秘密ではありません。

準備は 2 つあります。1 つ目は、GitHub が発行したトークンを信用する、とアカウントに登録することです。

<<< @/examples/20-shipping/infra/lib/ci-stack.ts{provider}

OIDC provider は、同じ URL のものをアカウントに 1 つしか作れません。すでに登録してあるアカウントでは、`-c existingOidcProviderArn=...` を付けて既存のものを使います。

2 つ目は、誰がこのロールを使えるかを決める、ロールの信頼ポリシー（trust policy）です。provider を登録しただけでは、GitHub 上のすべてのリポジトリが候補になってしまいます。候補を絞るには、トークンの中の `sub` という項目を使います。GitHub は、ジョブの種類ごとに違う文字列を `sub` に入れます。

<<< @/examples/20-shipping/infra/lib/ci-stack.ts{subjects}

見落としやすいのは 2 行目です。ジョブが environment を指定していると、`sub` にはブランチの名前ではなく environment の名前が入ります。main からだけデプロイできるようにするつもりでブランチの条件を書いても、ジョブが `environment: production` を持っていれば、その条件には一度も一致しません。反対に、environment の名前で信用するなら、「その environment を使えるのは main だけ」という制限を、GitHub 側の environment の設定に入れておく必要があります。AWS のドキュメントも、environment に保護のルールを付けるよう強く勧めています。

<<< @/examples/20-shipping/infra/lib/ci-stack.ts{trust}

条件に使うのは `StringEquals` だけです。`StringLike` と `*` を使えば「このリポジトリのどのブランチでも」と書けますが、そう書くと、誰かが作った作業用のブランチからでも本番にデプロイできることになります。そのため、ロールごとに、ちょうど 1 つの文字列だけを許しています。

リポジトリの名前は、CDK の context で渡します。型の外から来る値であり、しかも信頼ポリシーにそのまま入る値なので、スキーマで検証します。

<<< @/examples/20-shipping/infra/lib/config.ts{ci-config}

`*` や `?` を含む値は、synth で止まります。テストには、`octo-org/*` を渡す例や、ブランチに `*` を渡す例を入れてあります。

`sub` の形には、最近の変更があります。GitHub のドキュメントによると、2026 年 7 月 15 日より後に作られたリポジトリでは、`sub` が `repo:owner@123456/repo@456789:...` のように ID 入りの形になりました。リポジトリの名前が使い回されても、同じ `sub` にならないようにするためです。それより前からあるリポジトリは、切り替えるか名前を変えるまで、元の形のままです。自分のリポジトリがどちらの形かによって、`githubRepository` に渡す値が変わります。このスキーマは、両方の形を受け付けます。

このスタックは、人が一度だけデプロイします。CI に自分のロールを書き換えさせないためです。

```bash
vp run ship:ci:deploy -c githubRepository=<owner>/<repo>
```

出力される 4 つのロールの ARN とアカウント ID を、GitHub のリポジトリの variables に入れます（`AIH_PLAN_ROLE_ARN`、`AIH_DEPLOY_ROLE_ARN`、`AIH_PREVIEW_ROLE_ARN`、`AIH_DRIFT_ROLE_ARN`、`AIH_AWS_ACCOUNT_ID`）。シークレットではなく variables で構いません。

## ロールに持たせる権限

<!-- section: 20.roles -->

信頼ポリシーは、誰がロールを使えるかを決めます。この節では、ロールを使って何ができるかを決めます。権限の持たせ方は 2 つあります。

1 つは、CDK の bootstrap が作ったロールを assume させる（引き受けさせる）方法です。bootstrap のロールは、同じアカウントの中から assume できるように作られています。そこで、GitHub 用のロールには `sts:AssumeRole` だけを持たせ、実際の作業は bootstrap のロールに任せます。

もう 1 つは、必要な操作を GitHub 用のロールに直接書く方法です。

この章では 2 つを使い分けました。CDK CLI を動かすジョブでは、1 つ目の方法を使います。CLI はもともと bootstrap のロールを assume するように作られているので、その作りに合わせます。

<<< @/examples/20-shipping/infra/lib/ci-stack.ts{bootstrap-roles}

プルリクエスト用の PlanRole が assume できるのは、lookup role だけです。デプロイするロールは、deploy role と file-publishing role を assume できます。テストは、assume できる組み合わせがちょうどこれだけであることを確かめています。

ドリフトの検出は CDK CLI を通さず、SDK で CloudFormation を直接呼ぶので、2 つ目の方法を使います。

<<< @/examples/20-shipping/infra/lib/ci-stack.ts{drift-role}

このポリシーが少し長いのは、CloudFormation のドリフト検出が、呼び出した側の権限でスタックの中のリソースを 1 つずつ読みに行くからです。CloudFormation の操作の権限だけでは足りず、Lambda や IAM や API Gateway を読む権限も要ります。必要な操作は、各リソースタイプが公開しているスキーマの「read に必要な権限」から拾いました。この権限で足りるかどうかは、実際に動かして確かめてはいません。足りなければ、検出は「読めなかった」という結果になり、ゲートは合格にしません。そのときは、report に出る理由を見て、このポリシーに操作を足します。

最後の statement だけ、対象が `*` です。この 5 つの操作には、対象を ARN で絞る書き方がありません。`*` を使っているのがこの 5 つだけであることも、テストで固定しています。

プルリクエストの `plan` ジョブには、知っておくべき点があります。このジョブでは、レビュー前のコードが lookup role の権限で動きます。lookup role は読み取り専用ですが、中身は AWS 管理の `ReadOnlyAccess` で、拒否しているのは KMS での復号だけです。つまり、アカウントの中の多くのものを読めます。そのため `plan` ジョブは、同じリポジトリのブランチからのプルリクエストに限っています。フォークからのプルリクエストで OIDC のトークンが発行されるのかどうかは、確かめていません。発行されてもされなくても問題がないように、ジョブの側で止めています。

## ワークフロー

<!-- section: 20.workflows -->

ワークフローの実物は `examples/20-shipping/workflows/` にあります。`.github/workflows/` に置くと、その時点で GitHub が実行を始めてしまうので、そこには置いていません。使うときは、自分のリポジトリの `.github/workflows/` にコピーします。

1 つ目は、プルリクエストで動くワークフローです。

<<< @/examples/20-shipping/workflows/pr.yml

`check` ジョブには、AWS に入る手段がありません。`id-token: write` も、認証情報を取得する step も持っていないからです。フォークからのものも含めて、すべてのプルリクエストで動くのは、この `check` ジョブです。

`plan` ジョブは、本番のスタックに対する `cdk diff` を出力します。このプルリクエストを merge すると本番で何が変わるのかを、レビューのときに確かめられます。

2 つ目は、main への push で動くワークフローです。

<<< @/examples/20-shipping/workflows/deploy.yml

step の順番には意味があります。`check:all` が通るまでは、認証情報を取りに行きません。デプロイの前には `ship:cfn:status` を呼び、スタックが更新を始めてよい状態かどうかを確かめます。デプロイのあとには API を呼びます。途中のどこかで失敗した場合は、最後の step が、スタックがどの状態で止まったかを表示します。

`concurrency` の `cancel-in-progress: false` も重要です。新しい push が来たときにデプロイ中のジョブを止めると、止まるのは CLI だけで、CloudFormation の更新は途中のまま進み続けます。

すべてのワークフローに共通する次の点を、テストで固定しました。

- action は、タグではなく commit の SHA で固定している。タグは付け替えられるので、GitHub のドキュメントも、不変にできるのは SHA だけだと書いています
- アクセスキー、シークレットの参照、アカウント ID、ARN の直書きが無い
- `id-token: write` を持つのは、ロールを assume するジョブだけ
- `run` はすべて `nix develop --command vp ...` で、呼んでいるタスクが `vite.config.ts` に実在する
- それぞれのロールを、信頼ポリシーが想定した種類のジョブが使っている（たとえば、DeployRole を使うジョブは `environment: production` を持つ）
- プルリクエストの番号のような外から来る値を、シェルのコマンドに直接埋め込んでいない

`aws-actions/configure-aws-credentials` は、確認した日（2026-10-12）の最新が v6.3.0 でした。`docs/examples/` にある例も、同じ版にそろえてあります。使っている入力は `role-to-assume`、`aws-region`、`allowed-account-ids` の 3 つです。`allowed-account-ids` を指定しておくと、受け取った認証情報が想定と違うアカウントのものだったときに、その場で止まります。01章の `AIH_AWS_ACCOUNT_ID` と同じ考え方です。

## プルリクエストごとのプレビュー

<!-- section: 20.preview -->

プルリクエストごとにスタックを 1 つ作ると、動いている API を見ながらレビューできます。

<<< @/examples/20-shipping/workflows/preview.yml

このワークフローは、プルリクエストが開かれたときと push されたときに `AihShipApiPr<番号>` をデプロイし、閉じられたときに消します。

便利な仕組みですが、有効にする前に、何を許すことになるのかを知っておいてください。

**このリポジトリにブランチを push できる人は誰でも、プルリクエストを開くだけで、自分のコードを AWS アカウントの管理者に近い権限で動かせます。** レビューも merge も要りません。そうなる道筋は次のとおりです。プルリクエストの中身は、CDK のコードも、ワークフローのファイルそのものも、ジョブの中で動きます。ジョブは PreviewRole になり、PreviewRole は deploy role を assume できます。deploy role は CloudFormation に何でも頼むことができ、CloudFormation はそれを cfn-exec role、つまり既定では `AdministratorAccess` で実行します。テンプレートに IAM ユーザーを 1 つ書けば、そのユーザーが作られます。スタックの名前が `AihShipApiPr12` であっても、prod を書き換えるテンプレートは書けます。

ジョブの `if` は、フォークからのプルリクエストを止めています。しかし、止めているのはそれだけです。ワークフローのファイルはプルリクエストの側のものが使われるので、`if` や手順を書き換えたプルリクエストは、書き換えたとおりに動きます。AWS の側が信用しているのは `environment:preview` という名前だけなので、壁になるのは、GitHub の environment の設定と AWS の権限の 2 か所です。

権限を狭める手段を、効果の大きい順に挙げます。

- プレビューを別のアカウントに置く。壊されるのをプレビューだけにとどめられる、唯一の方法です
- cfn-exec role を絞り、permissions boundary を付ける。bootstrap の `--cloudformation-execution-policies` と `--custom-permissions-boundary` を使います。どちらも固定した版の CLI にありますが、この章では試していません。API と Lambda とロググループが作れれば、プレビューには足ります
- `preview` environment に保護を付ける。承認を必須にするか、デプロイできるブランチを信用できるものに限ります。ワークフローが `environment: preview` を指定しているのは、そのためです。ただし、GitHub のドキュメントによると、Free、Pro、Team のプランでは、承認の必須化は public リポジトリでしか使えません。ブランチの制限がどのプランで使えるかは、確かめていません

**どれも付けられないなら、プレビューは有効にしないでください。** この章のワークフローは `.github/workflows/` ではなく `examples/` に置いてあるので、自分で移すまでは動きません。

プレビューを有効にすると、公開の URL も増えます。プルリクエスト 1 つにつき、認証なしの API が 1 つできます。流量制限はスタックごとに付くので、1 つあたりの料金の上限は[「お金の話」](/ja/chapters/20-shipping/wrap.md)に書いたとおりで、その上限が、開いているプルリクエストの数だけ並びます。

片付け忘れの問題もあります。閉じられたときに消すジョブは、失敗することがあります。ワークフローが無効になっていた場合、承認待ちのまま放置された場合、削除が途中で失敗した場合などです。AWS の側はプルリクエストが閉じられたことを知らないので、スタックは誰かが消すまで残ります。

<<< @/examples/20-shipping/src/previews.ts{previews}

```bash
vp run ship:preview:list
vp run ship:preview:list --open 12,15
```

このタスクは、プレビューのスタックを、作られてからの日数と一緒に一覧にします。`--open` に、いま開いているプルリクエストの番号を渡すと、それ以外のスタックを `leftover` と表示します。このタスク自体は何も消しません。消すには `vp run ship:cfn:destroy -c stage=pr-<番号>` を使います。

この章のプレビューは HTTP API と Lambda だけなので、置いてあるだけでは料金がかかりません。ただ、それはこの題材だからです。11章の NAT Gateway や、13章の常時稼働の DB を含むスタックで同じことをすると、プルリクエストの数だけ時間課金が並びます。プレビューを作るなら、1 つを置いておくといくらかかるのかを、先に計算してください。
