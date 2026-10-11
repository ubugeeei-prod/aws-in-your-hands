---
title: "20 変更を届ける: CI/CD、OIDC、環境、preview、rollback、drift"
revision: 1
---

# 20 変更を届ける: CI/CD、OIDC、環境、preview、rollback、drift

ここまでの章は、あなたの端末から、あなたの認証情報で、cdkd を使ってデプロイしてきました。学ぶには速くて良いやり方です。でも、「本番向けの経路は 20章で」「人の認証情報でデプロイしない話は 20章で」と、何度も先送りにしてきましたよね。

この章で、その約束をまとめて果たします。04章の API を、AWS CDK CLI と CloudFormation という標準の経路にのせます。GitHub Actions が、アクセスキーをどこにも置かずに AWS に入れるようにします。そして、02章で作った drift の gate に、CloudFormation の drift 検出をつなぎます。

先に正直に言っておきます。この章の AWS 側の手順と GitHub Actions の workflow は、まだ一度も実際には動かしていません。手元で確かめたのは、テスト、型検査、synth までです。どこが未確認かは、章末にまとめてあります。

前提は [02章](/ja/chapters/02-toolchain.md)と [04章](/ja/chapters/04-http-api.md)です。コードは `examples/20-shipping/` と `tools/src/drift/` にあります。

## 全体像

<!-- section: 20.architecture -->

```text
developer laptop                 GitHub Actions                      AWS account (ap-northeast-1)

vp run check:all                 pr.yml      check: check:all        (no AWS)
vp run ship:cfn:synth                        plan:  ship:cfn:diff --> PlanRole    -> cdk lookup role (read only)
git push ----------------------> deploy.yml  check:all, status,
                                             ship:cfn:deploy     --> DeployRole  -> cdk deploy role -> CloudFormation
                                             ship:smoke                             cfn-exec role creates AihShipApiProd
                                 drift.yml   ship:cfn:drift      --> DriftRole   -> DetectStackDrift (read only)
                                 preview.yml deploy / destroy    --> PreviewRole -> AihShipApiPr<number>

same flake.lock, same pnpm-lock.yaml, same `vp run` tasks on both sides
no AWS access key is stored anywhere: each job trades a GitHub OIDC token for one-hour credentials
```

左から右へ、3 つの場所があります。

手元では、これまでどおり `vp run` でテストと synth をします。GitHub Actions は、同じ `flake.lock` で同じ devShell に入り、同じ `vp run` タスクを呼びます。CI 専用のスクリプトはありません。「CI では通るのに手元では通らない」を、作りようがないようにしたいからです。

AWS に触る job は 4 種類で、それぞれが別の IAM role を使います。pull request は読むだけ。main への push はデプロイ。毎日の定期実行は drift の検出。pull request ごとの preview は、専用の stack の作成と削除です。

題材は 04章の API ですが、stack は別物です。04章で cdkd が作った `AihHttpApi` には触りません。この章は `AihShipApi` という別の名前の stack を、CloudFormation に作らせます。

## 2 つの経路を、もう一度

<!-- section: 20.two-paths -->

02章で、template を AWS に反映する経路は 2 つあると話しました。おさらいしながら、今度は CloudFormation の側を詳しく見ます。

cdkd は、AWS の各サービスの API を自分で呼んでリソースを作り、「何を作ったか」を S3 の JSON に記録します。AWS CDK CLI（`cdk deploy`）は、template を CloudFormation に渡すだけです。作るのも、記録するのも、失敗したときに戻すのも、CloudFormation という AWS のサービスがやります。

cdkd の公式ドキュメントは、本番には AWS CDK CLI を使い続けるよう勧めています。理由として挙げているのは、CloudFormation が持っている change set や stack policy といった道具です（確認日 2026-10-12）。この章で使うものを並べると、こうなります。

- stack: 何を作ったかの記録。あなたの S3 bucket ではなく、CloudFormation の中にある
- change set: 更新の前に「何が追加され、変わり、置き換わり、消えるか」を一覧にしたもの
- 自動の rollback: 更新の途中でリソースが 1 つでも失敗したら、既定では前の設定に戻す
- drift detection: template と実物の比較。ただし範囲に限りがあります（後半の主役です）
- termination protection と stack policy: うっかり消す、うっかり置き換える、への歯止め

### bootstrap は別物

`cdk deploy` を使うには、アカウントとリージョンごとに一度、CDK の bootstrap が要ります。02章の cdkd の bootstrap とは、名前が同じだけの別物です。

```bash
vp run ship:cfn:bootstrap
```

これは AWS を変更します。固定した版の CLI（2.1145.0）が持っている template を `cdk bootstrap --show-template` で出して読むと、作られるのは `CDKToolkit` という CloudFormation の stack で、中身は次のとおりでした。

| | cdkd の bootstrap（02章） | CDK の bootstrap（この章） |
| --- | --- | --- |
| 作る手段 | cdkd が API を直接呼ぶ | CloudFormation の stack `CDKToolkit` |
| S3 bucket | `cdkd-state-<アカウント>`、`cdkd-assets-<アカウント>-<リージョン>` | `cdk-hnb659fds-assets-<アカウント>-<リージョン>` |
| ECR repository | `cdkd-container-assets-<アカウント>-<リージョン>` | `cdk-hnb659fds-container-assets-<アカウント>-<リージョン>` |
| IAM role | なし。あなたの権限でそのまま作る | 5 つ（下で説明します） |
| 「何を作ったか」の記録 | state の bucket の JSON | CloudFormation が持つ。bucket には置かない |
| その他 | | 版を記録する SSM parameter `/cdk-bootstrap/hnb659fds/version` |

`hnb659fds` は qualifier と呼ばれる既定の文字列で、値そのものに意味はありません。

role は 5 つです。CLI が template や zip を bucket に置くための file-publishing role、コンテナイメージ用の image-publishing role、CloudFormation に指示を出す deploy role、アカウントの情報を読むための lookup role。そして、CloudFormation 自身がリソースを作るときに使う cfn-exec role。

この最後の role に注意してください。何も指定しないと、cfn-exec role には `AdministratorAccess` が付きます。つまり、deploy role を使える人は、template に書きさえすれば、CloudFormation 経由で何でも作れます。絞るには bootstrap のときに `--cloudformation-execution-policies` で policy を指定しますが、この章のタスクは既定のままです。本番のアカウントでは、ここを最初に見直してください。

asset の bucket は、`CDKToolkit` stack を消しても残る設定になっています。

### 同じ stack を、交互に触らない

02章で書いたことを、もう一度。cdkd で作った stack を `cdk deploy` で更新する、あるいはその逆は、やりません。記録が 2 か所にできて、どちらも「自分が全部知っている」つもりで動くからです。

この章が stack の名前を分けているのは、そのためです。cdkd の公式ドキュメントも、1 つの CDK アプリを、開発環境には cdkd で、本番には AWS CDK CLI でデプロイする使い方を挙げています。道具を分ける単位は、stack（環境）です。

「いま cdkd で動いている stack を、CloudFormation の管理に移したい」こともあるでしょう。固定した版の cdkd には、そのための `export` と、逆向きの `import --migrate-from-cloudformation` があります。ヘルプによれば、`export` は CloudFormation の import の change set でリソースをそのまま引き渡し、成功したら cdkd の state を消します。import できない種類のリソースが 1 つでもあると中止します。これは日々のデプロイとは別の、一度きりの移行作業です。この本では実行していないので、試すなら練習用の stack で、`--dry-run` の計画を読んでからにしてください。

### CDK CLI を呼ぶ場所は 1 つ

cdkd のときと同じく、CLI に渡す引数は 1 つの関数に集めました。

<<< @/examples/20-shipping/src/cdk-args.ts{invocation}

`--no-rollback`、`--hotswap`、`--express` は、どこにも出てきません。どれも速くなるかわりに、失敗したときに CloudFormation が戻してくれなくなるものです。この関数がそれらを自分からは足さないことを、テストで固定しています。

## 環境は stack を分ける

<!-- section: 20.stages -->

dev と prod を、1 つの stack の「モード」にはしません。別の stack にします。

<<< @/examples/20-shipping/infra/lib/config.ts{stage}

`-c stage=prod` を付けると、作られるのは `AihShipApiProd`。`-c stage=pr-12` なら `AihShipApiPr12`。何も付けなければ `AihShipApi`（dev）です。「何も指定しなかったら本番に当たった」が起きない向きにしてあります。知らない stage の名前は、synth の時点で止まります。

<<< @/examples/20-shipping/infra/bin/app.ts{app}

本番だけ変えているのは 2 点です。

<<< @/examples/20-shipping/infra/lib/ship-api-stack.ts{protection}

1 つは termination protection。stack の削除を、解除するまで拒否します。もう 1 つは、log group を stack と一緒に消さないこと。練習用と preview の stack は、消したら何も残りません。

ここで、名前で分けることの限界も書いておきます。stack を分けても、同じアカウントの中にいるかぎり、権限の壁はありません。さっき見たとおり、deploy role は「どの stack でも」更新できますし、cfn-exec role は管理者です。preview をデプロイできる job は、権限のうえでは prod も壊せます。本当に分けたいなら、アカウントを分けます。この本は 1 つのアカウントで通しているので、そこまでは実装していません。

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

```text
GitHub Actions job             GitHub OIDC issuer            AWS STS                 IAM role (trust policy)
  | permissions: id-token: write     |                          |                           |
  |--- request a token (aud=sts) --->|                          |                           |
  |<-- signed JWT: iss, aud, sub ----|                          |                           |
  |--- AssumeRoleWithWebIdentity(role ARN, JWT) --------------->|                           |
  |                                  |                          |--- signature valid?       |
  |                                  |                          |--- aud == sts.amazonaws.com?
  |                                  |                          |--- sub == exactly this? ->|
  |<-- access key, secret key, session token (valid for 1 hour) |                           |
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

便利ですが、先に書いた限界がそのまま出ます。この job は、レビュー前のコードを、デプロイできる権限で動かします。PreviewRole が assume する deploy role は、同じアカウントのどの stack でも更新できます。workflow が `environment: preview` を指定しているのは、GitHub 側でこの environment に承認を必須にできるようにするためです。ただし、GitHub のドキュメントによると、Free、Pro、Team のプランでは、承認の必須化は public repository でしか使えません。承認を付けられないなら、preview は別のアカウントに分けるか、やめておくのが安全です。

もう 1 つの問題は、片付け忘れです。「閉じたら消す」job は、失敗することがあります。workflow が無効になっていた、承認待ちのまま放置された、削除が途中で失敗した。AWS の側は、pull request が閉じたことを知りません。stack は、誰かが消すまで残ります。

<<< @/examples/20-shipping/src/previews.ts{previews}

```bash
vp run ship:preview:list
vp run ship:preview:list --open 12,15
```

preview の stack を、作られてからの日数と一緒に並べます。`--open` に、いま開いている pull request の番号を渡すと、それ以外を `leftover` と表示します。このタスクは消しません。消すのは `vp run ship:cfn:destroy -c stage=pr-<番号>` です。

この章の preview は、置いてあるだけでは料金がかかりません。HTTP API と Lambda だからです。でも、これは題材がたまたまそうなだけ。11章の NAT Gateway や、13章の常時稼働の DB を含む stack で同じことをすると、pull request の数だけ時間課金が並びます。preview を作るなら、「1 つあたり、置いておくといくらか」を先に計算してください。

## 戻せるもの、戻せないもの

<!-- section: 20.rollback -->

「失敗したら rollback するから大丈夫」と言うとき、何が戻るのかを分けておきましょう。

戻せるのは、template に書いてあるものです。関数のコード、環境変数、メモリの設定、IAM の policy、route。CloudFormation が自動で戻すのも、`git revert` してデプロイし直して戻すのも、これです。

戻せないのは、その間に起きたことです。

- 書き込まれたデータ。新しいコードが保存した行や object は、コードを戻しても残ります
- 変えてしまった schema。列を消したあとで、消す前のコードには戻れません
- 消した bucket や table の中身。`RemovalPolicy.RETAIN` にしていなければ、戻す先がありません
- 外に出ていったもの。送ったメール（15章）、呼んだ外部の API

Cloudflare の Workers でも事情は同じで、公式ドキュメントは rollback について、Worker につながったリソースは変わらない、データの構造が版の間で変わっているとエラーになりうる、と注意しています。

### version と alias

コードを速く戻すための仕組みが、Lambda にはあります。

<<< @/examples/20-shipping/infra/lib/ship-api-stack.ts{version}

Lambda の version は、関数のコードと設定の、番号付きの写しです。発行したあとは変えられません。alias は、version を指す名前つきのポインタ。この stack では、API Gateway は関数そのものではなく `live` という alias を呼びます。デプロイで関数が変わると、新しい version が発行されて、`live` がそちらを指すようになります。

古い version は消さずに残しています（`RemovalPolicy.RETAIN`）。CloudFormation が更新を rollback するとき、`live` を前の version に戻せるように、です。そのぶん、version はデプロイのたびに増えていきます。stack を消して関数が消えるまで、残ります。

alias は、2 つの version に重みを付けて振り分けることもできます。新しい版に 10% だけ流して様子を見る、というやり方です。AWS のドキュメントによれば、振り分けは確率的で、リクエストが少ないと設定した割合から大きくずれることがあります。CodeDeploy には、これを時間をかけて自動で進める設定が用意されています。どちらも、この章では実装していません。エラー率のアラーム（[19章](/ja/chapters/19-observability.md)）につないで止める仕組みが無いまま段階的に切り替えても、問題に気づくのが遅くなるだけだからです。

急いでいるとき、コンソールで `live` を前の version に付け替えたくなるかもしれません。戻りはしますが、それは CloudFormation の外での変更、つまり drift です。template は新しい version を指したままなので、次のデプロイで、また新しいほうに向きます。戻すなら、コードを戻してデプロイする。緊急で手で戻したなら、あとで必ずコードを合わせる。後半の drift 検出は、これを見つけるためにもあります。

### schema は、古いコードが動く順に変える

コードと DB の schema は、同時には変わりません。そして、rollback で戻るのはコードだけです。

だから schema の変更は、「1 つ前の版のコードが、新しい schema でも動く」順番に分けます。

1. 足す。新しい列や table を足すだけ。古いコードは、それを知らなくても動く
2. 新しいコードを出す。ここで rollback しても、古いコードは 1. の schema で動く
3. 古い行を埋める
4. 古い列を、もう誰も読んでいないことを確かめてから消す。消すのは別のデプロイで

4 を 2 と同じデプロイに入れると、そのデプロイは戻せなくなります。[13章](/ja/chapters/13-sql.md)の「動いている DB の schema を変えるとき」は、この話の DSQL 版です。schema のない DynamoDB（[05章](/ja/chapters/05-dynamodb.md)）でも、item の形について同じことが言えます。コンテナで新旧の版が同時に動く時間をどう扱うかは、[12章](/ja/chapters/12-containers.md)で扱います。

## deploy は途中で止まる

<!-- section: 20.partial -->

デプロイを 1 つの出来事のように話してきましたが、実際は、何十回もの API 呼び出しの列です。その途中の、どこででも止まります。

```text
time  CloudFormation stack status              what a caller of the API gets
t1    UPDATE_IN_PROGRESS                       old code (alias `live` -> version 7)
t2    (new AWS::Lambda::Version 8 created)     old code
t3    (alias `live` moved to version 8)        new code
t4    (another resource fails to update)       new code
t5    UPDATE_ROLLBACK_IN_PROGRESS              new code, then old code once the alias is put back
t6    UPDATE_ROLLBACK_COMPLETE                 old code; whatever was written during t3..t5 stays written
```

これは一例です（どのリソースがどの順で更新されるかは、template の依存関係で決まります）。大事なのは t3 から t5 の間。この時間、新しいコードが本番のリクエストに応えています。そのあと stack は「元に戻りました」と言いますが、その間に書かれたデータは、戻っていません。

rollback 自体が失敗することもあります。戻す先のリソースが、誰かの手で消されていた、というような場合です。そうなると stack は `UPDATE_ROLLBACK_FAILED` になり、一部は新しく、一部は古いまま止まります。この状態の stack は、更新できません。

この章が守りたい invariant は 1 つです。**ほかの操作が動いている stack と、人が直さないと先へ進めない stack には、デプロイを始めない。**

<<< @/examples/20-shipping/src/stack-status.ts{next-step}

CloudFormation が返しうる状態のすべてに、「次に何をしていいか」を決めてあります。`switch` に `default` が無いので、SDK の型に新しい状態が増えたら、型検査が落ちます。

```bash
vp run ship:cfn:status
```

stack の状態と、次の一手を表示します。人が直さないと進めない状態のときだけ、終了コードが 1 になります。deploy の workflow が、デプロイの前にこれを呼んでいたのを思い出してください。

テストは、この invariant を壊しにいきます。名前が `_IN_PROGRESS` で終わる状態で、1 つでも「デプロイ可」になっていないか。更新が失敗して戻るまでの状態を順に並べて、途中で一度でも「デプロイ可」と答えないか。rollback にも失敗した stack を、「デプロイ可」と言っていないか。

`ROLLBACK_COMPLETE`（最初の作成に失敗した stack）は、少し特殊です。CloudFormation としては、この stack は消すことしかできません。でも、固定した版の CDK CLI は、次の `cdk deploy` のときに、この stack を自分で消してから作り直します（CLI のコードで確かめました）。なので「デプロイ可」にしてありますが、表示する文には「CloudFormation にできるのは削除だけ」と書いてあります。

進むか、戻るか。迷ったときの目安はこうです。stack が `UPDATE_ROLLBACK_COMPLETE` まで戻っているなら、もう戻っています。イベントで最初の失敗を探し、直して、もう一度デプロイします。`UPDATE_ROLLBACK_FAILED` なら、まず戻しきることを優先します（`cdk rollback`）。半分だけ新しい状態の上に、さらに変更を重ねないでください。

## CloudFormation の drift を、同じ gate に通す

<!-- section: 20.drift -->

02章で、drift の gate を作りました。「差が見つからなかった」と「全部比べて一致した」を区別して、後者のときだけ合格にするものでした。あれは cdkd 用です。CloudFormation で作った stack には、cdkd の state がありません。逆に、cdkd で作った stack を、CloudFormation の drift 検出は調べられません。調べる対象の stack が無いからです。

なので、CloudFormation の検出を呼んで、結果を同じ形の report にして、同じ gate に通します。

CloudFormation の drift 検出は、非同期です。

1. `DetectStackDrift` で検出を始める。返ってくるのは、検出の ID だけ
2. `DescribeStackDriftDetectionStatus` を、終わるまで繰り返し呼ぶ
3. `DescribeStackResourceDrifts` で、リソースごとの結果を読む

これに 4 つ目を足しました。`ListStackResources` で、stack にあるリソースを全部数えます。理由は次の節で。

<<< @/tools/src/drift/cloudformation.ts{api}

`tools/` のコードは、SDK を直接は知りません。4 つの呼び出しを持つ小さな interface だけを見ています。本物の client をつなぐのは、この数行です。

<<< @/examples/20-shipping/src/drift-client.ts{adapter}

テストでは、この interface を、決まった応答を順に返すものに差し替えます。

<<< @/tools/src/drift/cloudformation.ts{detect}

待つ間隔と回数の上限は、引数です。`sleep` も引数なので、テストは実際には待ちません。上限まで待っても終わらなかったら、`timeout` を返して、そこでやめます。このとき、3 つ目の API を呼ばないのがポイントです。`DescribeStackResourceDrifts` は、前回の検出の結果を覚えていて、聞けば返してくれます。今回の検出が終わっていないのに、前回の「一致」を読んで合格にしてしまう。それを防いでいます。

応答は、Zod の schema に通してから使います。SDK の型は「こういう形のはず」としか言っていないので。使わない項目は捨てています。おかげで、リソースの実際の設定値（`ActualProperties`）は、report に入りません。report に残るのは、ずれた property の名前だけです。

結果は、02章と同じ 7 つの状態のどれかになります。

| CloudFormation が言うこと | この本の状態 | gate の終了コード |
| --- | --- | --- |
| stack のすべてのリソースに、今回の検出の `IN_SYNC` がある | `clean` | 0 |
| `MODIFIED` のリソースがある | `drifted` | 10 |
| `DELETED` のリソースがある | `deleted` | 10 |
| 結果が無いリソースがある（対応していない種類など） | `unsupported` | 11 |
| nested stack がある、結果が今回の検出より古い、`UNKNOWN` | `incomplete` | 11 |
| `DETECTION_FAILED`、上限まで待っても終わらない、API のエラー、stack の状態とリソースの結果が食い違う | `failed` | 12 |
| stack が無い | `missing-target` | 12 |

<<< @/tools/src/drift/cloudformation.ts{classify}

テストは `tools/src/drift/cloudformation.test.ts` にあって、入力は `tools/src/drift/fixtures/cloudformation/` の 12 個のファイルです。これは API リファレンスと SDK の型から書いたもので、実際の AWS から採った応答ではありません。たとえば、存在しない stack に対するエラーの名前とメッセージは、「こう返るはず」という想定です。違っていた場合でも、状態は `failed` になり、gate の終了コードは同じ 12 です。良いほうには倒れません。

定期実行の workflow です。

<<< @/examples/20-shipping/workflows/drift.yml

report は、gate が落ちたときこそ読みたいので、`if: always()` で保存します。

定期実行には、弱点もあります。GitHub のドキュメントによれば、schedule は混んでいる時間帯には遅れたり、実行が落とされたりします。public repository では、60 日間動きがないと自動で無効になります。「通知が来ない」は「drift が無い」を意味しません。report の日付が新しいことを、ときどき自分で見てください。

ちなみに、固定した版の CDK CLI には `cdk drift` というコマンドもあります。同じ CloudFormation の検出を呼んで、結果を表示してくれます。手元でさっと見るなら、それで十分です。この章がわざわざ自分で API を呼んでいるのは、「検査されなかったリソース」を数えたいからです。

## `IN_SYNC` は「全部一致」ではない

<!-- section: 20.drift-coverage -->

CloudFormation が stack を `IN_SYNC` と言うとき、それは何を言っているんでしょう。公式ドキュメントを読むと、範囲がかなり限られていることがわかります（確認日 2026-10-12）。

- **検査するのは、対応している種類のリソースだけ。** 対応していないものは、黙って飛ばされます。対応するリソースが 1 つも無い stack も、`IN_SYNC` になります
- **比べるのは、template で明示した property だけ。** 既定値のままにした設定を誰かが変えても、drift にはなりません
- **nested stack の中は見ない。** 親で検出しても、子は別に検出する必要があります
- **比べられない property がある。** Lambda 関数のコード、`KMSKeyId`、サービスが値を返さない項目（パスワードなど）
- **結果が古いことがある。** リソースごとの結果には、それぞれ検査した時刻が付いています

この章の gate は、これを 1 つずつ拾います。さっき `ListStackResources` を足したのは、1 つ目のためです。`DescribeStackResourceDrifts` は、検査したリソースしか返しません。stack にあるリソースの一覧と突き合わせて、結果が無いものを「未検査」として数えます。最後の点は、リソースの結果の時刻が、今回の検出の開始より前なら、検査済みに数えないことで拾っています。

2 つ目だけは、gate では拾えません。report の `clean` は、「template に書いた property が、すべて一致した」という意味です。それ以上ではありません。逆に言うと、drift を見張りたい設定は、既定値と同じでも、CDK のコードに明示しておく価値があります。

ここは、cdkd との違いでもあります。cdkd のドキュメントによると、cdkd はデプロイのときに、AWS が返した property を全部 state に写しておきます。だから cdkd の drift は、コードに書かなかった property の変更も見つけます。どちらが優れているという話ではなく、比べているものが違う、ということです。

### この stack の場合

`AihShipApi` が使うリソースの種類を、公式の対応表と照らしました。

<<< @/examples/20-shipping/src/drift-coverage.ts{coverage}

API Gateway の integration（route と Lambda をつなぐ設定）は、対応表の drift の欄が「No」です。つまりこの stack は、何もずれていなくても、`clean` にはなりません。`unsupported` になって、gate は 11 を返します。

毎日 11 で落ちる検査は、3 日で誰も見なくなります。かといって、11 を「合格」と読み替えたら、02章の区別が台無しです。そこで、「検査できないと分かっていて、それを承知している種類」の一覧を、コードに置きました。

<<< @/tools/src/drift/cloudformation.ts{acknowledge}

未検査のリソースが、すべてこの一覧にある種類のときだけ、タスクは 0 で終わります。report の状態は `unsupported` のまま、gate も不合格のまま。表示にも「比べていない」と出ます。変わるのは、タスクの終了コードだけです。drift があった場合や、一覧にない種類が未検査だった場合は、何も変わらず落ちます。

一覧に種類を足すのは、コードの変更です。pull request で、理由と一緒にレビューされます。stack に新しい種類のリソースを足すと、「検査される」「承知のうえで検査されない」のどちらかの一覧に入れるまで、テストが落ちるようにしてあります。

設計の側でできることもあります。この stack は、関数の role の権限を、別のリソース（`AWS::IAM::Policy`）ではなく、role の中に inline で書いています。

<<< @/examples/20-shipping/infra/lib/ship-api-stack.ts{role}

04章の書き方（`grantWrite`）だと、権限は `AWS::IAM::Policy` という別のリソースになります。この種類は、対応表に載っていません。role の中に書けば、権限は role の property になり、role は検査の対象です。同じ理由で、`AWS::CDK::Metadata` というリソースも出さないようにしました。「未検査」を 1 つ減らすたびに、report が言えることが増えます。

とはいえ、対応表を読んだだけです。integration が本当に未検査になるのか、role の権限を手で変えたら drift として出るのかは、次の手順を実際に通すまで分かりません。

## わざとずらしてみる

<!-- section: 20.drift-lab -->

dev の stack（`AihShipApi`）をデプロイしてあれば、次の順に試せます。

1. `vp run ship:cfn:drift` を実行する。integration が未検査として表示され、状態は `unsupported`、タスクは 0 で終わるはず
2. コンソールの Lambda の画面で、関数のメモリを 256 MB から 512 MB に変える
3. `vp run ship:cfn:diff` を実行する。変更なしと出るはず。template も、CloudFormation が覚えている template も、変わっていないので
4. `vp run ship:cfn:drift` を実行する。`drifted` になり、`/MemorySize` が表示され、終了コードが 10 になるはず
5. 戻す。コードは 256 のままなので、コンソールで 256 に戻すか、`vp run ship:cfn:deploy --revert-drift` を試す
6. もう一度 `vp run ship:cfn:drift` を実行し、1 と同じ結果に戻ったことを確かめる

「はず」と書いたのは、この手順をまだ実際のアカウントで通していないからです。5 の `--revert-drift` は、固定した版の CLI のヘルプにある flag ですが、動作は確かめていません。なお、template が変わっていないとき、ふつうの `cdk deploy` は「変更なし」と判断して何もしません。drift は、デプロイし直すだけでは直らないことがあります。

02章の cdkd には、drift を解消するタスク（revert と accept）がありました。この章には用意していません。CloudFormation で「実物を正とする」には、コードを実物に合わせて直してデプロイする、が本来の手順です。

## Workers から来た人へ

<!-- section: 20.workers -->

Cloudflare Workers のデプロイと比べると、違いは次のあたりです。

| | Cloudflare Workers | この章 |
| --- | --- | --- |
| デプロイ | `wrangler deploy` が version を作り、すぐ 100% に切り替える | synth して、CloudFormation が template の差分を 1 つずつ反映する |
| 版と切り替え | version と deployment。2 つの version に割合で振り分けられる | Lambda の version と alias。重み付けはできるが、この章では未実装 |
| 戻す | `wrangler rollback`。直近 100 個の version まで | 失敗時は CloudFormation が自動で戻す。あとから戻すなら、コードを戻してデプロイ |
| CI の認証 | ドキュメントの手順は、API token を CI の secret に置く | OIDC で、1 時間だけ有効な認証情報を受け取る。保存する秘密は無い |
| 戻らないもの | KV、R2、D1 などの中身は version に含まれない | データ、schema、外に出たもの |

Workers のほうが、ずっと短い手順で済みます。Worker は 1 つの単位で、version の切り替えは一瞬です。この章が長いのは、API Gateway、Lambda、role、log group という別々のリソースを、順番に更新しているからで、「途中で止まる」という話も、そこから出てきます。

戻らないものについては、どちらも同じでした。

## お金の話

金額は USD、東京リージョン、従量課金、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

この章が足したもの自体には、ほとんど料金がかかりません。CloudFormation は、`AWS::` で始まる種類のリソースについては追加料金なし。IAM の role と OIDC provider も、IAM の一部として追加料金なしです。stack の中身（HTTP API と Lambda）は、04章と同じで、呼ばれなければ 0 です。drift の検出にも、CloudFormation の料金はかかりません。

増えていくのは、CDK の asset の bucket です。デプロイのたびに、関数のコードの zip が 1 つ増えます。1 日 1 回のデプロイを 1 年続けて、一度も片付けなかったとして、月あたりの保存料金は 1 セント未満でした（USD 0.001192。zip は 1 つ 137 KB、S3 Standard が 1 GB あたり月 USD 0.025 という仮定）。137 KB は、この章の bundle を手元で圧縮した大きさで、CLI が実際に作る zip を量ったものではありません。コンテナイメージを使う stack だと、桁が変わります。

GitHub Actions の料金は、AWS の請求ではありません。GitHub のドキュメントによると、public repository で標準の runner を使うぶんには無料、private repository には、プランごとに毎月の無料の分数があります（GitHub Free で 2,000 分）。この章の workflow が 1 回に何分かかるかは、実行していないので分かりません。

preview の stack の料金は、中身しだいです。上の節に書いたとおりです。

## ハマりどころ

実行して出会ったものではなく、ドキュメントとコードから「ここで詰まりそう」と分かっているものです。

| こうなったら | ここを見る |
| --- | --- |
| `cdk deploy` が、bootstrap されていない、role を assume できない、と言う | `vp run ship:cfn:bootstrap` は、このアカウントとリージョンで済んでいますか。cdkd の bootstrap では代わりになりません |
| GitHub Actions で `AssumeRoleWithWebIdentity` が拒否される | token の `sub` と trust policy の文字列が、1 文字でも違うと通りません。job に `environment` はありますか。repository は ID 入りの形（`owner@123/repo@456`）ではありませんか |
| `AihShipCi` のデプロイが、OIDC provider が既にある、と失敗する | アカウントに登録済みです。`-c existingOidcProviderArn=...` を付けます |
| 最初のデプロイが失敗して、stack が `ROLLBACK_COMPLETE` で残っている | CloudFormation はこの stack を更新できません。次の `ship:cfn:deploy` で CLI が消して作り直します。先に、イベントで失敗の原因を |
| `ship:cfn:drift` が `failed` で、理由に `not authorized` と出る | DriftRole に、その resource type を読む権限が足りません。`ci-stack.ts` に足します |
| `ship:cfn:drift` が毎回 11 で終わる | 未検査の種類が、`drift-coverage.ts` の一覧にありません。本当に検査できない種類なのか、対応表で確かめてから足します |
| `ship:cfn:diff` が空なのに、動きが違う | diff は template どうしの比較です。`vp run ship:cfn:drift` を |
| prod の stack を消せない | termination protection です。本当に消すなら、コンソールで解除してから |

## 本番にするなら

- **cfn-exec role を絞る。** 既定は `AdministratorAccess` です。bootstrap のときに、必要な policy だけを渡します
- **アカウントを分ける。** dev、preview、prod を同じアカウントに置くかぎり、名前でしか分かれていません
- **`production` environment に保護を付ける。** デプロイできる branch を main に限り、承認を必須にします。trust policy が信用しているのは、この environment の名前です
- **エラー率で止める仕組みを足してから、段階的に切り替える。** alias の重み付けと CodeDeploy は、アラーム（[19章](/ja/chapters/19-observability.md)）と組にして使います
- **drift の report を、人が見る場所に流す。** 落ちた job の通知だけに頼らない。定期実行は止まることがあります
- **asset を片付ける。** 固定した版の CLI には `cdk gc` があります。この章では試していません
- **OIDC provider と CI の role も、drift を見る。** この章の DriftRole は、`AihShipApi` で始まる stack しか読めません。`AihShipCi` を誰かが書き換えても、気づけません

## 片付け

<!-- section: 20.cleanup -->

```bash
vp run ship:preview:list
vp run ship:cfn:destroy
vp run ship:ci:destroy
```

preview の stack が残っていたら、1 つずつ `vp run ship:cfn:destroy -c stage=pr-<番号>` で消します。prod を作っていたら、termination protection を解除してから `-c stage=prod` で。prod の log group は、stack を消しても残ります。

`ship:ci:destroy` で、OIDC provider と 4 つの role が消えます。GitHub の repository の variables と、`.github/workflows/` にコピーした workflow は、自分で消してください。workflow が残っていると、存在しない role を assume しようとして、毎日失敗し続けます。

最後に残るのが、CDK の bootstrap です。`CDKToolkit` stack は CloudFormation のコンソールから消せますが、asset の bucket は残る設定なので、空にしてから別に消します。ほかの CDK アプリが同じアカウントで `cdk deploy` を使っているなら、消さないでください。この片付けに対応するタスクは用意していません。

cdkd の bootstrap（02章）と、04章の `AihHttpApi` は、この章では何も変えていません。

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト（drift の polling と分類と gate、SDK の client を差し替えた呼び出し順、trust policy と role の権限、stage ごとの stack、CDK CLI の引数、stack の状態ごとの次の一手、preview の洗い出し、workflow の YAML）。型検査。固定した CDK CLI での synth（`ship:cfn:synth`。stage を変えたものも）。知らない stage と、repository を指定しない CI role のデプロイが、AWS を呼ぶ前に止まること。いずれも macOS（Apple silicon）です。

**まだ確かめていないこと。** AWS と GitHub に触るものは、すべて未実行です。`ship:cfn:bootstrap`、`ship:cfn:diff`、`ship:cfn:deploy`、`ship:smoke`、`ship:cfn:status`、`ship:cfn:drift`、`ship:preview:list`、`ship:cfn:destroy`、`ship:ci:diff`、`ship:ci:deploy`、`ship:ci:destroy`、4 つの workflow、「わざとずらしてみる」の手順、`cdkd export` と `cdkd import --migrate-from-cloudformation`。とくに次の点は、実環境での確認待ちです。

- IAM が trust policy を受け入れ、想定した job だけが role を assume できること。fork からの pull request で token が出るかどうか
- GitHub 用の role から、bootstrap の role を assume して `cdk diff` と `cdk deploy` が通ること
- DriftRole の読み取り権限が、実際の検出に足りること
- CloudFormation の drift 検出の、実際の応答の形。fixture は API リファレンスと SDK の型から書いたものです。存在しない stack に対するエラーの名前とメッセージも想定です
- integration が未検査になること、inline の policy の変更が role の drift として出ること、結果の時刻が検出の開始時刻以降になること
- 失敗したデプロイの rollback の様子、古い version が残ること
- x86_64-linux の runner で、Nix の devShell に入れること

**cdkd との関係。** この章の 2 つの stack は cdkd ではデプロイしませんが、決まりなので確かめました。固定した版の cdkd（0.296.28）は、`AWS::Lambda::Alias`、`AWS::Lambda::Version`、`AWS::IAM::OIDCProvider` に専用の実装を登録していません。ほかの種類（`AWS::ApiGatewayV2::*`、`AWS::IAM::Role`、`AWS::Lambda::Function`、`AWS::Lambda::Permission`、`AWS::Logs::LogGroup`）には登録があります。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 2 つの経路を、もう一度 | `examples/20-shipping/src/cdk-args.ts`、`scripts/cdk.ts`、`cdk.json` | `ship:cfn:bootstrap`、`ship:cfn:synth` |
| 環境は stack を分ける | `examples/20-shipping/infra/lib/config.ts`、`infra/lib/ship-api-stack.ts`、`infra/bin/app.ts`、`infra/test/ship-api-stack.test.ts` | `ship:cfn:synth`、`test:unit` |
| CloudFormation に渡す | `examples/20-shipping/src/cdk-args.ts`、`test/cdk-args.test.ts`、`scripts/smoke.ts`、`src/stack-info.ts` | `ship:cfn:diff`、`ship:cfn:deploy`、`ship:smoke` |
| 鍵を置かずに AWS に入る | `examples/20-shipping/infra/lib/ci-stack.ts`、`infra/lib/config.ts`、`infra/test/ci-stack.test.ts` | `ship:ci:diff`、`ship:ci:deploy`、`test:unit` |
| role に何を持たせるか | `examples/20-shipping/infra/lib/ci-stack.ts`、`infra/test/ci-stack.test.ts` | `test:unit` |
| workflow | `examples/20-shipping/workflows/`、`test/workflows.test.ts` | `test:unit` |
| pull request ごとの preview | `examples/20-shipping/workflows/preview.yml`、`src/previews.ts`、`scripts/previews.ts`、`test/previews.test.ts` | `ship:preview:list` |
| 戻せるもの、戻せないもの | `examples/20-shipping/infra/lib/ship-api-stack.ts` | `test:unit` |
| deploy は途中で止まる | `examples/20-shipping/src/stack-status.ts`、`test/stack-status.test.ts`、`scripts/status.ts` | `ship:cfn:status` |
| CloudFormation の drift を、同じ gate に通す | `tools/src/drift/cloudformation.ts`、`cloudformation-schema.ts`、`cloudformation.test.ts`、`fixtures/cloudformation/`、`examples/20-shipping/src/drift-client.ts`、`test/drift-client.test.ts`、`scripts/drift.ts` | `ship:cfn:drift`、`test:unit` |
| `IN_SYNC` は「全部一致」ではない | `examples/20-shipping/src/drift-coverage.ts`、`infra/test/ship-api-stack.test.ts` | `ship:cfn:drift`、`test:unit` |
| 片付け | `examples/20-shipping/scripts/cdk.ts` | `ship:cfn:destroy`、`ship:ci:destroy` |
| お金の話 | `data/pricing/`、`tools/src/pricing/calc.test.ts` | `test:unit` |

**一次情報**（確認日はすべて 2026-10-12）

- CloudFormation: [drift detection](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-stack-drift.html)、[stack 全体の drift の検出](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/detect-drift-stack.html)、[resource type の対応表](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/resource-import-supported-resources.html)、[失敗時の扱い](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/stack-failure-options.html)、[stack の状態](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/view-stack-events.html)、[rollback の続行](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-updating-stacks-continueupdaterollback.html)、[change set](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-updating-stacks-changesets.html)、[stack policy](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/protect-stack-resources.html)、[termination protection](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-protect-stacks.html)、[料金](https://aws.amazon.com/cloudformation/pricing/)
- CloudFormation API リファレンス: [DetectStackDrift](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DetectStackDrift.html)、[DescribeStackDriftDetectionStatus](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DescribeStackDriftDetectionStatus.html)、[DescribeStackResourceDrifts](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DescribeStackResourceDrifts.html)、[StackResourceDrift](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_StackResourceDrift.html)、[ListStackResources](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ListStackResources.html)、[CreateStack](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_CreateStack.html)
- AWS CDK: [bootstrapping](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html)、[環境の bootstrap](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping-env.html)、[cdk diff](https://docs.aws.amazon.com/cdk/v2/guide/ref-cli-cmd-diff.html)、[cdk drift](https://docs.aws.amazon.com/cdk/v2/guide/ref-cli-cmd-drift.html)、[aws-cdk 2.1145.0](https://www.npmjs.com/package/aws-cdk/v/2.1145.0)（ヘルプ出力、README、`cdk bootstrap --show-template`）
- IAM: [OIDC 用の role](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-idp_oidc.html)、[OIDC provider の作成](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html)、[IAM FAQs](https://aws.amazon.com/iam/faqs/)
- 権限の出典: [CloudFormation の resource type の schema](https://schema.cloudformation.ap-northeast-1.amazonaws.com/CloudformationSchema.zip)、AWS service reference（[CloudFormation](https://servicereference.us-east-1.amazonaws.com/v1/cloudformation/cloudformation.json)、[CloudWatch Logs](https://servicereference.us-east-1.amazonaws.com/v1/logs/logs.json)）
- GitHub: [OpenID Connect reference](https://docs.github.com/en/actions/reference/security/oidc)、[AWS での OIDC の設定](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)、[Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)、[workflow を起動するイベント](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)、[environment](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)、[料金](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- action: [aws-actions/configure-aws-credentials v6.3.0](https://github.com/aws-actions/configure-aws-credentials/tree/e1253824e5c10ff9df46874f81ed3ec929e19cfd)。`actions/checkout` v7.0.1、`cachix/install-nix-action` v31.11.1、`actions/upload-artifact` v7.0.2 は、GitHub の API で最新の release と commit を確認
- Lambda: [version](https://docs.aws.amazon.com/lambda/latest/dg/configuration-versions.html)、[重み付きの alias](https://docs.aws.amazon.com/lambda/latest/dg/configuring-alias-routing.html)、[CodeDeploy の deployment configuration](https://docs.aws.amazon.com/codedeploy/latest/userguide/deployment-configurations.html)
- cdkd: [Introduction](https://cdkd.dev/introduction/)、[Drift](https://cdkd.dev/drift/index.html)、[drift CLI reference](https://cdkd.dev/cli-drift/index.html)、[@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)（`export` と `import` のヘルプ、provider の登録）
- Cloudflare Workers: [Versions & deployments](https://developers.cloudflare.com/workers/versions-and-deployments/)、[Gradual deployments](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/)、[Rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)、[GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [@aws-sdk/client-cloudformation 3.1149.0](https://www.npmjs.com/package/@aws-sdk/client-cloudformation/v/3.1149.0)、[aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0)（型定義）

:::
