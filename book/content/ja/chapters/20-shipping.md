---
title: "20 CI/CD: OIDC、環境、preview、rollback、drift"
revision: 4
---

# 20 CI/CD: OIDC、環境、preview、rollback、drift

ここまでの章では、自分の端末から、自分の認証情報で、cdkd を使ってデプロイしてきました。学ぶには速いやり方ですが、本番向けの経路と、人の認証情報を使わないデプロイについては、そのたびに「20章で扱います」と先送りにしてきました。

この章でその両方を扱います。04章の API を、AWS CDK CLI と CloudFormation を使う標準の経路でデプロイし、GitHub Actions がアクセスキーをどこにも置かずに AWS に入れるようにします。あわせて、02章で作ったドリフトの判定に、CloudFormation のドリフト検出をつなぎます。

この章の AWS 側の手順と GitHub Actions のワークフローは、まだ一度も実際には動かしていません。手元で確かめたのは、テスト、型検査、synth までです。何が未確認かは、[章末の検証メモ](/ja/chapters/20-shipping/wrap.md)にまとめてあります。

前提は [02章](/ja/chapters/02-toolchain.md)と [04章](/ja/chapters/04-http-api.md)です。コードは `examples/20-shipping/` と `tools/src/drift/` にあります。

## 全体像

<!-- section: 20.architecture -->

```figure
caption: 手元と GitHub Actions は同じ flake.lock、同じ pnpm-lock.yaml、同じ vp run タスクを使い、AWS にはアクセスキーを置かずに、ジョブごとに OIDC トークンを 1 時間の認証情報と交換する
direction: right
node laptop: Developer laptop | check:all, ship:cfn:synth
node gha: GitHub Actions | pr, deploy, drift, preview
node aws: AWS account | ap-northeast-1
edge laptop -> gha: git push
edge gha -> aws: OIDC トークン
edge aws --> gha: 1 時間の認証情報
```

```figure
caption: AWS に触る 4 つのワークフローは、それぞれ別の IAM ロールを使う
direction: right
node pr: pr.yml | check: check:all (AWS なし)
node deploy: deploy.yml | check:all, status, ship:smoke
node drift: drift.yml
node preview: preview.yml
node plan: PlanRole
node deployrole: DeployRole
node driftrole: DriftRole
node previewrole: PreviewRole
edge pr -> plan: plan: ship:cfn:diff
edge deploy -> deployrole: ship:cfn:deploy
edge drift -> driftrole: ship:cfn:drift
edge preview -> previewrole: deploy / destroy
group gha: GitHub Actions = pr, deploy, drift, preview
group aws: AWS account (ap-northeast-1) = plan, deployrole, driftrole, previewrole
```

```figure
caption: 4 つのロールは届く先がそれぞれ違い、スタックを作れるのは DeployRole と PreviewRole だけ
direction: right
node plan: PlanRole | pr.yml
node deployrole: DeployRole | deploy.yml
node driftrole: DriftRole | drift.yml
node previewrole: PreviewRole | preview.yml
node lookup: cdk lookup role | 読むだけ
node cdkdeploy: cdk deploy role | CloudFormation へ
node detect: DetectStackDrift | 読むだけ
node prstack: AihShipApiPr<number> | プレビューのスタック
node cfn: CloudFormation | cfn-exec role が AihShipApiProd を作る
edge plan -> lookup
edge deployrole -> cdkdeploy
edge driftrole -> detect
edge previewrole -> prstack
edge cdkdeploy -> cfn
group aws: AWS account (ap-northeast-1) = plan, deployrole, driftrole, previewrole, lookup, cdkdeploy, detect, prstack, cfn
```

1 つ目の図にあるとおり、登場する場所は手元の端末、GitHub Actions、AWS アカウントの 3 つです。

手元では、これまでどおり `vp run` でテストと synth を実行します。GitHub Actions も、同じ `flake.lock` から同じ devShell に入り、同じ `vp run` タスクを呼びます。CI 専用のスクリプトは用意していません。手元と CI で実行するものが同じなら、「CI では通るのに手元では通らない」という食い違いが起きる余地がないからです。

AWS に触るジョブは 4 種類あり、2 つ目の図のように、それぞれが別の IAM ロールを使います。プルリクエストのジョブは読むだけで、main への push でデプロイし、毎日の定期実行でドリフトを検出します。プルリクエストごとのプレビューは、専用のスタックを作り、閉じたときに削除します。各ロールが AWS の中で何に届くかは、3 つ目の図に描きました。

題材は 04章の API ですが、スタックは別に作ります。04章で cdkd が作った `AihHttpApi` には触らず、`AihShipApi` という別の名前のスタックを CloudFormation に作らせます。

## 2 つの経路を、もう一度

<!-- section: 20.two-paths -->

02章で、テンプレートを AWS に反映する経路は 2 つあると説明しました。ここではその 2 つを振り返ったうえで、CloudFormation の側を詳しく見ます。

cdkd は、AWS の各サービスの API を自分で呼んでリソースを作り、何を作ったかを S3 の JSON に記録します。一方、AWS CDK CLI（`cdk deploy`）はテンプレートを CloudFormation に渡すだけで、リソースを作るのも、記録するのも、失敗したときに戻すのも、CloudFormation が引き受けます。

cdkd の公式ドキュメントは、本番には AWS CDK CLI を使い続けるよう勧めています。理由として挙げているのは、変更セットやスタックポリシーといった、CloudFormation が備えている機能です（確認日 2026-10-12）。この章で使う機能は次のとおりです。

- スタック: 何を作ったかの記録。自分の S3 バケットではなく、CloudFormation の中にある
- 変更セット（change set）: 更新の前に、何が追加され、変わり、置き換わり、消えるかを一覧にしたもの
- 自動のロールバック: 更新の途中でリソースが 1 つでも失敗したら、既定では前の設定に戻す
- ドリフト検出（drift detection）: テンプレートと実物の比較。比べる範囲には限りがあり、[デプロイのページ](/ja/chapters/20-shipping/deploy.md)の後半で詳しく扱う
- 削除保護（termination protection）とスタックポリシー（stack policy）: 誤って消したり置き換えたりしないための歯止め

### CDK の bootstrap は、cdkd の bootstrap とは別

`cdk deploy` を使うには、アカウントとリージョンごとに一度、CDK の bootstrap を済ませておく必要があります。02章の cdkd の bootstrap と名前は同じですが、作られるものは別です。

```bash
vp run ship:cfn:bootstrap
```

このタスクは AWS を変更します。固定した版の CLI（2.1145.0）が持っているテンプレートを `cdk bootstrap --show-template` で出力して読んだところ、作られるのは `CDKToolkit` という CloudFormation のスタックで、中身は次のとおりでした。

| | cdkd の bootstrap（02章） | CDK の bootstrap（この章） |
| --- | --- | --- |
| 作る手段 | cdkd が API を直接呼ぶ | CloudFormation のスタック `CDKToolkit` |
| S3 バケット | `cdkd-state-<アカウント>`、`cdkd-assets-<アカウント>-<リージョン>` | `cdk-hnb659fds-assets-<アカウント>-<リージョン>` |
| ECR リポジトリ | `cdkd-container-assets-<アカウント>-<リージョン>` | `cdk-hnb659fds-container-assets-<アカウント>-<リージョン>` |
| IAM ロール | なし。実行した人の権限でそのまま作る | 5 つ（表の下で説明します） |
| 何を作ったかの記録 | state のバケットの JSON | CloudFormation が持つ。バケットには置かない |
| その他 | | 版を記録する SSM パラメーター `/cdk-bootstrap/hnb659fds/version` |

`hnb659fds` は qualifier と呼ばれる既定の文字列で、値そのものに意味はありません。

作られるロールは 5 つです。file-publishing role は CLI がテンプレートや zip をバケットに置くために使い、image-publishing role はコンテナイメージを置くために使います。deploy role は CloudFormation に指示を出し、lookup role はアカウントの情報を読みます。残る cfn-exec role は、CloudFormation 自身がリソースを作るときに使うロールです。

この cfn-exec role には注意が要ります。何も指定しないと、cfn-exec role には `AdministratorAccess` が付きます。そのため、deploy role を使える人は、テンプレートに書きさえすれば、CloudFormation を通して何でも作れます。権限を絞るには、bootstrap のときに `--cloudformation-execution-policies` でポリシーを指定します。この章のタスクは既定のままにしているので、本番のアカウントでは最初にここを見直してください。

アセットのバケットは、`CDKToolkit` スタックを消しても残る設定になっています。

### 同じスタックを、2 つのツールで交互に触らない

02章でも書いたとおり、cdkd で作ったスタックを `cdk deploy` で更新することも、その逆も、この本ではしません。記録が 2 か所にできてしまい、どちらのツールも自分の記録がすべてだという前提で動くからです。

この章がスタックの名前を分けているのは、そのためです。cdkd の公式ドキュメントも、1 つの CDK アプリを、開発環境には cdkd で、本番には AWS CDK CLI でデプロイする使い方を挙げています。ツールを使い分ける単位は、スタック、つまり環境です。

いま cdkd で動いているスタックを、CloudFormation の管理に移したくなる場合もあります。固定した版の cdkd には、そのための `export` と、逆向きの `import --migrate-from-cloudformation` があります。ヘルプによれば、`export` は CloudFormation の import の変更セットを使ってリソースをそのまま引き渡し、成功したら cdkd の state を消します。import できない種類のリソースが 1 つでもあれば中止します。これは日々のデプロイとは別の、一度きりの移行作業です。この本では実行していないので、試すなら練習用のスタックを使い、`--dry-run` で出る計画を読んでからにしてください。

### CDK CLI を呼ぶ場所は 1 つ

cdkd のときと同じく、CLI に渡す引数は 1 つの関数に集めました。

<<< @/examples/20-shipping/src/cdk-args.ts{invocation}

`--no-rollback`、`--hotswap`、`--express` は、どこにも出てきません。どれもデプロイが速くなるかわりに、失敗したときに CloudFormation が元に戻さなくなるオプションです。この関数がこれらを自分からは足さないことを、テストで固定しています。

## 環境ごとにスタックを分ける

<!-- section: 20.stages -->

dev と prod は、1 つのスタックを切り替えて使うのではなく、別々のスタックにします。

<<< @/examples/20-shipping/infra/lib/config.ts{stage}

`-c stage=prod` を付けると `AihShipApiProd` が、`-c stage=pr-12` を付けると `AihShipApiPr12` が作られます。何も付けなければ、dev の `AihShipApi` です。指定を忘れたときに当たるのが本番ではなく dev になるように、既定を決めてあります。知らないステージの名前を渡すと、synth の時点で止まります。

<<< @/examples/20-shipping/infra/bin/app.ts{app}

本番だけ変えている設定は 2 つあります。

<<< @/examples/20-shipping/infra/lib/ship-api-stack.ts{protection}

1 つは削除保護で、解除するまでスタックの削除を拒否します。もう 1 つはロググループで、本番ではスタックを消してもロググループを残します。練習用とプレビューのスタックは、消せば何も残りません。

ステージによらず同じにしている設定もあります。どのスタックの API も、誰でも呼べる URL を 1 つ持つので、04章と同じスロットリングを、dev にも prod にもプレビューにも付けています。

<<< @/examples/20-shipping/infra/lib/ship-api-stack.ts{throttle}

名前で分けるやり方には限界があります。スタックを分けても、同じアカウントの中にあるかぎり、スタックの間に権限の壁はありません。bootstrap の節で見たとおり、deploy role はどのスタックでも更新でき、cfn-exec role は管理者の権限を持っています。したがって、プレビューをデプロイできるジョブは、権限のうえでは prod も壊せます。確実に分けるには、アカウントを分けます。この本は 1 つのアカウントで通しているので、そこまでは実装していません。
