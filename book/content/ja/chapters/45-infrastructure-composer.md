---
title: "45 Infrastructure Composer: template を図で読む、図から書く"
revision: 1
---

# 45 Infrastructure Composer: template を図で読む、図から書く

テンプレートは、リソースを点、リソースどうしの参照を線とするグラフです。Infrastructure Composer は、そのグラフを図として表示し、図の側からテンプレートを書き換えられるようにした AWS の道具です。この章では、TypeScript の CDK でスタックを書く読者にとって、図は読むためのもので、書く場所はコードのままにしておく、ということを確かめます。

先に、この道具のいまの状態を書きます。**Infrastructure Composer の単独のコンソールは、2026 年 12 月 7 日に終わります。** 新しい利用者の受付は 2026 年 10 月 29 日に閉じる予定です。残るのは 2 つです。1 つは AWS Toolkit for Visual Studio Code の中の Infrastructure Composer で、これまでと同じキャンバスが使えます。もう 1 つは CloudFormation のコンソールにある template studio で、Infrastructure Composer が埋め込まれていた場所を引き継いだ、別のエディタです。そのため、この章には単独のコンソールの手順を書いていません。

前提は、[02章](/ja/chapters/02-toolchain.md)の synth と `cdk.out`、[20章](/ja/chapters/20-shipping.md)の CloudFormation へのデプロイです。コードは `examples/45-infrastructure-composer/` にあります。CDK のスタックはありません。この章が作るのは、合成されたテンプレートをグラフとして読む小さなモジュールで、AWS には何も作りません。

この章の内容は、2026 年 10 月 13 日に公式ドキュメントを読んで確かめたものです。Infrastructure Composer も template studio も、実際には開いていません。画面について書いた文は、ドキュメントに書かれていることか、「試していません」と断ったことのどちらかです。画面の見た目は説明しません。

## Infrastructure Composer のいま

<!-- section: 45.status -->

この道具は 2022 年 12 月に Application Composer の名前で公開され、2023 年 3 月に一般提供になりました。当初はサーバーレスの構成を組み立てるための道具でしたが、2023 年 9 月に CloudFormation のすべてのリソースを扱えるようになり、2024 年 10 月 4 日に Infrastructure Composer へ名前が変わりました。ドキュメントの URL や、Toolkit のガイドに書かれたメニューの名前には、いまも Application Composer や App Composer が残っています。

使える場所は 3 つありました。Infrastructure Composer 自身のコンソール、CloudFormation のコンソールに埋め込まれた CloudFormation console mode、そして AWS Toolkit for Visual Studio Code です。

デベロッパーガイドの冒頭には、2026 年 9 月 29 日に次の告知が加わりました。

```text
End of support notice: On December 7, 2026, the standalone AWS Infrastructure
Composer console will no longer be available. We have replaced Infrastructure
Composer with an improved visual IaC editor on the AWS console pages where it
was previously embedded. The full Infrastructure Composer experience remains
available via the AWS Toolkit for Visual Studio Code.
```

告知のリンク先のページから、読者に関係することを拾うと、次のとおりです。

- 単独のコンソール（`console.aws.amazon.com/composer`）は、2026 年 12 月 7 日を過ぎると開けません。新しい利用者は 2026 年 10 月 29 日から受け付けない予定で、ページはこの日付を目標と書いています
- AWS Toolkit for Visual Studio Code の中の Infrastructure Composer は残ります。変更の予定はない、と書かれています
- CloudFormation のコンソールに埋め込まれていたものは、コンソールに組み込まれた別のエディタに置き換わります。Lambda と Step Functions のコンソールにあった Infrastructure Composer への書き出しは無くなります
- 手元や S3 に保存したテンプレートと、すでにあるスタックには影響しません。Infrastructure Composer には、利用者が呼ぶ API も SDK も CLI もありません

CloudFormation のコンソールで置き換わったエディタは、CloudFormation のユーザーガイドでは template studio と呼ばれています。以前は Infrastructure Composer の説明があったページが、いまは template studio の説明になっています。

したがって、これから AWS を始める読者が使えるのは、VS Code の中の Infrastructure Composer と、コンソールの template studio です。この 2 つは似ていますが、図から編集できるかどうかが違います。次の節でその違いを見ます。

## 図が表しているもの

<!-- section: 45.canvas -->

Infrastructure Composer の図は、カードと線でできています。カードがリソースで、線がリソースどうしのつながりです。

カードには 2 種類あります。standard IaC resource card は CloudFormation のリソース 1 つを表し、すべてのリソースの種類に用意されています。enhanced component card は、よく一緒に使うリソースをいくつかまとめて 1 枚にしたもので、設定のためのフォームが付いています。

線の意味も、カードの種類で違います。

- enhanced component card どうしは、カードにあるポートからポートへ線を引いてつなぎます。線は実線です。線を引くと、Infrastructure Composer は必要に応じて、IAM のポリシー、環境変数、イベントの設定をテンプレートに書き足します。ポリシーには SAM の policy template が使われます
- standard IaC resource card にはポートがありません。つながりはテンプレートの側に書き、Infrastructure Composer がそれを見つけて点線で表示します

つまり、実線は「図で引いたら、テンプレートに権限と設定が増えた」ことを表し、点線は「テンプレートに書いてあった参照を、図にした」ことを表します。CDK が合成したテンプレートを開いた場合、線はテンプレートから読み取られたものになるはずです。どのリソースが enhanced component card として表示されるかは、ドキュメントからは確かめられませんでした。

グループも同じように 2 通りあります。enhanced component card は手でまとめます。standard の側は、参照から決まります。ドキュメントの例では、Lambda の関数がロールを参照していると、ロールのカードが関数のカードの中に入ります。

template studio の図は、もっと単純です。ユーザーガイドには、あるリソースが別のリソースを `Ref`、`Fn::GetAtt`、`Fn::Sub`、`DependsOn` のどれかで参照していれば線を引く、と書かれています。どこからも参照されないリソースは離れて表示されるので、つなぎ忘れに気づきやすい、ともあります。そして、図からは編集できません。ガイドは、テンプレートの文字が正本で、図はその表示にすぎない、と明記しています。

図を読むときの注意も、同じガイドにあります。3 つの関数が同じロールを使っていると、図ではロールがそれぞれの関数の中に表示されますが、テンプレートにあるロールは 1 つです。リソースがいくつあるかは、図ではなくテンプレートで数えます。

## 読むものと書くもの

<!-- section: 45.files -->

どちらの道具も、読み書きするのは CloudFormation と SAM のテンプレートです。CDK のコードは読みません。

VS Code の Infrastructure Composer は、開いているテンプレートのファイルを相手にします。Toolkit のガイドによると、キャンバスでの変更は保存され、エディタでファイルを直接編集する作業と行き来できます。開き方は 3 つで、テンプレートを開いたエディタの右上にあるボタン、ファイルを右クリックしたメニュー、コマンドパレットです。デプロイのためのボタンもありますが、中身は SAM CLI の `sam sync` で、この本の経路ではありません。

単独のコンソールには、手元のフォルダと同期する local sync という機能がありました。ブラウザの File System Access API を使うので、Chrome か Edge が必要です。単独のコンソールと一緒に終わる機能なので、これ以上は説明しません。

template studio は、保存の相手が S3 です。編集は自動では保存されず、保存を選ぶと、CloudFormation がテンプレートの置き場所として管理しているバケットか、自分で指定したバケットに書き込みます。ほかに、次のことがガイドに書かれています。

- YAML と JSON を変換できます。YAML から JSON に変換すると、コメントは消えて戻りません
- 検証は `ValidateTemplate` を呼びます。テンプレートを本文として送るので、51,200 バイトを超える下書きは検証できません
- 図は PNG で保存できます
- 開く入口は、ナビゲーションの Template studio、スタックを作る画面、すでにあるスタックの更新、そのほかテンプレートが表示される画面です

自分で作っていないテンプレートを開いたときに、道具がテンプレートをどう変えるかは、読者がいちばん知りたい点でしょう。template studio については、編集と変換をしないかぎり何も変えない、と読めます。Infrastructure Composer については、取り込んだテンプレートを編集できる図にする、としか書かれていません。開いて保存しただけで、書式が変わるのか、図のための情報がテンプレートに足されるのかは、読んだページからは確かめられませんでした。VS Code で JSON のテンプレートを開けるかどうかも、ガイドには書かれていません。`cdk.out` のテンプレートは JSON です。

## CDK を書く人にとっての使い道

<!-- section: 45.cdk -->

この本のスタックは、TypeScript のコードから合成されます。テンプレートは `cdk.out` に出てくる生成物で、git の管理からも外してあります。

```figure
caption: 図は合成されたテンプレートを読むために使います。図から保存したテンプレートは、コードとは別の 2 つ目の正本になります。
node code: CDK のコード | TypeScript
node template: テンプレート | cdk.out
node stack: スタック
node diagram: 図
node saved: 保存したテンプレート
edge code -> template: synth
edge template -> stack: deploy
edge template -> diagram: 開いて読む
edge diagram --> saved: 図から編集
edge saved -x stack: deploy
mark diagram
```

この流れの中で、図が役に立つ場面は 2 つあります。

1 つは、レビューの前に、合成されたテンプレートを図で眺めることです。CDK のコンストラクトは、1 行から何個ものリソースを作ります。04章のスタックのコードが作るコンストラクトは、ロググループ、ロール、関数、API の 4 つで、あとはルートを 3 回足しているだけです。それでも、合成されたテンプレートには 17 個のリソースがあります。どのリソースがどれを参照しているかを、JSON を上から読んで追うのは骨が折れます。図にすれば、つながっていないリソースや、思っていなかった参照が目に入ります。

もう 1 つは、書く前の下書きです。まだコードが無い段階で、キャンバスにカードを置いて構成を考え、できあがったテンプレートを見て、CDK で書くときの手がかりにします。この使い方では、できあがったテンプレートは捨てます。

図から書いたテンプレートを捨てなければならない理由が、この章の不変条件です。**1 つのスタックの正本は 1 つ。** 図で線を 1 本引いて保存すると、テンプレートには IAM のポリシーが増えますが、CDK のコードは何も知りません。次に synth すれば、コードから作られたテンプレートにそのポリシーは無く、デプロイすればポリシーは消えます。逆に、保存したテンプレートのほうをデプロイすれば、コードが実物と食い違います。どちらが正しいかを、あとから決める方法はありません。

02章と 20章で扱ったドリフトは、テンプレートと実物の食い違いでした。ここで起きるのは、その手前の、テンプレートが 2 つあるという食い違いです。次のページの終わりで、2 つのテンプレートをグラフとして比べ、食い違いを見つけるコードを書きます。

この本の読者には、もう 1 つ制約があります。template studio は、すでにあるスタックのテンプレートを開けますが、開けるのは CloudFormation が持っているスタックです。cdkd が作ったスタックは CloudFormation の中に無いので、一覧に出てきません。この本で当てはまるのは、20章で AWS CDK CLI からデプロイしたスタックだけです。ほかの章のテンプレートは、`cdk.out` のファイルを自分で開くことになります。template studio に手元のファイルを読み込む手順は、ガイドには書かれていませんでした。新しいテンプレートとして開いたエディタに貼り付ければ読めるはずですが、試していません。

そこでこの章では、同じ読み方を手元でできるようにします。`cdk.out` のテンプレートを読み、template studio と同じ 4 つの形の参照をたどって、グラフを文字で表示する小さなモジュールです。これは Infrastructure Composer ではなく、その代わりにもなりません。キャンバスもカードもありません。あるのは、レビューの前に `vp run` で実行できる、点と線の一覧です。

## 使わないほうがよい場合

<!-- section: 45.when-not -->

CDK でスタックを書いていて、テンプレートを自分で読めるなら、図の道具が無くても困りません。各章の `infra:diff` のタスクは、変更がテンプレートのどこに現れるかを表示します。図が教えてくれるのは全体の形で、差分ではありません。

次の使い方は、避けたほうがよいでしょう。

- 図から編集したテンプレートを、CDK で管理しているスタックにデプロイすること。前の節の不変条件を壊します
- 図を設計書として保存しておくこと。図はテンプレートから作り直せるもので、保存した画像は、次の変更で古くなります
- 単独のコンソールの local sync を前提にした作業の流れを、これから作ること。2026 年 12 月 7 日に使えなくなります
- 図でリソースを数えること。template studio のガイドにあるとおり、同じロールが何度も表示されることがあります

テンプレートを手で書いている場合は、話が変わります。SAM や CloudFormation の YAML が正本なら、VS Code の Infrastructure Composer は、その正本を直接編集する道具になり、不変条件は壊れません。この本はその書き方をしませんが、そうしたリポジトリを引き継いだときには、まず図で開いてみる価値があります。
