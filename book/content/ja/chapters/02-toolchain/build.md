---
title: "02 Toolchain: しくみと実装"
---

# 02 Toolchain: しくみと実装

## コマンドは全部 `vp run`

<!-- section: 02.vp -->

この本のコマンドは、すべて `vp run <タスク名>` です。Make や別のタスクランナーは使いません。タスクはルートの `vite.config.ts` にあって、ルートで実行します。名前を付けずに `vp run` とだけ打つと、一覧が出ます。

ややこしいのですが、`vp` には `vp dev`、`vp build`、`vp test`、`vp check` という組み込みのコマンドもあります。こちらは Vite+ の機能です。`vp run build:book` のように `run` が付くものは、この本が定義したタスク。この 2 つは混ぜないでくださいね。

タスクは 2 種類に分けてあります。

<<< @/vite.config.ts{kinds}

`live` は、AWS のような手元の外にあるものを読む、または変えるタスクです。必ず `cache: false` にしています。

なぜキャッシュが問題になるんでしょう。`vp run` は、入力ファイルが変わっていないタスクの実行を省いて、前回の出力を再生することがあります。ビルドなら時間の節約です。でも、デプロイや drift の検出でこれが起きたら？ 「成功した」という表示は前回のもので、いまのアカウントについては何も言っていません。だから、外部を読む、または変えるタスクでは無効にします。キャッシュが使われたときは `cache hit, replaying` と表示されるので、新しく実行した結果とは見分けられます。

もう 1 つ。`cache: false` のタスクには、呼び出し元の環境変数がそのまま渡ります。`AWS_PROFILE` が届くのは、このおかげです。

1 つの CDK アプリに対する操作は、次の関数でまとめて定義しています。

<<< @/vite.config.ts{infra}

この章のサンプルには `hello` という名前を付けたので、`hello:infra:synth`、`hello:infra:deploy` などができます。03章は `spa`、04章は `api`、本のサイトは `book` です。

手元だけで完結する検査は、1 つにまとめてあります。

```bash
vp run check:all
```

format、lint、型検査、テスト、すべての CDK アプリの synth、本のビルドとリンク検査を行います。AWS には触りません。drift の検出も入っていません。

型検査は、`vp check` ではなく `vp run typecheck` でやります。プロジェクトごとに `tsc` を走らせるだけのタスクです。ここには、ちょっとした事件がありました。書いている途中、変更していないソースに対して、`aws-cdk-lib` の import を別のモジュールと取り違える型エラーが、ときどき出たんです。同じ入力で 5 回実行して 2 回。犯人は pnpm と TypeScript 7 の組み合わせでした。pnpm は、中身が同じファイルを 1 つの実体へのハードリンクとして置きます。`aws-cdk-lib` には `export * from './lib';` とだけ書かれた `index.d.ts` が 3,501 個あって、全部が同じ inode を指していました。TypeScript 7 はファイルを inode で見分けるので、どれがどれだか分からなくなっていたわけです。`pnpm-workspace.yaml` の `packageImportMethod: clone-or-copy` で、ハードリンクをやめて複製にしたら、起きなくなりました。「ときどき落ちる検査」は、もう一度回せば通るからと放っておかれがちですが、原因はたいてい、どこかにちゃんとあります。

## 型が守るもの、守らないもの

<!-- section: 02.types -->

サンプルは bucket を 1 つ作るだけですが、設定を 2 つ受け取ります。環境の名前（`stage`）と、古い版の object を何日残すか（`noncurrentVersionDays`）です。

CDK では、こういう設定を context として渡せます。`cdk.json` に書くか、コマンドラインで `-c stage=prod` と指定します。困るのは、context が型のない値として届くこと。`-c noncurrentVersionDays=30` と書くと、届くのは数値の `30` ではなく、文字列の `"30"` です。

TypeScript の型注釈は、この値を検査してくれません。`as HelloConfig` と書いても、コンパイラが黙るだけで、実行時の値は何も変わらないんです。外から来た値は、実行時に schema と照合します。これを runtime validation と呼びます。

<<< @/examples/02-toolchain/lib/config.ts{schema}

型（`HelloConfig`）は schema から導いています。型と検査を別々に書いていないので、片方だけ直し忘れることがありません。

<<< @/examples/02-toolchain/lib/config.ts{parse}

不正な値は、どの項目が悪いかを添えて、synth の時点で失敗します。AWS に届く前です。

この先の章でも、同じやり方をします。環境変数、HTTP のリクエストとレスポンス、ブラウザの storage、queue のメッセージ。どれも型の外からやってきます。入口で一度検証して、内側では型を信じる。

逆に、型が守らないものもはっきりさせておきましょう。型が通っても、IAM の権限が足りているとは限りません。サービスの上限に収まっているとも、複数の処理が同時に走ったときに正しいとも限りません。そちらは、テストと実環境での確認で確かめます。

## construct、stack、app

<!-- section: 02.cdk -->

AWS CDK は、AWS のリソースを TypeScript の class として書く仕組みです。単位が 3 つあります。

- construct: 1 つ以上のリソースを表す class。`s3.Bucket` がそうです
- stack: まとめて作り、まとめて消すリソースの単位
- app: stack を集めたプログラム全体

<<< @/examples/02-toolchain/lib/hello-stack.ts{stack}

`s3.Bucket` の 1 行は、実は bucket のほかに、HTTPS 以外の接続を拒否する bucket policy も作ります。construct は、こういう既定をまとめて持っています。

`removalPolicy` は、stack を消したときに bucket をどうするか、です。練習用は一緒に消して、`prod` は残します。データを持つリソースでは、「消し忘れて料金がかかる」と「消してはいけないものを消す」のどちらが困るかを、リソースごとに決めることになります。この判断はテストで固定してあります。

<<< @/examples/02-toolchain/bin/app.ts{app}

`env` を見てください。リージョンだけを書いて、アカウントを書いていません。こうしておくと、synth は認証情報なしで動いて、AWS に何も問い合わせません。どのアカウントに作るかは、デプロイのときに使う認証情報で決まります。それを毎回表示して照合するのが、01章の `AIH_AWS_ACCOUNT_ID` でした。

## synth: コードを template にする

<!-- section: 02.synth -->

synth（合成）は、CDK のコードを実行して、CloudFormation の template と呼ばれる JSON を出力する処理です。出力先は `cdk.out/`。AWS は何も変わりません。

```bash
vp run hello:infra:synth
```

`examples/02-toolchain/cdk.out/AihHello.template.json` を開いてみてください。`AWS::S3::Bucket` と `AWS::S3::BucketPolicy` の 2 つが書かれています。CDK のコードは、最後にはこの宣言的な文書になるわけです。

テストは、この template に対して書きます。

```bash
vp run test:unit
```

`examples/02-toolchain/test/hello-stack.test.ts` が見ているのは、bucket が非公開であること、`prod` では削除でも置き換えでも残ること、設定した日数が lifecycle rule に入ること。これは「意図した template が出る」ことの検査です。AWS がその template を受け入れるか、作られた bucket が期待どおりに振る舞うかは、この検査の外にあります。

設定を変えて synth し直すこともできます。`vp run` は、タスク名のあとの引数をそのままコマンドに渡してくれます。

```bash
vp run hello:infra:synth -c stage=prod
```

## cdkd: template を AWS に反映する

<!-- section: 02.cdkd -->

template を AWS に反映する経路は、2 つあります。

1 つは AWS CDK CLI（`cdk deploy`）。template を CloudFormation に渡します。CloudFormation は AWS のサービスで、template を受け取ってリソースを作り、「何を作ったか」を自分で記録して、失敗したら巻き戻します。こちらが標準の経路です。

もう 1 つが cdkd。同じ template を読みますが、CloudFormation を通さずに、AWS の各サービスの API（一部は Cloud Control API）を直接呼んでリソースを作ります。「何を作ったか」の記録（state）は、あなたのアカウントの S3 bucket に JSON で保存します。

cdkd は `cdk deploy` の速い別名ではありません。作る経路も、記録の場所も別です。ここから、3 つのことが言えます。

1. cdkd の公式ドキュメントは、cdkd を開発・テスト用途向けとし、本番には AWS CDK CLI を勧めています（確認日 2026-10-11、固定した版は 0.296.28）。この本は、学習中の短い反復のために cdkd を使います。本番向けの経路は [20章](/ja/chapters/20-shipping.md)で扱います。
2. 同じリソースを 2 つの経路で交互に管理しない。cdkd で作った stack を `cdk deploy` で更新する、あるいはその逆をすると、2 つの記録が食い違います。
3. state を失うと、cdkd は自分が何を作ったか分からなくなる。state の bucket は versioning が有効で、復旧の手段として `cdkd import` があります。ただ、この本では復旧を実行して確かめてはいません。

準備として、アカウントとリージョンごとに一度だけ bootstrap をします。

```bash
vp run infra:bootstrap
```

これは AWS を変更します。固定した版のソースによれば、作られるのは次の 3 つです。

| 作られるもの | 名前 | 用途 |
| --- | --- | --- |
| S3 bucket | `cdkd-state-<アカウント ID>` | state の保存。アカウントに 1 つ |
| S3 bucket | `cdkd-assets-<アカウント ID>-<リージョン>` | デプロイ用のファイル置き場 |
| ECR repository | `cdkd-container-assets-<アカウント ID>-<リージョン>` | コンテナイメージ置き場 |

名前は似ていますが、`cdk bootstrap` とは別物です。`cdk bootstrap` は CloudFormation の stack（`CDKToolkit`）を作って、その中にデプロイ用の IAM role も含めます。cdkd の bootstrap は IAM role を作りません。cdkd は、あなたがサインインした認証情報の権限で、そのままリソースを作ります。

cdkd を呼ぶ処理は、次の関数に集めてあります。どのタスクがどの引数になるかは、ここを見ればわかります。

<<< @/tools/src/infra/cdkd-args.ts{invocation}

cdkd は、`AWS_REGION` が設定されていないと `us-east-1` を使います。意図しないリージョンに作ってしまわないよう、この本のタスクは必ず `AWS_REGION` を明示して cdkd を起動します。
