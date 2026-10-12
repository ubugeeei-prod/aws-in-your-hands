---
title: "02 Toolchain: 費用、注意点、片付け"
---

# 02 Toolchain: 費用、注意点、片付け

この章の締めくくりとして、作ったものにかかる料金、片付け方、つまずきやすいところをまとめます。

## 料金

この章が作るのは、空の S3 バケットと、cdkd の保存場所です。

使っていないときにかかるのは、S3 に保存している量に対する料金です。バケットが空なら 0 です。cdkd の state とテンプレートは小さな JSON ファイルですが、大きさは計測していません。

操作したときには、S3 のリクエスト料金がかかります。デプロイ 1 回あたりのリクエスト数は計測していません。

スタックを消したあとも、cdkd の 3 つの保存場所は残ります。片付け方は次の節に書きます。

東京リージョンの S3 Standard の保存料金は、最初の 50 TB まで 1 GB あたり月 USD 0.025 です（AWS Price List、確認日 2026-10-11）。単価の一覧は[料金の計算](/ja/reference/pricing.md)にあります。

## 片付け

<!-- section: 02.cleanup -->

```bash
vp run hello:infra:destroy
```

実行すると cdkd が確認を求めます。練習用のバケットは空なので、そのまま消えます。

スタックを消しても、bootstrap で作った 3 つは残ります。03章以降でも使うので、この本を読み進めるなら残しておいてください。

本を読み終えて bootstrap の 3 つも消すときは、コンソールで次の順に作業します。この手順に対応するタスクは用意していません。state のバケットには cdkd で作ったすべてのスタックの記録が入っているので、機械的に消す対象にしたくないからです。

1. `vp run hello:infra:destroy` などで、cdkd で作ったスタックをすべて消す
2. S3 の画面で `cdkd-assets-...` を空にして削除する
3. S3 の画面で `cdkd-state-...` を空にして削除する。バージョニングが有効なので、「空にする」ですべてのバージョンを消す
4. ECR の画面で `cdkd-container-assets-...` を削除する

スタックが残っているのに state のバケットを消すと、cdkd はそのスタックを消せなくなります。

## つまずきやすいところ

| 症状 | 確かめること |
| --- | --- |
| `nix develop` が flakes を知らないと言う | Nix の設定で `nix-command` と `flakes` が有効になっているか |
| `vp run` が `Task "..." not found` と言う | リポジトリのルートで実行しているか |
| synth が設定の誤りで止まる | メッセージに項目名が出るので、`-c` の値を見直す |
| デプロイが、state のバケットが無いと言って止まる | `vp run infra:bootstrap` を済ませたか。リージョンは合っているか |
| デプロイが権限エラーで止まる | cdkd は自分の認証情報で直接リソースを作る。01章で用意した identity に必要な権限があるか |
| 別のリージョンに作られた | この本のタスクを通さずに cdkd を直接実行すると、`AWS_REGION` が無い場合に `us-east-1` になる |

## 本番にするなら

- 反映の経路を AWS CDK CLI と CloudFormation にする。cdkd 自身がそう勧めています。同じ CDK のコードをそのまま使えます
- データを持つリソースは `RemovalPolicy.RETAIN` にする。サンプルの `prod` がその例です
- 人の認証情報でデプロイしない。CI から、期限の短い認証情報で実行します（[20章](/ja/chapters/20-shipping.md)）
- ドリフトの検出を定期的に実行する。例を `docs/examples/drift-schedule.yml` に置いています

::: details この章の検証メモ

**手元で確かめたこと。** 環境（`nix develop`、`vp install --frozen-lockfile`）、synth、ユニットテスト、ドリフトの判定のテスト。いずれも macOS（Apple silicon）です。

**まだ確かめていないこと。** `infra:bootstrap`、`hello:infra:diff`、`hello:infra:deploy`、`hello:infra:drift`、解消の各タスク、`hello:infra:destroy` は、実際の AWS アカウントでは実行していません。cdkd の挙動についての記述は、固定した版のソース、ヘルプ出力、公式ドキュメントに基づきます。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 環境に入る | `flake.nix`、`flake.lock`、`nix/vp.nix`、`nix/vp-home.json` | （`nix develop`） |
| 依存を入れる | `package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml` | （`vp install`） |
| コマンドはすべて `vp run` | `vite.config.ts` | `check:all` |
| 型が守るもの、守らないもの | `examples/02-toolchain/lib/config.ts`、`examples/02-toolchain/test/config.test.ts` | `test:unit` |
| コンストラクト、スタック、アプリ | `examples/02-toolchain/lib/hello-stack.ts`、`examples/02-toolchain/bin/app.ts` | `hello:infra:synth` |
| synth | `examples/02-toolchain/cdk.json`、`examples/02-toolchain/test/hello-stack.test.ts` | `hello:infra:synth`、`hello:infra:synth:cdk`、`test:unit` |
| cdkd | `tools/src/infra/cdkd-args.ts`、`tools/src/infra/cdkd.ts`、`tools/src/infra/run-cdkd.ts` | `infra:bootstrap` |
| デプロイする | 同上 | `hello:infra:diff`、`hello:infra:deploy` |
| ドリフトを見つける | `tools/src/drift/schema.ts`、`tools/src/drift/report.ts`、`tools/src/drift/cli.ts`、`tools/src/drift/fixtures/`、`tools/src/drift/report.test.ts` | `hello:infra:drift`、`hello:infra:drift:revert:preview`、`hello:infra:drift:revert`、`hello:infra:drift:accept` |
| 片付け | 同上 | `hello:infra:destroy` |

**一次情報**

- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)（npm の tarball と同じ版のソース。確認日 2026-10-11）
- [cdkd: Introduction](https://cdkd.dev/introduction/)（確認日 2026-10-11）
- [vite-plus 1.1.0](https://www.npmjs.com/package/vite-plus/v/1.1.0)（同梱ドキュメントと手元での実行。確認日 2026-10-11）
- [nixpkgs（flake.lock の revision）](https://github.com/NixOS/nixpkgs/tree/8edc0c72e3a38faf5434e40d1f19431125fe4b30)（確認日 2026-10-11）
- [AWS CDK bootstrapping](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html)、[cdk diff](https://docs.aws.amazon.com/cdk/v2/guide/ref-cli-cmd-diff.html)、[CloudFormation drift detection](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-stack-drift.html)（執筆時に未再確認）

:::
