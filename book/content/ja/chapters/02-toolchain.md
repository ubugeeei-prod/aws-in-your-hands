---
title: 02 再現できる TypeScript 開発: Nix、vp、CDK、cdkd、drift
revision: 1
---

# 02 再現できる TypeScript 開発: Nix、vp、CDK、cdkd、drift

## この章の成果

- この本のすべてのコマンドが、誰の手元でも同じ版のツールで動く
- TypeScript で S3 bucket を 1 つ定義し、AWS に作り、変え、消せる
- 「これから何が変わるか（diff）」と「記録と実物がずれていないか（drift）」を別のものとして確かめられる

前提は [01章](/ja/chapters/01-account.md)です。サンプルは `examples/02-toolchain/` にあります。

## 構成

```text
your machine                                  AWS account (ap-northeast-1)
+----------------------------------+          +---------------------------------+
| nix develop                      |          | cdkd-state-<account>  (S3)      |
|   node, pnpm, aws, vp            |  cdkd    |   state.json per stack          |
| vp run <task>                    | -------> | cdkd-assets-<account>-<region>  |
|   CDK app (TypeScript) -> synth  |  SDK /   | AihHello stack                  |
|   cdk.out/ (template)            |  CC API  |   Notes bucket (S3)             |
+----------------------------------+          +---------------------------------+
```

コードが動くのは手元だけです。この章で AWS 側に作るのは bucket と、cdkd が使う保存場所です。

## 環境に入る

<!-- section: 02.nix -->

この本は、ツールの版を Nix で固定します。Nix は、パッケージを版とハッシュで固定して取得する仕組みです。`flake.nix` に「どのツールが要るか」を書き、`flake.lock` が「正確にどの版か」を記録します。この 2 つのファイルがあれば、Node.js を手で入れる必要はありません。

Nix 自体は自分で導入します。公式のインストーラで入れ、`nix-command` と `flakes` という 2 つの機能を有効にしてください。この本の検証には Nix 2.25.3 を使いました。Nix の知識はこれ以上は要りません。

リポジトリのルートで次を実行します。

```bash
nix develop
```

これで、固定した版のツールが入った shell に入ります。この shell を devShell と呼びます。初回はダウンロードに時間がかかります。

<<< @/flake.nix

入るのは Node.js 24.21.0、pnpm 10.34.5、AWS CLI 2.35.11、git、そして `vp` 1.1.0 です。正確な版の一覧は[ツールチェイン](/ja/reference/toolchain.md)にあります。

`vp` は nixpkgs に入っていないので、この本が Nix 式を持っています。配布元が npm に公開している platform 別のバイナリを、ハッシュを固定して取得します。

<<< @/nix/vp.nix

`shellHook` がしていることは 2 つです。1 つ目に、`vp` の設定置き場（`VP_HOME`）を、ホームディレクトリではなくリポジトリの中の `.vp-home/` に向けます。あなたの `~/.vite-plus` は読みも書きもしません。2 つ目に、`VP_SELF_SETUP_NO_MODIFY_PATH` を設定します。`vp` 1.1.0 は、新しい `VP_HOME` での初回起動時に自分自身をそこへ配置し、何も指定しなければ `~/.zshrc` などの shell の設定ファイルに 1 行を追記します。この変数がそれを止めます。devShell に入っただけでホームディレクトリのファイルが書き換わるべきではないからです。初回起動はネットワークを使います。そこへ置く設定は次の 1 ファイルで、`vp` に「Node.js と pnpm は自分でダウンロードせず、PATH にあるもの（Nix が入れたもの）を使え」と伝えます。

<<< @/nix/vp-home.json

意図した Node.js が使われているかは、次で確かめます。

```bash
vp env which node
```

`/nix/store/` で始まるパスが出れば、Nix の Node.js です。

**検証した組み合わせ。** macOS（Apple silicon、`aarch64-darwin`）だけです。Intel Mac と Linux 用の定義も `nix/vp.nix` にありますが、実行して確かめていません。

**Nix が用意しないもの。** AWS の認証情報、Docker の daemon、ネットワーク。04章の一部で Docker を使いますが、devShell に入っただけでは daemon は動いていません。

## 依存を入れる

<!-- section: 02.install -->

```bash
vp install --frozen-lockfile
```

`vp install` は、`package.json` の `packageManager` に書かれた package manager を呼びます。この本では pnpm 10.34.5 です。`--frozen-lockfile` は「`pnpm-lock.yaml` に書かれた版だけを入れ、lockfile を書き換えない」という指定です。

`vp` を使っても lockfile は必要です。`vp` 専用の lockfile はなく、pnpm の `pnpm-lock.yaml` がそれです。

CDK の CLI も cdkd も、この `vp install` で入ります。Nix で入れるのは Node.js までで、npm のパッケージは pnpm が管理します。同じツールを 2 か所で管理しないためです。

## タスクを実行する

<!-- section: 02.vp -->

この本のコマンドは、すべて `vp run <タスク名>` です。Make や別のタスクランナーは使いません。タスクはルートの `vite.config.ts` にあり、ルートで実行します。名前を付けずに `vp run` とだけ打つと一覧が出ます。

`vp` には `vp dev`、`vp build`、`vp test`、`vp check` という組み込みのコマンドもあります。これらは Vite+ の機能です。`vp run build:book` のように `run` を付けたものは、この本が定義したタスクです。この 2 つを混同しないでください。

タスクは 2 種類に分けてあります。

<<< @/vite.config.ts{kinds}

`live` は、AWS など手元の外にあるものを読む、または変えるタスクです。必ず `cache: false` です。

なぜキャッシュが問題になるのか。`vp run` は、入力ファイルが変わっていないタスクの実行を省き、前回の出力を再生することがあります。ビルドなら時間の節約です。しかしデプロイや drift 検出でこれが起きると、「成功した」という表示は前回のもので、いまのアカウントについては何も言っていません。だから外部を読む、または変えるタスクでは無効にします。キャッシュが使われたときは `cache hit, replaying` と表示されるので、新しく実行した結果と区別できます。

もう 1 つ、`cache: false` のタスクには呼び出し元の環境変数がそのまま渡ります。`AWS_PROFILE` が届くのはこのためです。

1 つの CDK アプリに対する操作は、次の関数でまとめて定義しています。

<<< @/vite.config.ts{infra}

この章のサンプルには `hello` という名前を付けたので、`hello:infra:synth`、`hello:infra:deploy` などができます。03章は `spa`、04章は `api`、本のサイトは `book` です。

手元だけで完結する検査は、次の 1 つにまとめてあります。

```bash
vp run check:all
```

format、lint、型検査、テスト、すべての CDK アプリの synth、本のビルドとリンク検査を行います。AWS には触りません。drift の検出も含みません。

型検査は、`vp check` ではなく `vp run typecheck` で行います。`vp check` にも型検査の機能がありますが、この本が固定した版（TypeScript 7.0.2）では、変更していないソースに対して `aws-cdk-lib` の import を別のモジュールと取り違えるエラーが、ときどき出ました。同じ入力で 5 回実行して 2 回です。`tsc` に単一スレッドでの実行を指定すると再現しなくなったので、`typecheck` はそうしています。正しいコードでときどき落ちる検査は、「もう一度実行すれば通る」という習慣を生み、本当の失敗も見逃させます。

## 型と、型が守らないもの

<!-- section: 02.types -->

サンプルは bucket を 1 つ作るだけですが、設定を 2 つ受け取ります。環境の名前（`stage`）と、古い版の object を何日残すか（`noncurrentVersionDays`）です。

CDK では、こうした設定を context として渡せます。`cdk.json` に書くか、コマンドラインで `-c stage=prod` と指定します。問題は、context が**型のない値**として届くことです。`-c noncurrentVersionDays=30` と書けば、届くのは数値の `30` ではなく文字列の `"30"` です。

TypeScript の型注釈は、この値を検査しません。`as HelloConfig` と書いても、コンパイラが黙るだけで、実行時の値は変わりません。外から来た値は、実行時に schema と照合します。これを runtime validation と呼びます。

<<< @/examples/02-toolchain/lib/config.ts{schema}

型（`HelloConfig`）は schema から導いています。型と検査が別々に書かれていないので、片方だけ直し忘れることがありません。

<<< @/examples/02-toolchain/lib/config.ts{parse}

不正な値は、どの項目が悪いかを添えて、synth の時点で失敗します。AWS に届く前です。

この先の章でも同じ方針を取ります。環境変数、HTTP のリクエストとレスポンス、ブラウザの storage、queue のメッセージは、どれも型の外から来ます。入口で一度検証し、内側では型を信じます。

型が守らないものも、はっきりさせておきます。型が通っても、IAM の権限が足りているとは限りません。サービスの上限に収まっているとも、複数の処理が同時に走ったときに正しいとも限りません。それらは、テストと実環境での確認で確かめます。

## construct、stack、app

<!-- section: 02.cdk -->

AWS CDK は、AWS のリソースを TypeScript の class として書く仕組みです。3 つの単位があります。

- **construct**: 1 つ以上のリソースを表す class。`s3.Bucket` がそうです
- **stack**: まとめて作り、まとめて消すリソースの単位
- **app**: stack を集めたプログラム全体

<<< @/examples/02-toolchain/lib/hello-stack.ts{stack}

`s3.Bucket` の 1 行は、実際には bucket に加えて、HTTPS 以外の接続を拒否する bucket policy も作ります。construct は、こうした既定をまとめて持っています。

`removalPolicy` は、stack を消したときに bucket をどうするかです。練習用は一緒に消し、`prod` は残します。データを持つリソースでは、「消し忘れて料金がかかる」と「消してはいけないものを消す」のどちらが困るかを、リソースごとに決める必要があります。この判断はテストで固定しています。

<<< @/examples/02-toolchain/bin/app.ts{app}

`env` にリージョンだけを書き、アカウントを書いていない点に注意してください。こうすると synth は認証情報なしで動き、AWS に何も問い合わせません。どのアカウントに作るかは、デプロイのときに使う認証情報で決まります。それを毎回表示して照合するのが、01章の `AIH_AWS_ACCOUNT_ID` です。

## synth: コードを template にする

<!-- section: 02.synth -->

synth（合成）は、CDK のコードを実行して、CloudFormation の template と呼ばれる JSON を出力する処理です。出力先は `cdk.out/` です。AWS は何も変わりません。

```bash
vp run hello:infra:synth
```

`examples/02-toolchain/cdk.out/AihHello.template.json` を開くと、`AWS::S3::Bucket` と `AWS::S3::BucketPolicy` の 2 つが書かれています。CDK のコードは、最終的にこの宣言的な文書になります。

テストは、この template に対して書きます。

```bash
vp run test:unit
```

`examples/02-toolchain/test/hello-stack.test.ts` は、bucket が非公開であること、`prod` では削除と置き換えのどちらでも残ること、設定した日数が lifecycle rule に入ることを確かめます。これは「意図した template が出る」ことの検査です。AWS がその template を受け入れるか、作られた bucket が期待どおりに振る舞うかは、この検査の外にあります。

設定を変えて synth し直すこともできます。`vp run` は、タスク名のあとの引数をそのままコマンドに渡します。

```bash
vp run hello:infra:synth -c stage=prod
```

## cdkd: template を AWS に反映する

<!-- section: 02.cdkd -->

template を AWS に反映する経路は 2 つあります。

**AWS CDK CLI（`cdk deploy`）。** template を CloudFormation に渡します。CloudFormation は AWS のサービスで、template を受け取ってリソースを作り、「何を作ったか」を自分で記録し、失敗したら巻き戻します。これが標準の経路です。

**cdkd。** 同じ template を読み、CloudFormation を通さずに、AWS の各サービスの API（一部は Cloud Control API）を直接呼んでリソースを作ります。「何を作ったか」の記録（state）は、あなたのアカウントの S3 bucket に JSON で保存します。

cdkd は `cdk deploy` の速い別名ではありません。作成の経路も、記録の場所も別です。ここから 3 つのことが言えます。

1. **cdkd の公式ドキュメントは、cdkd を開発・テスト用途向けとし、本番には AWS CDK CLI を勧めています**（確認日 2026-10-11、固定した版は 0.296.28）。この本は、学習中の短い反復のために cdkd を使います。本番向けの経路は 20章で扱う予定です。
2. **同じリソースを 2 つの経路で交互に管理しない。** cdkd で作った stack を `cdk deploy` で更新する、あるいはその逆をすると、2 つの記録が食い違います。
3. **state を失うと、cdkd は自分が何を作ったか分からなくなる。** state の bucket は versioning が有効で、復旧の手段として `cdkd import` があります。この本では復旧を実行して確かめていません。

準備として、アカウントとリージョンごとに一度だけ bootstrap を行います。

```bash
vp run infra:bootstrap
```

これは AWS を変更します。固定した版のソースによれば、作られるのは次の 3 つです。

| 作られるもの | 名前 | 用途 |
| --- | --- | --- |
| S3 bucket | `cdkd-state-<アカウント ID>` | state の保存。アカウントに 1 つ |
| S3 bucket | `cdkd-assets-<アカウント ID>-<リージョン>` | デプロイ用のファイル置き場 |
| ECR repository | `cdkd-container-assets-<アカウント ID>-<リージョン>` | コンテナイメージ置き場 |

`cdk bootstrap` とは別物です。`cdk bootstrap` は CloudFormation の stack（`CDKToolkit`）を作り、その中にデプロイ用の IAM role も含めます。cdkd の bootstrap は IAM role を作りません。cdkd は、あなたがサインインした認証情報の権限でそのままリソースを作ります。

cdkd を呼ぶ処理は、次の関数に集めてあります。どのタスクがどの引数になるかは、ここを見れば分かります。

<<< @/tools/src/infra/cdkd-args.ts{invocation}

cdkd は、`AWS_REGION` が設定されていないと `us-east-1` を使います。意図しないリージョンに作らないよう、この本のタスクは必ず `AWS_REGION` を明示して cdkd を起動します。

## デプロイする

<!-- section: 02.deploy -->

```bash
vp run hello:infra:diff
vp run hello:infra:deploy
```

`diff` は、これから作られるものを表示します。初回は bucket と bucket policy の 2 つが「作成」として出るはずです。`deploy` が実際に作ります。どちらも実行前にアカウントとリージョンを表示し、`AIH_AWS_ACCOUNT_ID` と一致しなければ止まります。

デプロイが終わると、bucket の名前が出力されます。コンソールの S3 の画面でも確かめられます。

設定を変えてもう一度 diff を取ると、変更だけが出ます。

```bash
vp run hello:infra:diff -c noncurrentVersionDays=30
```

## diff と drift は別の検査

<!-- section: 02.diff-drift -->

ここまでに、「bucket の設定」を表すものが 4 つ出てきました。

| | 何か | どこにあるか |
| --- | --- | --- |
| ソース | CDK のコード | リポジトリ |
| template | synth の出力 | `cdk.out/` |
| state | cdkd が「こう作った」と記録したもの | `cdkd-state-...` bucket |
| 実物 | いま AWS にある設定 | AWS |

**diff** は、template と state を比べます。「このコードをデプロイしたら何が変わるか」という予告です。実物は見ません。

**drift** は、state と実物を比べます。「記録どおりの設定がいまも AWS にあるか」という確認です。誰かがコンソールで設定を変えると、ここに差が出ます。

diff が空でも、drift が無いとは言えません。コンソールで bucket の versioning を止めても、コードも state も変わらないので、diff は「変更なし」と言います。

CloudFormation の経路にも同じ区別があります。`cdk diff` は template どうしの比較で、実物との比較は CloudFormation の drift detection という別の機能です。そちらは 20章で扱う予定です。

## drift を検出する

<!-- section: 02.drift-gate -->

```bash
vp run hello:infra:drift
```

このタスクは `cdkd drift AihHello --json` を実行し、結果を `reports/drift/AihHello.json` に書き、最後に合否を出します。AWS を読みますが、変更はしません。

合否の判定は、cdkd の終了コードだけに任せていません。固定した版では、cdkd は次のときにも終了コード 0 を返します。

- 読み戻す手段がない種類のリソースがあり、比較していない
- 比較を省いたリソースがある

「差が見つからなかった」と「全部比べて一致した」は違います。この本の gate は、すべてのリソースを比べて一致したときだけ合格にします。

<<< @/tools/src/drift/report.ts{gate}

状態は 7 つあります。

| 状態 | 意味 | gate の終了コード |
| --- | --- | --- |
| `clean` | すべて比べて一致した | 0 |
| `drifted` | 記録と違う設定がある | 10 |
| `deleted` | 記録にあるリソースが AWS に無い | 10 |
| `incomplete` | 読み出しに失敗するなどして、比べられなかったものがある | 11 |
| `unsupported` | 読み戻せない種類のリソースがあり、比べていない | 11 |
| `failed` | 検出そのものが結果を出さなかった | 12 |
| `missing-target` | 指定した stack の記録が無い | 12 |

終了コードを分けたのは、CI が「違いがある」と「分からない」を区別できるようにするためです。report には、実行した時刻、アカウント、リージョン、比べた数と比べなかった数が残ります。

report の読み取りは、cdkd の出力を schema で検証してから行います。cdkd の出力も、この本のコードにとっては外から来るデータだからです。出力が空だった、指定した stack が含まれていなかった、終了コードと中身が食い違っていた、という場合は、良いほうに解釈せず `failed` か `missing-target` にします。これらは `tools/src/drift/fixtures/` の 9 つの入力に対してテストしています。fixture は cdkd の型定義から手で書いたもので、実際の AWS から採取した出力ではありません。

### drift を解消する

drift が見つかったら、選択肢は 3 つあります。どれを選ぶかは人が決めます。

| 選択 | すること | 注意 |
| --- | --- | --- |
| 実物を記録に戻す | `vp run hello:infra:drift:revert:preview` で内容を確かめてから `vp run hello:infra:drift:revert` | 置き換えが必要な変更では、データを持つリソースが作り直される場合がある。preview を必ず読む |
| 実物の設定を正とする | `vp run hello:infra:drift:accept` | 書き換わるのは state だけ。CDK のコードは変わらないので、次のデプロイで元に戻る。**コードも同じ値に直す** |
| コードを直してデプロイし直す | コードを変更して `vp run hello:infra:deploy` | 意図した変更なら、これが本来の手順 |

どれを選んでも、最後にもう一度 `vp run hello:infra:drift` を実行します。解消のコマンドが成功したことは、stack が一致していることの証明ではありません。

### 試してみる

デプロイした bucket で、次の順に試せます。

1. コンソールで bucket の「バージョニング」を「停止」に変える
2. `vp run hello:infra:diff` を実行する。変更なしと出るはず
3. `vp run hello:infra:drift` を実行する。`drifted` になり、終了コードが 10 になるはず
4. `vp run hello:infra:drift:revert:preview` で戻す内容を見て、`vp run hello:infra:drift:revert` で戻す
5. もう一度 `vp run hello:infra:drift` を実行し、`clean` を確かめる

「はず」と書いたのは、この手順を実際の AWS アカウントで実行していないからです。

## 料金

この章が作るのは、空の S3 bucket と、cdkd の保存場所です。

| 状態 | かかるもの |
| --- | --- |
| 使っていないとき | S3 の保存量に対する料金。bucket が空なら 0。cdkd の state と template は小さな JSON ファイル（大きさは計測していない） |
| 操作したとき | S3 のリクエスト料金。デプロイ 1 回あたりのリクエスト数は計測していない |
| stack を消した後 | cdkd の 3 つの保存場所が残る（次節） |

東京リージョンの S3 Standard の保存料金は、最初の 50 TB まで 1 GB あたり月 USD 0.025 です（AWS Price List、確認日 2026-10-11）。単価の一覧は[料金の計算](/ja/reference/pricing.md)にあります。

## 片付け

<!-- section: 02.cleanup -->

```bash
vp run hello:infra:destroy
```

cdkd が確認を求めます。練習用の bucket は空なので、そのまま消えます。

stack を消しても、bootstrap で作った 3 つは残ります。この本の続きを読むなら、残しておいてください。03章以降も使います。

すべて終えて消すときは、コンソールで次の順に行います。この手順に対応するタスクは用意していません。state の bucket には、あなたが cdkd で作った**すべての stack**の記録が入っているので、機械的に消す対象にしたくないからです。

1. `vp run hello:infra:destroy` などで、cdkd で作った stack をすべて消す
2. S3 の画面で `cdkd-assets-...` を空にして削除する
3. S3 の画面で `cdkd-state-...` を空にして削除する。versioning が有効なので、「空にする」で全 version を消す
4. ECR の画面で `cdkd-container-assets-...` を削除する

stack が残っているのに state の bucket を消すと、cdkd はその stack を消せなくなります。

## うまくいかないとき

| 症状 | 確かめること |
| --- | --- |
| `nix develop` が flakes を知らないと言う | Nix の設定で `nix-command` と `flakes` が有効か |
| `vp run` が `Task "..." not found` と言う | リポジトリのルートで実行しているか |
| synth が設定の誤りで止まる | メッセージに項目名が出る。`-c` の値を見直す |
| デプロイが state の bucket が無いと言って止まる | `vp run infra:bootstrap` を済ませたか。リージョンが合っているか |
| デプロイが権限エラーで止まる | cdkd はあなたの認証情報で直接作る。01章の identity に必要な権限があるか |
| 別のリージョンに作られた | この本のタスクを通さず cdkd を直接実行すると、`AWS_REGION` が無い場合に `us-east-1` になる |

## 本番に進めるなら

- **反映の経路を AWS CDK CLI と CloudFormation にする。** cdkd 自身がそう勧めています。同じ CDK のコードをそのまま使えます。
- **データを持つリソースは `RemovalPolicy.RETAIN` にする。** サンプルの `prod` がその例です。
- **人の認証情報でデプロイしない。** CI から、期限の短い認証情報で実行します（20章の予定）。
- **drift の検出を定期的に実行する。** 例を `docs/examples/drift-schedule.yml` に置いています。

## この章の検証状況

- 環境（`nix develop`、`vp install --frozen-lockfile`）、synth、ユニットテスト、drift の gate のテストは、macOS（Apple silicon）で**ローカル検証済み**です。
- `infra:bootstrap`、`hello:infra:diff`、`hello:infra:deploy`、`hello:infra:drift`、解消の各タスク、`hello:infra:destroy` は、実際の AWS アカウントでは実行していません。**未検証**です。cdkd の挙動についての記述は、固定した版のソース、ヘルプ出力、公式ドキュメントに基づきます。

## この章のソース対応

| 節 | 対応するファイル | タスク |
| --- | --- | --- |
| 環境に入る | `flake.nix`、`flake.lock`、`nix/vp.nix`、`nix/vp-home.json` | （`nix develop`） |
| 依存を入れる | `package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml` | （`vp install`） |
| タスクを実行する | `vite.config.ts` | `check:all` |
| 型と、型が守らないもの | `examples/02-toolchain/lib/config.ts`、`examples/02-toolchain/test/config.test.ts` | `test:unit` |
| construct、stack、app | `examples/02-toolchain/lib/hello-stack.ts`、`examples/02-toolchain/bin/app.ts` | `hello:infra:synth` |
| synth | `examples/02-toolchain/cdk.json`、`examples/02-toolchain/test/hello-stack.test.ts` | `hello:infra:synth`、`hello:infra:synth:cdk`、`test:unit` |
| cdkd | `tools/src/infra/cdkd-args.ts`、`tools/src/infra/cdkd.ts`、`tools/src/infra/run-cdkd.ts` | `infra:bootstrap` |
| デプロイする | 同上 | `hello:infra:diff`、`hello:infra:deploy` |
| drift を検出する | `tools/src/drift/schema.ts`、`tools/src/drift/report.ts`、`tools/src/drift/cli.ts`、`tools/src/drift/fixtures/`、`tools/src/drift/report.test.ts` | `hello:infra:drift`、`hello:infra:drift:revert:preview`、`hello:infra:drift:revert`、`hello:infra:drift:accept` |
| 片付け | 同上 | `hello:infra:destroy` |

## 一次情報

- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)（npm の tarball と同じ版のソース。確認日 2026-10-11）
- [cdkd: Introduction](https://cdkd.dev/introduction/)（確認日 2026-10-11）
- [vite-plus 1.1.0](https://www.npmjs.com/package/vite-plus/v/1.1.0)（同梱ドキュメントと手元での実行。確認日 2026-10-11）
- [nixpkgs（flake.lock の revision）](https://github.com/NixOS/nixpkgs/tree/8edc0c72e3a38faf5434e40d1f19431125fe4b30)（確認日 2026-10-11）
- [AWS CDK bootstrapping](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html)、[cdk diff](https://docs.aws.amazon.com/cdk/v2/guide/ref-cli-cmd-diff.html)、[CloudFormation drift detection](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-stack-drift.html)（執筆時に未再確認）
