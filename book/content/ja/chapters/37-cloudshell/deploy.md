---
title: "37 CloudShell と Cloud9: デプロイ"
---

# 37 CloudShell と Cloud9: デプロイ

この章は、AWS に何もデプロイしません。運ぶのは 1 つのファイルで、行き先は CloudShell のホームディレクトリです。このページの手順は、実際の CloudShell ではまだ実行していません。

## CloudShell に持っていって動かす

<!-- section: 37.run -->

まず、手元でファイルを作ります。

```bash
vp run cloudshell:build
```

```text
dist/aih-cloudshell.mjs: 29578 bytes, sha256 0e3cb632e0266585191ee8f2cfd90a2d2688a3e4ff19e33054cac90cd2d561d7
```

この出力は、2026 年 10 月 13 日に手元でビルドしたときのものです。ソースを変えれば、大きさもハッシュも変わります。ファイルは 30 KB ほどのテキストなので、持っていく前に開いて読めます。

次に、コンソールにサインインして CloudShell を開きます。コンソールのリージョンは東京にしておきます。CloudShell のページで Actions から Upload file を選び、`dist/aih-cloudshell.mjs` をアップロードします。ファイルはホームディレクトリに置かれます。ホームディレクトリは残るので、アップロードは一度で済みます。ただし、残るのはそのリージョンの環境だけです。

アップロードできたら、最初に Node.js の版を見ます。

```bash
node --version
```

18 より古ければ、このスクリプトは動かず、その旨を表示して終わります。CloudShell の Node.js の版はドキュメントに書かれていないので、ここで何が表示されるかは確かめられていません。

読むだけのコマンドから始めます。

```bash
node aih-cloudshell.mjs whoami
node aih-cloudshell.mjs budget
node aih-cloudshell.mjs left
```

`whoami` の `account` が、自分の学習用のアカウントであることを確かめてください。コンソールで別のアカウントに切り替えていれば、ここに別の ID が出ます。

`left` が、消したはずのスタックを表示したら、消し忘れです。destroy は手元で実行します。cdkd が CloudShell に無いからです。その場でリソースを `aws` コマンドで直接消すこともできますが、そうすると cdkd の state と実物が食い違い、あとで手元の destroy が途中で止まるかもしれません。急いで止めたいものが無いかぎり、手元に戻ってから `vp run <名前>:infra:destroy` を実行するほうが安全です。

バケットを空にするときは、まず `--yes` を付けずに数を見ます。

```bash
node aih-cloudshell.mjs empty <バケット名>
node aih-cloudshell.mjs empty <バケット名> --yes --account <12 桁のアカウント ID>
```

2 行目は AWS を変更します。消したバージョンは戻せません。バケットの名前は、`left` の出力の `bucket:` の行にあります。途中でセッションが切れたら、同じコマンドをもう一度実行します。

使い終わっても、ファイルはホームディレクトリに残ります。消すなら `rm aih-cloudshell.mjs` です。

## スクリプトなしで使えるコマンド

<!-- section: 37.commands -->

AWS CLI が入っているので、これまでの章に出てきた `aws` のコマンドは、そのまま打てます。よく使いそうなものを挙げます。どれも、リージョンを明示しています。

```bash
aws sts get-caller-identity
aws iam get-account-summary --query 'SummaryMap.AccountMFAEnabled'
aws logs tail <ロググループ名> --since 30m --region ap-northeast-1
aws s3 ls --region ap-northeast-1
```

1 行目と 2 行目は 01章のコマンドです。3 行目の `aws logs tail` は、ロググループのログを時間をさかのぼって表示します。`--since 30m` で過去 30 分、`--follow` を付けると新しいログを待ち続けます。ただし、`--follow` で待っている間も、CloudShell は操作の無い時間を数えています。画面に触らなければ、20〜30 分でセッションごと切れます。

`--format short` を付けると、時刻を短くして 1 行を読みやすくできます。ロググループの名前は、手元のスタックの出力か、コンソールの CloudWatch の画面で確かめます。

23章のインスタンスには、CloudShell からは Session Manager で入れません。Session Manager のセッションを始めるには、AWS CLI のほかに Session Manager プラグインが要りますが、CloudShell に入っているものの一覧に、このプラグインはありません。入れられるかどうかは試していません。ブラウザだけでインスタンスに入りたいときは、コンソールの Systems Manager の画面からセッションを始めるほうが確実です。
