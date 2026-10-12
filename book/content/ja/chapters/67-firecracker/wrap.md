---
title: "67 Firecracker: 費用、注意点、片付け"
---

# 67 Firecracker: 費用、注意点、片付け

章の最後のページです。料金、つまずきやすい点、片付け、検証メモの順に進みます。

## 料金

<!-- section: 67.cost -->

Firecracker そのものは Apache License 2.0 のオープンソースで、料金はありません。かかるのは、動かすマシンの料金です。手元の Linux のマシンで試すなら、AWS の料金は発生しません。

前のページのスタックは、既定ではインスタンスを作りません。起動テンプレート、セキュリティグループ、ロール、インスタンスプロファイルに料金は無く、バケットは、数十 KB のキットを置いているあいだ S3 の保管料がかかるだけです。

`-c run=true` を付けたときの料金は、次のとおりです。単価は 2026 年 10 月 13 日に AWS Price List で確かめた、東京リージョンのオンデマンドの定価です（公開日 2026-10-09）。

| 場合 | 内訳 | 定価の小計 |
| --- | --- | ---: |
| 2 時間で消す | c7i.large 2 時間 0.22、パブリック IPv4 アドレス 0.01、16 GiB の gp3 0.004 | 0.24 USD |
| 消し忘れて 1 か月（730 時間） | c7i.large 82.02、パブリック IPv4 アドレス 3.65、16 GiB の gp3 1.54 | 87.20 USD |
| 参考: c5.metal を 2 時間 | インスタンスの時間料金だけ | 10.27 USD |

ダウンロードのデータ転送、Session Manager、11章のネットワークに置いたものは入れていません。無料枠は、c7i.large について確認できなかったので引いていません。インスタンスを止める（stop）だけでは、ルートボリュームの料金が残ります。nested virtualization に追加の料金は無い、と EC2 のガイドに書かれています。

この章で名前を挙げたほかのサービスの料金は、調べていません。Lambda MicroVMs は Lambda の料金ページに載っている、と発表にあります。SnapStart は、スナップショットのキャッシュと復元に料金がかかる、とガイドにあります。

## つまずきやすいところ

| 症状 | 確かめること |
| --- | --- |
| `firecracker:boot did not run` と出る | Linux ではないか、`/dev/kvm` を読み書きできない。`firecracker:plan` は同じリクエストを表示するだけなので、どこでも動く |
| `got no answer` で止まる | Firecracker が待ち受けていないか、ソケットのパスが違うか、権限が違う。手引きは、Firecracker を `sudo` で起動したなら、呼ぶ側も `sudo` にするよう書いている |
| 設定の呼び出しが 400 で断られ、起動の前にしか送れないと言われる | そのプロセスはすでにゲストを起動している。Firecracker のプロセスは microVM 1 つに 1 回きりなので、プロセスを起動し直す |
| `InstanceStart` が断られる | カーネルかルートのドライブのパスが違う。パスは Firecracker のプロセスの作業ディレクトリから見たもの |
| ゲストが答えないまま 30 秒で止まる | ゲストは起動したが、サーバーが動いていないか、ネットワークがつながっていない。Firecracker を起動した端末のコンソール出力と、`ip addr show tap0` を見る |
| コンソールに何も出ない | 起動引数に `console=ttyS0` が無い。FAQ によれば、コンソールは既定で無効 |
| インスタンスに `/dev/kvm` が無い | nested virtualization が有効でないか、対応していないインスタンスタイプ。`aws ec2 describe-instance-types` の `ProcessorInfo.SupportedFeatures` で確かめられる、と EC2 のガイドにある |
| `firecracker:spec` が失敗する | 取得した仕様のチェックサムが違うか、切り出した結果がリポジトリの JSON と違う。版を上げるときは `SPEC` の版、URL、チェックサムを直し、`--write` で書き直して差分を読む |

## 片付け

<!-- section: 67.cleanup -->

手元のマシンでは、ゲストを止め、`deploy/tap.sh down` でネットワークを戻し、`work/` を消します。`work/` には、ゲストに入るための SSH の秘密鍵も入っています。

EC2 で試したなら、バケットを空にしてからスタックを消します。空でないバケットは削除できないためです。

```bash
vp run firecracker:kit:empty
vp run firecracker:infra:destroy
```

インスタンスとルートボリュームは、スタックと一緒に消えます。ルートボリュームは、起動テンプレートでインスタンスの終了と同時に削除する設定にしてあります。インスタンスの上に作ったカーネル、ルートファイルシステム、スナップショットのファイルも、ボリュームと一緒に無くなります。残るのは 11章のネットワークで、ほかの章で使わないなら `vp run net:infra:destroy` で消します。消えたことは、EC2 のコンソールでインスタンスとボリュームが無いことを見て確かめます。

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト（リポジトリの JSON が固定した版の仕様から切り出したものであること。送りうるすべてのリクエストが仕様の操作、`operationId`、成功のステータス、ボディの定義に合うこと。スキーマの vCPU の範囲、状態の列挙、必須のフィールドが仕様と一致すること。設定の検証。リクエストの順序。Unix ドメインソケット越しの起動。設定を途中で断られたときに `InstanceStart` が送られないこと。設定の送り直し。起動後の設定変更が断られること。`InstanceStart` の応答が失われたときの扱い。スナップショットの前提。起動時間の測り方。スタックのアサーション）。型検査。`firecracker:plan`、`firecracker:kit:build`、`firecracker:spec`、`firecracker:infra:synth`。バンドルした `guest-server.mjs` を macOS の上で起動し、`/health` が 200 を返すこと。`firecracker:boot` が macOS では何も送らずに終わること。実行したのは 2026 年 10 月 13 日、Node.js は 24.21.0 です。

**まだ確かめていないこと。** Firecracker を 1 度も起動していません。この章を書いたマシンは macOS で、KVM がありません。したがって、次のことは確かめられていません。このクライアントが本物の Firecracker v1.17.0 と話せること。自作のサーバーが断る条件を、本物が同じように断ること。`deploy/prepare.sh` と `deploy/tap.sh` が動くこと。公式の Node.js のバイナリが、Firecracker の CI のルートファイルシステムの中で動くこと。ゲストの中で 04章のサーバーが答えること。起動時間。スナップショット。

AWS に対しても、何も実行していません。スタックのデプロイ、nested virtualization を有効にした c7i.large に `/dev/kvm` が現れること、その上で Firecracker が動くこと、起動テンプレートとインスタンスを cdkd が Cloud Control API 経由で作れること、ホップ数 1 の設定でゲストからメタデータのトークンを取れないこと、片付けは、どれも確かめていません。

一次情報で確かめられなかったこと。ホワイトペーパー「Security Overview of AWS Fargate」は、配布元が 403 を返し、読めませんでした。Fargate と Firecracker の関係について書いたのは、2018 年の AWS のブログと、いまの ECS のガイドにある範囲だけです。Lambda のホワイトペーパーは、HTML のページがデベロッパーガイドに転送されたので、PDF を読みました。最後の改訂は 2022 年 12 月で、SnapStart の記述はガイドより古いものでした。Firecracker の手引きの「EC2 が KVM を使わせるのは `.metal` だけ」と、EC2 のガイドの nested virtualization のページは食い違っています。Lambda MicroVMs の発表のページは、要約を返す取得ツールを通して読みました。

**確かめる手順。** Linux と KVM のあるマシンで、`vp run firecracker:kit:build` の結果を置き、[手元で動かす](/ja/chapters/67-firecracker/local.md)のページの手順を順に実行します。最初に `curl --unix-socket /tmp/firecracker.socket http://localhost/version` が版を返すことを確かめ、次に `boot.mjs` を実行します。断られたリクエストがあれば、ステータスと `fault_message` を `test/support/fake-firecracker.ts` の規則と比べ、違っていれば自作のサーバーを直します。EC2 で確かめるなら、[デプロイ](/ja/chapters/67-firecracker/deploy.md)のページの手順でインスタンスを作り、`ls -l /dev/kvm` の結果から記録します。

**使わなかったもの。** jailer（手引きに合わせた簡略。本番では使う）。`.metal` のインスタンス（1 時間 5 USD を超えるため。Firecracker がテストしているのはこちら）。Graviton のインスタンス（nested virtualization の一覧に無いため。Firecracker は aarch64 に対応している）。仕様からのコード生成（依存を増やさず、使う 9 つの操作だけを手で書いて照らした）。firecracker-containerd や Kata Containers などの上位の道具（章の範囲の外）。Lambda MicroVMs（名前と位置づけだけ。料金と上限は調べていない）。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| API ソケットと起動の順番 | `examples/67-firecracker/src/spec.ts`、`src/subset.ts`、`spec/firecracker-v1.17.0.subset.json`、`scripts/spec.ts`、`test/spec.test.ts` | `firecracker:spec`、`test:unit` |
| 設定の検証 | `examples/67-firecracker/src/config.ts`、`src/requests.ts`、`test/config.test.ts` | `firecracker:plan`、`test:unit` |
| クライアントと、失われた応答 | `examples/67-firecracker/src/client.ts`、`test/client.test.ts`、`test/support/fake-firecracker.ts` | `test:unit` |
| テストと、送るリクエストの表示 | `examples/67-firecracker/scripts/plan.ts`、`src/args.ts` | `firecracker:plan` |
| Linux と KVM のあるマシンでの手順 | `examples/67-firecracker/deploy/`、`src/guest-server.ts`、`src/boot.ts`、`scripts/boot.ts`、`scripts/build.ts`、`test/boot.test.ts` | `firecracker:kit:build`、`firecracker:boot` |
| 試す場所としてのインスタンス | `examples/67-firecracker/infra/`、`src/host-config.ts`、`scripts/kit.ts` | `firecracker:infra:synth`、`firecracker:infra:deploy`、`firecracker:kit:publish`、`firecracker:kit:empty`、`firecracker:infra:destroy` |

**一次情報**（確認日はすべて 2026-10-13）

- Firecracker v1.17.0 のリポジトリ: [README](https://github.com/firecracker-microvm/firecracker/blob/v1.17.0/README.md)、[SPECIFICATION](https://github.com/firecracker-microvm/firecracker/blob/v1.17.0/SPECIFICATION.md)、[Design](https://github.com/firecracker-microvm/firecracker/blob/v1.17.0/docs/design.md)、[FAQ](https://github.com/firecracker-microvm/firecracker/blob/v1.17.0/FAQ.md)、[Charter](https://github.com/firecracker-microvm/firecracker/blob/v1.17.0/CHARTER.md)、[LICENSE](https://github.com/firecracker-microvm/firecracker/blob/v1.17.0/LICENSE)、[Getting Started](https://github.com/firecracker-microvm/firecracker/blob/v1.17.0/docs/getting-started.md)、[Dev machine setup](https://github.com/firecracker-microvm/firecracker/blob/v1.17.0/docs/dev-machine-setup.md)、[Jailer](https://github.com/firecracker-microvm/firecracker/blob/v1.17.0/docs/jailer.md)、[Production host setup](https://github.com/firecracker-microvm/firecracker/blob/v1.17.0/docs/prod-host-setup.md)、[Snapshotting](https://github.com/firecracker-microvm/firecracker/blob/v1.17.0/docs/snapshotting/snapshot-support.md)、[Kernel policy](https://github.com/firecracker-microvm/firecracker/blob/v1.17.0/docs/kernel-policy.md)、[Actions API](https://github.com/firecracker-microvm/firecracker/blob/v1.17.0/docs/api_requests/actions.md)、[API の仕様](https://raw.githubusercontent.com/firecracker-microvm/firecracker/v1.17.0/src/firecracker/swagger/firecracker.yaml)、[CI のルートファイルシステムのスクリプト](https://github.com/firecracker-microvm/firecracker/blob/v1.17.0/resources/rootfs/setup-ubuntu-ci.sh)、[v1.17.0 のリリース](https://github.com/firecracker-microvm/firecracker/releases/tag/v1.17.0)
- 論文: [Firecracker: Lightweight Virtualization for Serverless Applications](https://www.usenix.org/system/files/nsdi20-paper-agache.pdf)（NSDI '20。Firecracker v0.20.0 と当時の Lambda についての記述）
- AWS の Lambda: [Security Overview of AWS Lambda](https://docs.aws.amazon.com/pdfs/whitepapers/latest/security-overview-aws-lambda/security-overview-aws-lambda.pdf)、[Understanding the Lambda execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html)、[Lambda SnapStart](https://docs.aws.amazon.com/lambda/latest/dg/snapstart.html)、[Lambda Managed Instances](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances.html)、[Security for Lambda Managed Instances](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances-security.html)、[AWS Lambda MicroVMs](https://docs.aws.amazon.com/lambda/latest/dg/lambda-microvms-guide.html)、[AWS introduces Lambda MicroVMs](https://aws.amazon.com/about-aws/whats-new/2026/06/aws-lambda-microvms/)
- AWS の Fargate とそのほか: [Amazon ECS security considerations for when to use Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/security-fargate-ec2.html)、[Amazon ECS task IAM role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html)、[Serverless and Containers - Logical Separation on AWS](https://docs.aws.amazon.com/whitepapers/latest/logical-separation/serverless-and-containers.html)、[Firecracker - Lightweight Virtualization for Serverless Computing](https://aws.amazon.com/blogs/aws/firecracker-lightweight-virtualization-for-serverless-computing/)、[Announcing the Firecracker Open Source Technology](https://aws.amazon.com/blogs/opensource/firecracker-open-source-secure-fast-microvm-serverless/)
- EC2: [Use nested virtualization to run hypervisors in Amazon EC2 instances](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/amazon-ec2-nested-virtualization.html)、[AWS::EC2::LaunchTemplate CpuOptions](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-ec2-launchtemplate-cpuoptions.html)、[AWS Price List: Amazon EC2, ap-northeast-1](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/ap-northeast-1/index.csv)
- そのほか: [How Workers works](https://developers.cloudflare.com/workers/reference/how-workers-works/)、[Workers security model](https://developers.cloudflare.com/workers/reference/security-model/)、[Vercel Sandbox](https://vercel.com/docs/vercel-sandbox)、[Node.js v24.21.0 SHASUMS256.txt](https://nodejs.org/dist/v24.21.0/SHASUMS256.txt)

:::
