---
title: "37 CloudShell と Cloud9: 費用、注意点、片付け"
---

# 37 CloudShell と Cloud9: 費用、注意点、片付け

章の最後のページです。料金、ブラウザの中のエディタが欲しいときの選択肢、Cloudflare や Vercel との違い、つまずきやすい点、片付けの順に進みます。

## 料金

<!-- section: 37.cost -->

CloudShell に追加の料金はありません。料金ページには、CloudShell そのものには課金せず、CloudShell から使ったほかのリソースと、データ転送に通常の料金がかかる、と書かれています（確認日 2026-10-13）。

この章のスクリプトについて言えば、`whoami`、`budget`、`left`、`empty` が呼ぶ AWS の API は、手元から同じコマンドを打ったときと同じように扱われます。この章には、置いてあるだけで料金がかかるものはありません。そのため、料金のシナリオも作っていません。

料金がかからないかわりに、量に上限があります。アカウントの全員を合わせて、リージョンごとに月 200 時間です。上限に達すると、その月はそのリージョンで CloudShell を開けなくなります。Service Quotas から引き上げを申請できます。

VPC の中の環境も、CloudShell としては無料です。ただし、その環境からインターネットへ出るには NAT が要ります。11章で計算したとおり、NAT Gateway は置いてあるだけで月におよそ USD 49 かかります。

Cloud9 を使い続けているアカウントでは、Cloud9 そのものは無料で、EC2 環境のインスタンスとボリュームに料金がかかります。

## ブラウザの中のエディタが欲しいとき

<!-- section: 37.alternatives -->

CloudShell にあるエディタは、`vim`、`nano`、`edit` です。Cloud9 のような、ファイルの一覧とデバッガの付いたエディタではありません。AWS の中で動く環境をエディタから使いたいときの選択肢を、確かめられた範囲で挙げます。どれも、この本では実行していません。

**手元のエディタから、23章のインスタンスにつなぐ。** AWS の勧めにいちばん近いのは、この方法です。エディタは手元に置き、コードの実行だけを AWS の中のマシンに任せます。

23章のインスタンスは、SSH のポートを開けていません。それでも、Session Manager を通して SSH をつなげます。手元の `~/.ssh/config` に、SSH の接続を `aws ssm start-session` に通す設定を書きます。公式ドキュメントにある設定は次のとおりです。

```text
# SSH over Session Manager
Host i-* mi-*
    ProxyCommand sh -c "aws ssm start-session --target %h --document-name AWS-StartSSHSession --parameters 'portNumber=%p'"
    User ec2-user
```

こうしておくと、SSH で遠くのマシンを開けるエディタは、インスタンス ID をホスト名にして接続できます。インスタンスの側では SSH のサーバーが動いていて、自分の公開鍵が登録されている必要があります。23章のスタックは鍵を登録していないので、そのままでは使えません。また、ドキュメントによると、SSH とポートフォワーディングのセッションは、Session Manager のログに中身が残りません。SSH が通信を暗号化していて、Session Manager は通り道になるだけだからです。

VS Code を使っているなら、AWS Toolkit for VS Code に、EC2 のインスタンスへ VS Code をつなぐコマンドがあります。ドキュメントには、Amazon Linux 2023 と Ubuntu 22.04 で動作を確かめたこと、手元に SSH が要ること、インスタンスのロールに `AmazonSSMManagedInstanceCore` に含まれる権限が要ることが書かれています。23章のインスタンスは、この権限をすでに持っています。

開発サーバーをインスタンスで動かして、手元のブラウザで見るだけなら、エディタをつなぐ必要もありません。23章の `vp run ec2:forward` が、手元のポートをインスタンスのポートにつなぎます。

いずれの方法でも、インスタンスは置いてあるだけで課金されます。23章の料金の節を読んでから始めてください。

**AWS が用意している開発環境。** 確認日の時点で、ドキュメントから状態を確かめられたものは次の 3 つです。

| 環境 | 新しい利用者 | 中身 |
| --- | --- | --- |
| Cloud9 | 受け付けていない（2024-07-25 から） | ブラウザの IDE。EC2 か自分のサーバーで動く |
| CodeCatalyst の Dev Environments | 受け付けていない | devfile で道具を決める、クラウドの開発環境 |
| SageMaker Studio の Code Editor | 終了の告知は見当たらない | Code-OSS（VS Code のオープンソース版）をもとにしたエディタ。EC2 のインスタンスと EBS のボリュームを 1 つずつ使う |

Code Editor は、ドキュメントに「分析と機械学習のコードを書くためのもの」とあり、SageMaker Studio の一部です。Web アプリの開発に使う場面は、この本では想定していません。使うにはインスタンスとボリュームの料金がかかります。金額は確かめていません。

結局、いまの AWS で「ブラウザを開けばエディタがある」という Cloud9 の体験を、新しい利用者がそのまま得る方法は、確かめた範囲では見つかりませんでした。エディタは手元に置くのが、AWS 自身の勧めでもあります。

CloudShell には Kiro CLI も入っています。ターミナルの中で、自然言語で質問したり、コマンドを組み立てさせたりする道具です。使うには CloudShell とは別にサインインが要り、動かせるのは、サインインしている identity の権限の範囲に限られます。この本では扱いません。

## Cloudflare や Vercel との違い

<!-- section: 37.compare -->

Cloudflare にも Vercel にも、CloudShell に当たるものは見当たりません。つまり、管理画面の中で開けて、アカウントの認証情報を最初から持っているシェルは、確かめた範囲ではありません（確認日 2026-10-13）。

Cloudflare では、`wrangler` を手元か CI で動かします。`wrangler login` はブラウザを開いて OAuth で認可を受け、トークンを手元の設定ディレクトリに保存します。CI では、`CLOUDFLARE_API_TOKEN` に API トークンを入れます。Workers のダッシュボードから始める手順も読みましたが、そこにあるのは、テンプレートや Git リポジトリからアプリを作ってデプロイする流れで、シェルは出てきません。

Vercel も同じ形です。`vercel` の CLI を手元に入れ、`vercel login` でサインインします。CI では `VERCEL_TOKEN` を使います。

この違いを、AWS のほうが進んでいると読む必要はありません。Cloudflare と Vercel では、ダッシュボードとデプロイの流れが、シェルを開かなくても済むように作られています。Git に push すればデプロイされ、ログも設定も画面にあります。AWS で CloudShell が役に立つのは、コンソールの画面だけでは済まない操作が多く、その操作に CLI と認証情報が要るからです。

Cloudflare か Vercel で足りている読者にとって、CloudShell は移る理由になりません。AWS を使うことになったときに、手元の環境が整うまでのつなぎとして、また手元のマシンが無いときの確認の手段として、覚えておけば十分です。

## つまずきやすいところ

| 症状 | 確かめること |
| --- | --- |
| CloudShell が、権限が無いと言って開かない | 起動に要る 4 つのアクションが許可されているか。明示的な拒否が付いていないか |
| シェルは開くが、`aws` コマンドが認証情報が無いと言う | `cloudshell:PutCredentials` が許可されているか |
| 作ったはずのリソースが見えない | コンソールのリージョン。`AWS_REGION` がそのリージョンになっている。`--region` を付ける |
| 昨日入れたコマンドが無い | `dnf` などで入れたものは、ホームディレクトリの外にあり、セッションが終わると消える |
| ホームディレクトリのファイルが無い | 別のリージョンの環境を開いていないか。120 日使わなかったのではないか。VPC の環境ではないか |
| 貼り付けようとすると確認が出る | Safe Paste という機能。複数行の貼り付けを、実行の前に確認させる。既定で有効 |
| 開かなくなった | `.bashrc` を壊した可能性がある。Actions からホームディレクトリを消すと初期状態に戻るが、中身はすべて消える |
| `Failed to open sessions` が出る | 社内のプロキシが WebSocket を通していない可能性がある |
| その月はもう開けないと言われる | 月 200 時間の上限に達している。Service Quotas で確かめる |

## 片付け

<!-- section: 37.cleanup -->

この章が AWS に作るものはありません。片付けるのは、CloudShell の中のファイルだけです。

```bash
rm aih-cloudshell.mjs
```

CloudShell の環境ごと消したいときは、CloudShell の画面の Actions から、ホームディレクトリの削除を選びます。消したものは戻せません。何もしなくても、そのリージョンで 120 日使わなければ、ホームディレクトリは消えます。

`cloudshell:policy` で出力したポリシーをロールに付けたなら、要らなくなったときに外します。付けたのは読者自身なので、この本のタスクは外しません。

手元の `dist/` は git の管理対象から外してあります。消しても、`vp run cloudshell:build` で作り直せます。

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト（3 つのポリシーが通すアクション、予算の状態の分け方、state のキーとリソースの読み方、料金がかかる種類の表が指す章のサンプルにその種類があること、1,000 個ずつの分け方、メモリ上のバケットを空にする繰り返しと、その途中の拒否・再実行・途中の書き込み・終わらない場合）。ビルドしたファイルを、偽物の `aws` を PATH に置いて実行するテスト。型検査。`cloudshell:build`、`cloudshell:demo`、`cloudshell:policy`。本文に載せた出力は、2026 年 10 月 13 日に手元で実行したときのものです。使った Node.js は 24.21.0、AWS CLI は 2.35.11 で、どちらも devShell のものです。

道具の大きさも手元で測りました。devShell の 5 つの道具とその依存は 166 個のパッケージで 1,968,352,824 バイト（`nix path-info -r` の `narSize` の合計）、リポジトリの `node_modules` は `du -sh` で 1.9 GB でした。どちらも macOS（Apple silicon）での値です。

**まだ確かめていないこと。** AWS に対しては、何も実行していません。CloudShell を開いていないので、次のことは確かめられていません。CloudShell の Node.js の版と、その版で `aih-cloudshell.mjs` が動くこと。Node.js 18 で動くこと。Actions からのアップロードの手順。`whoami`、`budget`、`left`、`empty` が本物の `aws` の出力を読めること。とくに、空のプレフィックスに対する `--query 'Contents[].Key'` の出力、`--max-items` を付けた `list-object-versions` の `NextToken`、quiet モードの `delete-objects` が成功したときの出力は、偽物の側で決めた形です。cdkd が実際に書く `state.json` を `left` が読めることも、確かめていません。3 つのポリシーを実際のロールに付けたときの動作、VPC の中の環境、CloudShell に Nix を入れられるかどうか、Session Manager を通した SSH とエディタの接続も、実行していません。

一次情報で確かめられなかったこと。CloudShell に入っている Node.js などの版（ガイドは意図して書いていません）。ホームディレクトリの外の空き容量。認証情報が入れ替わる間隔と置き場所。CloudShell の環境の CPU アーキテクチャ（ガイドの AWS CLI の入れ直しの手順は x86_64 用のファイルを取得しますが、明記はされていません）。Cloud9 を終える日付。AWS のライフサイクルのページは開きましたが、サービスの一覧の部分を読めず、Cloud9 がどの段階に分類されているかは確かめていません。CodeCatalyst が新規の受付を閉じた日付。SageMaker Studio の Code Editor を使うための前提と料金。Cloudflare のダッシュボードに、ブラウザでコードを編集する機能があるかどうか（読んだページには書かれていませんでした）。

**使わなかったもの。** CDK のスタック（作るリソースが無いため）。AWS SDK for JavaScript（CloudShell に入っていると書かれていますが、版がわからず、バンドルに含めるとファイルが大きくなるため、AWS CLI を使いました）。CloudShell に入っている `cdk`（この本のスタックは cdkd が管理しているため）。Docker（CloudShell で使えますが、この章の仕事に要りません）。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 1 つのファイルにまとめる | `examples/37-cloudshell/scripts/bundle.ts`、`scripts/build.ts`、`src/cli.ts`、`src/aws-cli.ts`、`src/commands.ts`、`test/bundle.test.ts` | `cloudshell:build`、`test:unit` |
| いまの identity とアカウントを確かめる | `examples/37-cloudshell/src/account.ts`、`src/cli.ts`、`test/account.test.ts`、`tools/src/aws/target.ts` | `test:unit` |
| cdkd が記録しているスタックを読む | `examples/37-cloudshell/src/stacks.ts`、`test/stacks.test.ts` | `test:unit` |
| destroy の前にバケットを空にする | `examples/37-cloudshell/src/empty.ts`、`src/aws-cli.ts`、`test/empty.test.ts` | `test:unit` |
| CloudShell を使える人を決めるポリシー | `examples/37-cloudshell/src/policy.ts`、`scripts/policy.ts`、`test/policy.test.ts` | `cloudshell:policy`、`test:unit` |
| 手元で動かす | `examples/37-cloudshell/scripts/demo.ts`、`test/support/` | `cloudshell:demo`、`test:unit` |
| CloudShell に持っていって動かす | `examples/37-cloudshell/scripts/build.ts`、`src/cli.ts` | `cloudshell:build` |

**一次情報**（確認日はすべて 2026-10-13）

- CloudShell のユーザーガイド: [What is AWS CloudShell?](https://docs.aws.amazon.com/cloudshell/latest/userguide/welcome.html)、[Compute environment](https://docs.aws.amazon.com/cloudshell/latest/userguide/vm-specs.html)、[Service quotas and restrictions](https://docs.aws.amazon.com/cloudshell/latest/userguide/limits.html)、[Concepts](https://docs.aws.amazon.com/cloudshell/latest/userguide/working-with-aws-cloudshell.html)、[Getting started](https://docs.aws.amazon.com/cloudshell/latest/userguide/getting-started.html)、[Manage AWS services from CLI](https://docs.aws.amazon.com/cloudshell/latest/userguide/working-with-aws-cli.html)、[Using CloudShell in Amazon VPC](https://docs.aws.amazon.com/cloudshell/latest/userguide/using-cshell-in-vpc.html)、[Required IAM permissions for VPC environments](https://docs.aws.amazon.com/cloudshell/latest/userguide/aws-cloudshell-vpc-permissions-1.html)、[Managing access with IAM policies](https://docs.aws.amazon.com/cloudshell/latest/userguide/sec-auth-with-identities.html)、[Logging and monitoring](https://docs.aws.amazon.com/cloudshell/latest/userguide/logging-and-monitoring.html)、[Security FAQs](https://docs.aws.amazon.com/cloudshell/latest/userguide/cloudshell-security-faqs.html)、[Security best practices](https://docs.aws.amazon.com/cloudshell/latest/userguide/security-best-practices.html)、[Troubleshooting](https://docs.aws.amazon.com/cloudshell/latest/userguide/troubleshooting.html)、[Kiro CLI in CloudShell](https://docs.aws.amazon.com/cloudshell/latest/userguide/q-cli-features-in-cloudshell.html)、[Deploying a Lambda function using the AWS CDK](https://docs.aws.amazon.com/cloudshell/latest/userguide/tutorial-docker-cdk-deploy.html)
- CloudShell のそのほか: [Endpoints and quotas](https://docs.aws.amazon.com/general/latest/gr/cloudshell.html)、[AWSCloudShellFullAccess](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AWSCloudShellFullAccess.html)、[サービスリファレンスの JSON](https://servicereference.us-east-1.amazonaws.com/v1/cloudshell/cloudshell.json)（アクション 11 個、v1.4）、[Pricing](https://aws.amazon.com/cloudshell/pricing/)、[FAQs](https://aws.amazon.com/cloudshell/faqs/)
- Cloud9: [What is AWS Cloud9?](https://docs.aws.amazon.com/cloud9/latest/user-guide/welcome.html)（冒頭の告知）、[How to migrate from AWS Cloud9 to AWS IDE Toolkits or AWS CloudShell](https://aws.amazon.com/blogs/devops/how-to-migrate-from-aws-cloud9-to-aws-ide-toolkits-or-aws-cloudshell/)、[Pricing](https://aws.amazon.com/cloud9/pricing/)、[AWS Lifecycle Changes](https://docs.aws.amazon.com/general/latest/gr/service-lifecycle.html)（用語の定義だけ）
- ほかの環境: [Dev Environments in CodeCatalyst](https://docs.aws.amazon.com/codecatalyst/latest/userguide/devenvironment.html)、[Code Editor in SageMaker Studio](https://docs.aws.amazon.com/sagemaker/latest/dg/code-editor.html)、[Working with Amazon EC2 (AWS Toolkit for VS Code)](https://docs.aws.amazon.com/toolkit-for-vscode/latest/userguide/ec2-overview.html)、[SSH connections through Session Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-getting-started-enable-ssh-connections.html)
- API と CLI: [DeleteObjects](https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObjects.html)、[ListObjectVersions](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectVersions.html)、[s3api list-object-versions](https://docs.aws.amazon.com/cli/latest/reference/s3api/list-object-versions.html)、[s3 cp](https://docs.aws.amazon.com/cli/latest/reference/s3/cp.html)、[DescribeBudget](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_budgets_DescribeBudget.html)、[logs tail](https://docs.aws.amazon.com/cli/latest/reference/logs/tail.html)。`sts get-caller-identity`、`s3api list-objects-v2`、`s3api delete-objects` の入出力は、AWS CLI 2.35.11 のヘルプで確かめました
- Nix: [Installing a Binary Distribution](https://nix.dev/manual/nix/2.28/installation/installing-binary)
- cdkd 0.296.28: npm の tarball の `dist/index.d.ts`（`StackState`、`ResourceState`）と `dist/` のソース（state のバケットの名前とキーの形）
- Cloudflare と Vercel: [Wrangler の General commands](https://developers.cloudflare.com/workers/wrangler/commands/general/)、[Workers: Get started (Dashboard)](https://developers.cloudflare.com/workers/get-started/dashboard/)、[Vercel CLI Overview](https://vercel.com/docs/cli)

:::
