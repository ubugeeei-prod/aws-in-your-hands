---
title: "02 Toolchain: 費用、注意点、片付け"
---

# 02 Toolchain: 費用、注意点、片付け

## お金の話

この章が作るのは、空の S3 bucket と、cdkd の保存場所です。

使っていないときにかかるのは、S3 の保存量に対する料金です。bucket が空なら 0。cdkd の state と template は小さな JSON ファイルです（大きさは計測していません）。

操作したときは、S3 のリクエスト料金がかかります。デプロイ 1 回あたりのリクエスト数は計測していません。

stack を消したあとも、cdkd の 3 つの保存場所は残ります（次の節で片付けます）。

東京リージョンの S3 Standard の保存料金は、最初の 50 TB まで 1 GB あたり月 USD 0.025 です（AWS Price List、確認日 2026-10-11）。単価の一覧は[料金の計算](/ja/reference/pricing.md)にあります。

## 片付け

<!-- section: 02.cleanup -->

```bash
vp run hello:infra:destroy
```

cdkd が確認を求めてきます。練習用の bucket は空なので、そのまま消えます。

stack を消しても、bootstrap で作った 3 つは残ります。この本の続きを読むなら、残しておいてください。03章以降も使います。

全部終えて消すときは、コンソールで次の順にやります。この手順に対応するタスクは用意していません。state の bucket には、あなたが cdkd で作ったすべての stack の記録が入っているので、機械的に消す対象にしたくないんです。

1. `vp run hello:infra:destroy` などで、cdkd で作った stack をすべて消す
2. S3 の画面で `cdkd-assets-...` を空にして削除する
3. S3 の画面で `cdkd-state-...` を空にして削除する。versioning が有効なので、「空にする」で全 version を消す
4. ECR の画面で `cdkd-container-assets-...` を削除する

stack が残っているのに state の bucket を消すと、cdkd はその stack を消せなくなります。

## ハマりどころ

| こうなったら | ここを見る |
| --- | --- |
| `nix develop` が flakes を知らないと言う | Nix の設定で `nix-command` と `flakes` が有効ですか |
| `vp run` が `Task "..." not found` と言う | リポジトリのルートで実行していますか |
| synth が設定の誤りで止まる | メッセージに項目名が出ます。`-c` の値を見直す |
| デプロイが state の bucket が無いと言って止まる | `vp run infra:bootstrap` は済んでいますか。リージョンは合っていますか |
| デプロイが権限エラーで止まる | cdkd はあなたの認証情報で直接作ります。01章の identity に必要な権限がありますか |
| 別のリージョンに作られた | この本のタスクを通さず cdkd を直接実行すると、`AWS_REGION` が無い場合に `us-east-1` になります |

## 本番にするなら

- 反映の経路を AWS CDK CLI と CloudFormation にする。cdkd 自身がそう勧めています。同じ CDK のコードをそのまま使えます
- データを持つリソースは `RemovalPolicy.RETAIN` にする。サンプルの `prod` がその例です
- 人の認証情報でデプロイしない。CI から、期限の短い認証情報で実行します（[20章](/ja/chapters/20-shipping.md)）
- drift の検出を定期的に実行する。例を `docs/examples/drift-schedule.yml` に置いています

::: details この章の検証メモ

**手元で確かめたこと。** 環境（`nix develop`、`vp install --frozen-lockfile`）、synth、ユニットテスト、drift の gate のテスト。いずれも macOS（Apple silicon）です。

**まだ確かめていないこと。** `infra:bootstrap`、`hello:infra:diff`、`hello:infra:deploy`、`hello:infra:drift`、解消の各タスク、`hello:infra:destroy` は、実際の AWS アカウントでは実行していません。cdkd の挙動についての記述は、固定した版のソース、ヘルプ出力、公式ドキュメントに基づきます。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 環境に入る | `flake.nix`、`flake.lock`、`nix/vp.nix`、`nix/vp-home.json` | （`nix develop`） |
| 依存を入れる | `package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml` | （`vp install`） |
| コマンドは全部 `vp run` | `vite.config.ts` | `check:all` |
| 型が守るもの、守らないもの | `examples/02-toolchain/lib/config.ts`、`examples/02-toolchain/test/config.test.ts` | `test:unit` |
| construct、stack、app | `examples/02-toolchain/lib/hello-stack.ts`、`examples/02-toolchain/bin/app.ts` | `hello:infra:synth` |
| synth | `examples/02-toolchain/cdk.json`、`examples/02-toolchain/test/hello-stack.test.ts` | `hello:infra:synth`、`hello:infra:synth:cdk`、`test:unit` |
| cdkd | `tools/src/infra/cdkd-args.ts`、`tools/src/infra/cdkd.ts`、`tools/src/infra/run-cdkd.ts` | `infra:bootstrap` |
| デプロイする | 同上 | `hello:infra:diff`、`hello:infra:deploy` |
| drift を見つける | `tools/src/drift/schema.ts`、`tools/src/drift/report.ts`、`tools/src/drift/cli.ts`、`tools/src/drift/fixtures/`、`tools/src/drift/report.test.ts` | `hello:infra:drift`、`hello:infra:drift:revert:preview`、`hello:infra:drift:revert`、`hello:infra:drift:accept` |
| 片付け | 同上 | `hello:infra:destroy` |

**一次情報**

- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)（npm の tarball と同じ版のソース。確認日 2026-10-11）
- [cdkd: Introduction](https://cdkd.dev/introduction/)（確認日 2026-10-11）
- [vite-plus 1.1.0](https://www.npmjs.com/package/vite-plus/v/1.1.0)（同梱ドキュメントと手元での実行。確認日 2026-10-11）
- [nixpkgs（flake.lock の revision）](https://github.com/NixOS/nixpkgs/tree/8edc0c72e3a38faf5434e40d1f19431125fe4b30)（確認日 2026-10-11）
- [AWS CDK bootstrapping](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html)、[cdk diff](https://docs.aws.amazon.com/cdk/v2/guide/ref-cli-cmd-diff.html)、[CloudFormation drift detection](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-stack-drift.html)（執筆時に未再確認）

:::
