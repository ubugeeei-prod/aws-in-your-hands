---
title: "45 Infrastructure Composer: 費用、注意点、片付け"
---

# 45 Infrastructure Composer: 費用、注意点、片付け

章の最後のページです。料金、つまずきやすい点、片付け、検証メモの順に進みます。

## 料金

<!-- section: 45.cost -->

Infrastructure Composer に追加の料金はありません。FAQ には、Infrastructure Composer の利用には課金せず、それを使って作ったリソースに通常の料金がかかる、と書かれています（確認日 2026-10-13）。AWS Toolkit for Visual Studio Code の中で図を見るだけなら、リソースは作られません。図を表示するのに AWS の認証情報が要るかどうかは、ガイドには書かれていませんでした。

template studio は、保存したときに料金が発生します。保存先は S3 のバケットで、ガイドは、置いたテンプレートに S3 の通常の料金がかかると書いています。既定の保存先のバケットは、無ければそのときに作られます。テンプレートは小さなファイルで、20章の 2 つのテンプレートは手元で測ると 10,955 バイトと 12,782 バイトでしたが、読むだけなら保存する必要はありません。金額の計算はしていません。

この章のコードは、手元のファイルを読むだけです。AWS には何も作らず、料金のシナリオもありません。

## つまずきやすいところ

| 症状 | 確かめること |
| --- | --- |
| `no *.template.json here` と出る | その章の synth をまだ実行していない。`cdk.out` は git の管理の外にある |
| `name one of: ...` と出る | `cdk.out` にスタックが 2 つ以上ある。スタックの名前を 2 つ目の引数で渡す |
| `cannot read ... as a template` と出る | `Resources` に `Type` の無い項目がある。`Fn::ForEach` を使ったテンプレートか、テンプレートではない JSON |
| `names that are not in the template` に名前が出る | 参照の先が、リソースにもパラメーターにも無い。打ち間違いか、消したリソースへの参照が残っている |
| つながっているはずのリソースが離れている | ARN を文字列で直接書いている。参照になっていないので、作る順番も保証されない |
| 図で見た数と、テンプレートのリソースの数が合わない | template studio は、共有されているリソースを使う側ごとに表示することがある。数はテンプレートで数える |
| 図の道具で保存したら、次のデプロイで設定が消えた | CDK のコードが正本で、保存したテンプレートは反映されない。変更はコードに書く |

## 片付け

<!-- section: 45.cleanup -->

この章が AWS に作るものはありません。手元にも、タスクが書き出すファイルはありません。`composer:graph:hello` と `composer:graph:ship` は、先に 02章と 20章の synth を実行するので、それぞれの `cdk.out` が作り直されます。どちらも git の管理の外です。

図の道具を試して、テンプレートを手元や S3 に保存したなら、それを消します。CDK で管理しているスタックのテンプレートが、リポジトリの中にもう 1 つ残っている状態を作らないためです。template studio が保存先に使うバケットは、CloudFormation がテンプレートのアップロードに使うものと同じなので、バケットごと消す必要はありません。

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト（たどる 4 つの形と、たどらない形。`Fn::Sub` の属性、リテラル、対応表の変数。パラメーターと擬似パラメーターの扱い。テンプレートに無い名前の報告。省いた種類の扱い。`Type` の無い項目と `Fn::ForEach` を断ること。種類ごとの数、参照されないリソース、つながりの無いリソース、いちばん長い鎖、輪の検出。2 つのテンプレートの比較で見える 5 つの編集と、見えない 1 つ。文字と図の出力。`cdk.out` からテンプレートを選ぶ判断）。型検査。`composer:graph`、`composer:graph:hello`、`composer:graph:ship`。本文に載せた出力は、2026 年 10 月 13 日に手元で実行したときのものです。使った Node.js は 24.21.0 です。

同じ日に、リポジトリにあった 50 個の `cdk.out` のテンプレートをすべて読ませました。読み込みに失敗したもの、テンプレートに無い名前、輪は、どれにもありませんでした。ほかの章が書きかけの時点での結果なので、数は変わります。

**まだ確かめていないこと。** AWS に対しては、何も実行していません。Infrastructure Composer も template studio も開いていないので、次のことは確かめられていません。このモジュールのグラフが、template studio の図と同じ線になること。VS Code の Infrastructure Composer が `cdk.out` の JSON のテンプレートを開けること。CDK が合成したテンプレートのどのリソースが enhanced component card になるか。開いて保存しただけのテンプレートが、元とどう違うか。template studio に手元のファイルを読み込む手順。

一次情報で確かめられなかったこと。Infrastructure Composer が、グループやカードの位置をテンプレートのどこに書くか（グループのページには書かれていません）。VS Code で図を表示するのに AWS の認証情報が要るかどうか。輪のあるテンプレートを CloudFormation がどう扱うか（トラブルシューティングのページには記述がありませんでした）。新しい利用者の受付を閉じる 2026 年 10 月 29 日は、ページ自身が目標と書いている日付です。template studio のページには Infrastructure Composer の名前が出てこないので、template studio が告知の言う「置き換えたエディタ」だというのは、以前の Infrastructure Composer のページの URL が template studio のページを返すことからの判断です。

**確かめる手順。** VS Code に AWS Toolkit を入れ、`vp run hello:infra:synth` のあとで `examples/02-toolchain/cdk.out/AihHello.template.json` を開き、エディタ右上の Infrastructure Composer のボタンを押します。図が出たら、線が `NotesPolicy` から `Notes` への 1 本であることを `vp run composer:graph:hello` の出力と比べます。次に、ファイルを別の名前で複製して図から何も変えずに保存し、`vp run composer:graph ../02-toolchain AihHello --against <複製>` と `diff` で元と比べます。

**使わなかったもの。** CDK のスタック（作るリソースが無いため）。Infrastructure Composer の単独のコンソールと local sync（2026 年 12 月 7 日に終わるため）。YAML の読み込み（`cdk.out` が JSON のため。依存を増やしていません）。33章の点検のコード（同時に書かれている章なので、依存していません）。Cloudflare と Vercel との比較（テンプレートに当たるものが無く、比べる対象を一次情報で確かめていないため、書いていません）。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| テンプレートをグラフとして読む | `examples/45-infrastructure-composer/src/template.ts`、`src/graph.ts`、`test/graph.test.ts` | `test:unit` |
| 要約 | `examples/45-infrastructure-composer/src/summary.ts`、`test/summary.test.ts` | `test:unit` |
| 文字と図にする | `examples/45-infrastructure-composer/src/render.ts`、`fixtures/notes-api.template.json`、`test/render.test.ts` | `composer:graph`、`test:unit` |
| 自分のスタックを読む | `examples/45-infrastructure-composer/scripts/graph.ts`、`src/cdk-out.ts`、`test/cdk-out.test.ts` | `composer:graph`、`composer:graph:hello`、`composer:graph:ship` |
| 2 つのテンプレートを比べる | `examples/45-infrastructure-composer/src/diff.ts`、`test/diff.test.ts` | `composer:graph`、`test:unit` |

**一次情報**（確認日はすべて 2026-10-13）

- Infrastructure Composer のデベロッパーガイド: [What is AWS Infrastructure Composer?](https://docs.aws.amazon.com/infrastructure-composer/latest/dg/what-is-composer.html)、[End of support](https://docs.aws.amazon.com/infrastructure-composer/latest/dg/infrastructure-composer-end-of-support.html)、[Document history](https://docs.aws.amazon.com/infrastructure-composer/latest/dg/doc-history.html)、[CloudFormation console mode](https://docs.aws.amazon.com/infrastructure-composer/latest/dg/using-composer-console-cfn-mode.html)、[Configure and modify cards](https://docs.aws.amazon.com/infrastructure-composer/latest/dg/using-composer-cards.html)、[Standard cards](https://docs.aws.amazon.com/infrastructure-composer/latest/dg/using-composer-standard-cards.html)、[Card connections](https://docs.aws.amazon.com/infrastructure-composer/latest/dg/using-composer-connecting.html)、[Group cards](https://docs.aws.amazon.com/infrastructure-composer/latest/dg/reference-navigation-gestures-group.html)、[Local sync](https://docs.aws.amazon.com/infrastructure-composer/latest/dg/using-composer-project-local-sync.html)、[File System Access API](https://docs.aws.amazon.com/infrastructure-composer/latest/dg/reference-fsa.html)、[External files](https://docs.aws.amazon.com/infrastructure-composer/latest/dg/using-composer-external-files.html)、[Change Inspector](https://docs.aws.amazon.com/infrastructure-composer/latest/dg/using-change-inspector.html)、[From the AWS Toolkit for Visual Studio Code](https://docs.aws.amazon.com/infrastructure-composer/latest/dg/using-composer-ide.html)、[Visual overview (VS Code)](https://docs.aws.amazon.com/infrastructure-composer/latest/dg/using-composer-ide-visual.html)、[Access from the Toolkit](https://docs.aws.amazon.com/infrastructure-composer/latest/dg/setting-up-composer-access-ide.html)
- Infrastructure Composer のそのほか: [製品ページ](https://aws.amazon.com/infrastructure-composer/)、[FAQs](https://aws.amazon.com/infrastructure-composer/faqs/)、[AWS Application Composer is now AWS Infrastructure Composer](https://aws.amazon.com/about-aws/whats-new/2024/10/aws-application-composer-infrastructure-composer/)、[Working with AWS Infrastructure Composer in the Toolkit](https://docs.aws.amazon.com/toolkit-for-vscode/latest/userguide/appcomposer-overview.html)
- CloudFormation: [Edit templates visually with template studio](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/template-studio.html)、[Ref](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/intrinsic-function-reference-ref.html)、[Fn::GetAtt](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/intrinsic-function-reference-getatt.html)、[Fn::Sub](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/intrinsic-function-reference-sub.html)、[DependsOn attribute](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-attribute-dependson.html)、[Troubleshooting](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/troubleshooting.html)

:::
